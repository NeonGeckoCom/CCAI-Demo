"""Probe the advisor-skill classifier with multi-round prompts.

Uses a minimal Gemini REST client (httpx) so we don't need to install the full
backend dependency stack. Patches out the Mongo-backed helpers in the
classifier so the run is self-contained.

Prints per-turn which branch fired:
  - existing skill id (e.g., committee_prep)
  - quick_advice (default / fallback / other-with-low-confidence)
  - custom_<id> (other -> generated new skill)
"""

import asyncio
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import List
from unittest.mock import AsyncMock, patch

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from app.advisor_skills.registry import ADVISOR_SKILLS, build_generated_advisor_skill  # noqa: E402
from app.llm.classifier import classify_advisor_skill  # noqa: E402
from app.llm.clients.llm_client import LLMClient  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("app.llm.classifier").setLevel(logging.INFO)


class MinimalGeminiClient(LLMClient):
    """Tiny LLMClient that hits the Gemini REST endpoint directly."""

    def __init__(self):
        self.api_key = os.environ["GEMINI_API_KEY"]
        self.model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        self.base = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent"
        )
        self.client = httpx.AsyncClient(timeout=90.0)

    async def aclose(self):
        await self.client.aclose()

    async def generate(self, system_prompt: str, context: List[dict],
                       temperature: float, max_tokens: int,
                       response_mime_type: str = None) -> str:
        contents = []
        for msg in context:
            role = "user" if msg["role"] == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})

        gen_config = {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            "topP": 0.9,
            "topK": 40,
        }
        if response_mime_type:
            gen_config["responseMimeType"] = response_mime_type
        normalized_model = (self.model or "").lower()
        if normalized_model.startswith(("gemini-3", "gemini-2.5")):
            gen_config["thinkingConfig"] = {"thinkingBudget": 0}

        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": contents,
            "generationConfig": gen_config,
        }

        resp = await self.client.post(
            self.base, params={"key": self.api_key}, json=payload
        )
        resp.raise_for_status()
        data = resp.json()
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as exc:
            raise RuntimeError(f"Unexpected Gemini response: {data}") from exc

    async def generate_with_tools(self, *args, **kwargs):
        raise NotImplementedError


BUILT_IN_CONTROL_SCENARIOS = [
    (
        "Defense prep",
        "What questions might my committee ask at my proposal defense?",
        "committee_prep",
        False,
    ),
    (
        "Method fit",
        "Is a mixed-methods design appropriate for my research question about advising access?",
        "research_design_review",
        False,
    ),
    (
        "Recovery timeline",
        "I am three weeks behind on data cleaning. Help me build a recovery plan.",
        "action_plan",
        False,
    ),
    (
        "Uploaded draft review",
        "I uploaded my proposal draft. Can you review the argument and structure?",
        "document_feedback",
        True,
    ),
    (
        "Small orientation",
        "How should I think about my first semester as a PhD student?",
        "quick_advice",
        False,
    ),
]


OTHER_CANDIDATE_SCENARIOS = [
    ("Response-to-reviewers letter", [
        "I got a major-revision decision from JMLR. Reviewer 2 says my baseline comparison is unfair. How should I think about replying?",
        "Draft me the tone and structure of a point-by-point rebuttal — not the content, the rhetorical posture.",
        "When the reviewer is wrong but the editor seems to side with them, how do I push back without sounding defensive?",
    ]),
    ("Authorship-order negotiation", [
        "My co-author wants first authorship even though I did 70% of the experiments. We've never discussed this.",
        "Help me prepare for the conversation — what's the actual norm in computational neuroscience for shared first?",
        "If they refuse, what's my escalation path that doesn't burn the relationship?",
    ]),
    ("Faculty job-market materials", [
        "I'm going on the academic job market this fall. Where do I even start?",
        "Specifically the research statement — how is it different from a grant proposal in framing?",
        "And how do I tailor the same statement for an R1 vs. a SLAC without writing two completely different documents?",
    ]),
    ("Translating research for a funder", [
        "I need to pitch my dissertation work to a private foundation that funds applied work, not academics.",
        "What gets lost when I strip out the methods detail, and how do I keep credibility?",
        "Give me a frame for the one-paragraph 'so what' that doesn't sound like a press release.",
    ]),
    ("Advisor-conflict navigation", [
        "My advisor and my committee chair disagree about my direction. I'm caught in the middle.",
        "How do I figure out whose disagreement is substantive vs. political?",
        "What's a way to surface the disagreement to them without it looking like I'm forcing a fight?",
    ]),
]


async def fake_create_user_advisor_skill(_user_id, spec):
    return build_generated_advisor_skill(spec)


def _branch_for(result):
    if result.skill_id.startswith("custom_"):
        return f"OTHER -> generated ({result.skill_id})"
    return result.skill_id


async def main():
    llm = MinimalGeminiClient()
    user_id = "64f000000000000000000001"

    print(f"Built-in skills: {sorted(ADVISOR_SKILLS.keys())}\n")

    try:
        control_skills = dict(ADVISOR_SKILLS)
        with patch(
            "app.llm.classifier.get_effective_advisor_skills",
            new=AsyncMock(return_value=control_skills),
        ), patch(
            "app.llm.classifier.create_user_advisor_skill",
            new=AsyncMock(side_effect=fake_create_user_advisor_skill),
        ):
            print("=== Built-in controls ===")
            for scenario_name, turn, expected, has_documents in BUILT_IN_CONTROL_SCENARIOS:
                try:
                    result = await classify_advisor_skill(
                        llm,
                        turn,
                        has_documents=has_documents,
                        user_id=user_id,
                    )
                except Exception as exc:
                    print(f"  {scenario_name}: ERROR {exc!r}")
                    continue
                status = "OK" if result.skill_id == expected else "CHECK"
                branch = _branch_for(result)
                print(
                    f"  [{status}] {scenario_name}: [{branch}] "
                    f"expected={expected} conf={result.confidence:.2f}"
                )
                print(f"      msg: {turn[:95]}{'...' if len(turn) > 95 else ''}")
                print(f"      reason: {result.reason[:200]}")

        other_skills = dict(ADVISOR_SKILLS)
        with patch(
            "app.llm.classifier.get_effective_advisor_skills",
            new=AsyncMock(return_value=other_skills),
        ), patch(
            "app.llm.classifier.create_user_advisor_skill",
            new=AsyncMock(side_effect=fake_create_user_advisor_skill),
        ):
            for scenario_name, turns in OTHER_CANDIDATE_SCENARIOS:
                print(f"\n=== {scenario_name} ===")
                for i, turn in enumerate(turns, 1):
                    try:
                        result = await classify_advisor_skill(
                            llm,
                            turn,
                            has_documents=False,
                            user_id=user_id,
                        )
                    except Exception as exc:
                        print(f"  T{i}: ERROR {exc!r}")
                        continue
                    branch = _branch_for(result)
                    print(f"  T{i} [{branch}] conf={result.confidence:.2f}")
                    print(f"      msg: {turn[:95]}{'...' if len(turn) > 95 else ''}")
                    print(f"      reason: {result.reason[:200]}")
    finally:
        await llm.aclose()


if __name__ == "__main__":
    asyncio.run(main())
