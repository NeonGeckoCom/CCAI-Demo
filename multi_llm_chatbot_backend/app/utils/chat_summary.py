from typing import List
from app.llm.llm_client import LLMClient
from app.config import get_settings
import logging
import re
from typing import List, Dict

logger = logging.getLogger(__name__)

async def generate_summary_from_messages(messages: List[dict], llm: LLMClient, max_tokens: int = 800) -> str:
    """
    Summarize the conversation using the given LLM client.
    """
    try:
        app_title = get_settings().app.title
        full_text = "\n\n".join([f"{m['role']}:\n{m['content']}" for m in messages])

        system_prompt = (
            f"You are an assistant for {app_title}. Summarize the following chat conversation "
            "into a well-formatted summary with clear bullet points. "
            "Please format your response as follows:\n"
            "- Use bullet points (starting with *) for key insights\n"
            "- Put each bullet point on a separate line\n"
            "- Include section headings if appropriate (formatted as **Section Name:**)\n"
            "- Focus on insights, questions, and actionable advice\n"
            "- Maximum 10 bullet points\n\n"
            "Example format:\n"
            "**Key Insights:**\n"
            "* First main point about the conversation\n"
            "* Second important insight\n"
            "* Third key takeaway\n\n"
            "**Recommendations:**\n"
            "* First actionable recommendation\n"
            "* Second suggestion"
        )

        context = [{"role": "user", "content": f"Chat Log:\n{full_text}"}]

        summary = await llm.generate(
            system_prompt=system_prompt,
            context=context,
            temperature=0.4,
            max_tokens=max_tokens
        )

        # Post-process the summary to ensure proper formatting
        formatted_summary = _format_summary_text(summary.strip())
        return formatted_summary

    except Exception as e:
        logger.error(f"Error generating summary: {str(e)}")
        return "Summary generation failed. Please try again later."


def _format_summary_text(summary_text: str) -> str:
    """
    Post-process the summary text to ensure proper bullet point formatting.
    """
    # Fix common formatting issues
    
    # Add line breaks before bullet points that don't have them
    summary_text = re.sub(r'(?<!\n)([*•] )', r'\n\1', summary_text)
    
    # Add line breaks before numbered lists that don't have them
    summary_text = re.sub(r'(?<!\n)(\d+\.\s+)', r'\n\1', summary_text)
    
    # Add line breaks after periods followed by capital letters (likely new sentences)
    summary_text = re.sub(r'(?<=[.!?])(?=\s*[*•]\s)', '\n', summary_text)
    
    # Clean up multiple consecutive newlines
    summary_text = re.sub(r'\n{3,}', '\n\n', summary_text)
    
    # Ensure bullet points are properly spaced
    summary_text = re.sub(r'\n([*•] )', r'\n\n\1', summary_text)
    
    # Fix section headings that might be run together
    summary_text = re.sub(r'([.!?])\s*(\*\*[^*]+\*\*)', r'\1\n\n\2', summary_text)
    
    return summary_text.strip()


def parse_summary_to_blocks(summary_text: str) -> List[Dict]:
    """
    Parse summary text into structured blocks for better formatting.
    """
    # First, ensure proper formatting
    summary_text = _format_summary_text(summary_text)
    
    lines = summary_text.strip().splitlines()
    blocks = []
    current_block = None

    def flush_current_block():
        if current_block:
            blocks.append(current_block.copy())

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Match section headings (e.g. **Title:** or **Title**)
        heading_match = re.match(r'^\*\*(.+?)\*\*:?$', line)
        if heading_match:
            flush_current_block()
            current_block = {"type": "heading", "text": heading_match.group(1).strip()}
            flush_current_block()
            current_block = None
            continue

        # Match bullet list items (*, •, or -)
        bullet_match = re.match(r'^[*•-]\s+(.+)', line)
        if bullet_match:
            if current_block is None or current_block["type"] != "list" or current_block.get("style") != "bullet":
                flush_current_block()
                current_block = {"type": "list", "style": "bullet", "items": []}
            current_block["items"].append(bullet_match.group(1).strip())
            continue

        # Match numbered list items
        number_match = re.match(r'^\d+\.\s+(.+)', line)
        if number_match:
            if current_block is None or current_block["type"] != "list" or current_block.get("style") != "numbered":
                flush_current_block()
                current_block = {"type": "list", "style": "numbered", "items": []}
            current_block["items"].append(number_match.group(1).strip())
            continue

        # Default: treat as paragraph
        flush_current_block()
        current_block = {"type": "paragraph", "text": line}
        flush_current_block()
        current_block = None

    flush_current_block()

    # Debug output to help troubleshoot
    logger.info(f"[DEBUG] Parsed {len(blocks)} blocks from summary")
    for i, block in enumerate(blocks):
        if block["type"] == "list":
            logger.info(f"Block {i}: {block['type']} ({block['style']}) with {len(block['items'])} items")
        else:
            logger.info(f"Block {i}: {block['type']}")
    
    return blocks


def format_summary_for_text_export(summary_text: str) -> str:
    """
    Format summary text specifically for TXT and DOCX exports with proper line breaks.
    """
    formatted_text = _format_summary_text(summary_text)
    
    # Add extra spacing for better readability in text formats
    lines = formatted_text.split('\n')
    formatted_lines = []
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Add extra space before section headings
        if re.match(r'^\*\*(.+?)\*\*:?$', line):
            if formatted_lines:  # Don't add space before first heading
                formatted_lines.append('')
            formatted_lines.append(line)
            formatted_lines.append('')  # Space after heading
        # Add space before bullet points (but group them together)
        elif re.match(r'^[*•-]\s+', line):
            # Check if previous line was also a bullet point
            if formatted_lines and not re.match(r'^[*•-]\s+', formatted_lines[-1]):
                formatted_lines.append('')  # Space before first bullet in group
            formatted_lines.append(line)
        else:
            # Regular paragraph
            if formatted_lines:
                formatted_lines.append('')
            formatted_lines.append(line)
    
    return '\n'.join(formatted_lines)