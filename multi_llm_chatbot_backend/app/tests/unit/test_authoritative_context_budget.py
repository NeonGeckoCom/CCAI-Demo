import unittest

from app.core.context_manager import ContextManager


class TestAuthoritativeContextBudget(unittest.TestCase):
    def test_prebudgeted_chat_context_is_formatted_without_second_trimming(self):
        manager = ContextManager(max_context_tokens=50)
        messages = [
            {
                "role": "system",
                "content": "Required document evidence " * 100,
                "_context_budgeted": True,
            },
            {"role": "user", "content": "Review my outline."},
        ]

        prepared = manager.prepare_context_for_llm(
            messages,
            "Pinned advisor instructions",
            "gemini",
        )

        payload = " ".join(
            part["text"]
            for message in prepared.messages
            for part in message.get("parts", [])
        )
        self.assertIn("Required document evidence", payload)
        self.assertIn("Review my outline.", payload)
        self.assertFalse(prepared.truncated)
        self.assertNotIn("_context_budgeted", str(prepared.messages))


if __name__ == "__main__":
    unittest.main()
