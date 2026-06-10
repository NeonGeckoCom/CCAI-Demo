"""LLM-backed orchestration tasks.

Discrete jobs that need an LLM call: clarification, tool dispatch, and
persona ranking. The orchestrator keeps thin delegating wrappers around
these tasks.
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional

from app.config import get_settings
from app.llm.clients.llm_client import LLMClient, ToolCallResult
from app.tools import get_tool_definitions, get_tool_executor

logger = logging.getLogger(__name__)


def needs_clarification(session, user_input: str) -> bool:
    """Determine if the user input needs clarification using config rules."""
    user_messages = [msg for msg in session.messages if msg.get('role') == 'user']
    if len(user_messages) > 1:
        logger.info("Skipping clarification: session already has %d user message(s)", len(user_messages))
        return False

    vague_patterns = [
        r"^(help|advice|guidance|assistance)$",
        r"i'?m (stuck|lost|confused|not sure)",
        r"i am (stuck|lost|confused|not sure)",
        r"(what should i|how do i|where do i start)",
        r"i need (help|advice|guidance)",
        r"(any|some) (advice|suggestions|ideas)",
        r"don'?t know (what|how|where)",
        r"(stuck|struggling) with",
        r"unsure about",
    ]

    orch_cfg = get_settings().orchestrator
    user_lower = user_input.lower().strip()
    word_count = len(user_input.split())

    logger.info("Checking clarification for: %s (%d words)", user_input, word_count)

    if any(keyword in user_lower for keyword in orch_cfg.specific_keywords):
        logger.info("NO CLARIFICATION: input contains specific keywords")
        return False

    if word_count >= orch_cfg.min_words_without_keywords:
        logger.info(
            "NO CLARIFICATION: input has %d words (>= %d threshold)",
            word_count,
            orch_cfg.min_words_without_keywords,
        )
        return False

    for pattern in vague_patterns:
        if re.search(pattern, user_lower):
            logger.info("CLARIFICATION TRIGGERED: pattern `%s` matched `%s`", pattern, user_input)
            return True

    logger.info("CLARIFICATION TRIGGERED: short input (%d words) without specific keywords", word_count)
    return True


async def needs_clarification_improved(personas, session, user_input: str) -> bool:
    """
    Use an LLM call to determine whether the user's input is too vague
    to route to the advisor panel. Falls back to rule-based classification.
    """
    user_messages = [msg for msg in session.messages if msg.get('role') == 'user']
    if len(user_messages) > 1:
        logger.info("Skipping clarification: session already has %d user message(s)", len(user_messages))
        return False

    app_cfg = get_settings().app
    orch_cfg = get_settings().orchestrator
    advisor_descriptions = ", ".join(
        f"{p.name} ({p.id})" for p in personas.values()
    )
    domain_keywords = ", ".join(orch_cfg.specific_keywords)

    system_prompt = (
        "You are a routing classifier for an AI advisory application.\n\n"
        f"Application: {app_cfg.title} - {app_cfg.subtitle}\n"
        f"Available advisors: {advisor_descriptions}\n"
        f"Domain-relevant topics: {domain_keywords}\n\n"
        "Your task: decide whether the user's FIRST message contains enough "
        "substance to send to the advisors, or whether it is too vague and "
        "requires a clarifying follow-up before the advisors can help.\n\n"
        "A message NEEDS CLARIFICATION when it:\n"
        "- Expresses confusion or uncertainty without a concrete topic\n"
        "- Is a single generic request like 'help' or 'advice'\n"
        "- Contains no identifiable subject the advisors could address\n\n"
        "A message is CLEAR ENOUGH when it:\n"
        "- Mentions a specific topic, question, or problem area\n"
        "- Provides enough context for at least one advisor to respond usefully\n"
        "- Even a short message is fine if the intent is unambiguous "
        "(e.g. 'explain transformers' is clear)\n"
        "- Messages mentioning domain-relevant topics are likely clear enough "
        "to route directly, even if brief\n\n"
        "Respond ONLY with valid JSON:\n"
        '{"needs_clarification": true or false, "reason": "one sentence explanation"}'
    )

    raw = None

    try:
        llm = next(iter(personas.values())).llm
        raw = await llm.generate(
            system_prompt=system_prompt,
            context=[{"role": "user", "content": f'User message: "{user_input}"'}],
            temperature=0.0,
            max_tokens=128,
            response_mime_type="application/json",
        )

        parsed = json.loads(raw.strip())
        value = parsed.get("needs_clarification")
        if not isinstance(value, bool):
            raise TypeError(
                f"needs_clarification must be a boolean, got {type(value).__name__}: {value!r}"
            )

        logger.info(
            "LLM clarification classification: needs_clarification=%s, reason=%r, input=%r",
            value,
            parsed.get("reason", ""),
            user_input,
        )
        return value

    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        logger.error("Failed to parse LLM classification response: %s (raw=%r)", exc, raw)
    except Exception as exc:
        logger.error("LLM classification call failed: %s", exc)

    logger.warning("Falling back to rule-based clarification check")
    return needs_clarification(session, user_input)


async def generate_contextual_clarification(personas, user_input: str) -> Dict[str, Any]:
    """
    Produce a clarification question and clickable suggestions tailored to
    the user's message. Falls back to configured static suggestions.
    """
    orch_cfg = get_settings().orchestrator
    advisor_list = ", ".join(
        f"{p.name} ({p.id})" for p in personas.values()
    )

    system_prompt = (
        "You are a helpful routing assistant. The user's message is too "
        "vague to send to the advisors. Produce a short clarifying question "
        "and exactly 4 clickable suggestion buttons the user could press.\n\n"
        "Reply ONLY with valid JSON - no markdown, no extra text:\n"
        '{"question": "...", "suggestions": ["...", "...", "...", "..."]}\n\n'
        "Keep the question to one sentence. Each suggestion should be a "
        "complete sentence the user could send as their next message."
    )

    user_prompt = (
        f'User said: "{user_input}"\n'
        f"Available advisors: {advisor_list}\n\n"
        "Generate a clarifying question and 4 suggestion buttons that "
        "relate to what the user said and steer toward the advisors above."
    )

    try:
        llm = next(iter(personas.values())).llm
        raw = await llm.generate(
            system_prompt=system_prompt,
            context=[{"role": "user", "content": user_prompt}],
            temperature=0.4,
            max_tokens=1024,
            response_mime_type="application/json",
        )

        cleaned = re.sub(r"```(?:json)?", "", raw.strip()).strip()
        json_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if json_match:
            cleaned = json_match.group(0)

        parsed = json.loads(cleaned)
        question = parsed.get("question", "").strip()
        suggestions = parsed.get("suggestions", [])

        if question and isinstance(suggestions, list) and len(suggestions) >= 2:
            logger.info("LLM clarification generated for: %s", user_input)
            return {"question": question, "suggestions": suggestions[:4]}

    except Exception as exc:
        logger.error("LLM clarification failed, using config fallback: %s", exc)

    return {
        "question": orch_cfg.clarification_questions[0],
        "suggestions": orch_cfg.clarification_suggestions,
    }


async def run_tool_response(llm_client: LLMClient, user_message: str) -> ToolCallResult:
    """Check whether a tool can handle *user_message*.

    If tools are disabled in config, no LLM client is available, or the
    model decides no tool is needed, returns
    ``ToolCallResult(used_tool=False)``.  Otherwise executes the tool and
    returns the grounded response with ``used_tool=True``.
    """
    if llm_client is None:
        return ToolCallResult(text="", used_tool=False)

    settings = get_settings()
    tools_enabled = settings.tools.get_enabled_names()

    if not tools_enabled:
        return ToolCallResult(text="", used_tool=False)

    tool_definitions = get_tool_definitions(enabled=tools_enabled)
    tool_executor = get_tool_executor(enabled=tools_enabled)

    if not tool_definitions:
        return ToolCallResult(text="", used_tool=False)

    system_prompt = (
        "You are a helpful assistant with access to external tools. "
        "Use the available tools when the user's question can be answered "
        "by one of them. If no tool is relevant, respond with a brief "
        "text answer. "
        "If a tool response includes 'truncated': true, let the user know "
        "how many total results were found and suggest they narrow their "
        "search for more specific results. "
        "Format your responses using markdown. Use bullet points "
        "to present structured data like course listings or professor ratings."
    )

    return await llm_client.generate_with_tools(
        system_prompt=system_prompt,
        user_message=user_message,
        tool_definitions=tool_definitions,
        tool_executor=tool_executor,
    )


async def rank_personas(
    personas,
    session,
    k: int = 3,
    allowed_ids: Optional[List[str]] = None,
    preferred_ids: Optional[List[str]] = None,
    llm_client: Optional[LLMClient] = None,
) -> List[str]:
    """
    Use the LLM to rank personas based on current session context.
    Falls back to default persona order if LLM fails or returns invalid data.
    """
    try:
        pool_ids = allowed_ids if allowed_ids is not None else list(personas.keys())
        pool = {pid: personas[pid] for pid in pool_ids if pid in personas}
        preferred_pool_ids = [
            pid for pid in (preferred_ids or [])
            if pid in pool
        ]

        if not pool:
            logger.warning("No personas registered.")
            return []

        def fallback_rank() -> List[str]:
            ordered = preferred_pool_ids + [
                pid for pid in pool.keys()
                if pid not in preferred_pool_ids
            ]
            return ordered[:k]

        # Prefer the orchestrator's base LLM when available so routing uses
        # the same prompt format as normal chat generation.
        llm = llm_client or next(iter(pool.values())).llm

        # Use recent conversation context (last 5 messages)
        recent_context = "\n".join(
            msg['content'] for msg in session.get_recent_messages(5)
        )

        # Format available persona descriptions
        persona_descriptions = "\n".join([
            f"- ID: {p.id}\n  Name: {p.name}\n  Prompt: {p.system_prompt.strip()}"
            for p in pool.values()
        ])

        # Ensure k does not exceed the number of available personas
        k = min(k, len(pool))

        app_title = get_settings().app.title

        preferred_line = (
            "Preferred advisors for the classified advisor skill: "
            f"{', '.join(preferred_pool_ids)}"
            if preferred_pool_ids
            else "No skill-specific advisor preference is available."
        )

        prompt = f"""
                    The user is seeking advice from {app_title}. Based on the conversation below, choose the top {k} most relevant advisors.

                    {preferred_line}
                    Prefer skill-relevant advisors when they fit the conversation, but keep the final list useful and diverse.

                    Respond ONLY with a JSON list of exactly {k} advisor IDs in order of relevance.
                    Example response: ["methodologist", "pragmatist", "theorist"]

                    --- Conversation ---
                    {recent_context}

                    --- Available Advisors ---
                    {persona_descriptions}
                  """.strip()

        llm_response = await llm.generate(
            system_prompt=f"You are an assistant that selects the best advisors for a user of {app_title}.",
            context=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=150,
            response_mime_type="application/json"
        )

        # Step 1: Try direct JSON load
        try:
            top_ids = json.loads(llm_response.strip())
        except json.JSONDecodeError:
            # Step 2: Fallback: try extracting list of quoted strings
            top_ids = re.findall(r'"(.*?)"', llm_response)
            logger.warning(f"Fallback JSON extraction used: {top_ids}")

        # Handle models that wrap the list in an object (e.g. {"advisor_ids": [...]})
        if isinstance(top_ids, dict):
            top_ids = next(iter(top_ids.values()), [])

        # Step 3: Filter valid persona IDs
        valid_ids = [pid for pid in top_ids if pid in pool]

        if len(valid_ids) < k:
            logger.warning(f"LLM returned insufficient or invalid IDs. Got: {valid_ids}")
            return fallback_rank()

        return valid_ids[:k]

    except Exception as e:
        logger.error(f"Error selecting top personas: {e}")
        pool_ids = allowed_ids if allowed_ids is not None else list(personas.keys())
        pool = [pid for pid in pool_ids if pid in personas]
        preferred_pool_ids = [
            pid for pid in (preferred_ids or [])
            if pid in pool
        ]
        ordered = preferred_pool_ids + [
            pid for pid in pool
            if pid not in preferred_pool_ids
        ]
        return ordered[:k]
