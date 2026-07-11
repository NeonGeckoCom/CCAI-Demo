import os
import unittest

os.environ.setdefault("GEMINI_API_KEY", "test-key")

from app.api.routes.chat import _build_student_context_prompt
from app.models.user import User


class TestChatContextPrompt(unittest.TestCase):

    def test_placeholder_program_falls_back_to_roadmap_program(self):
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
            academicStage="string",
            researchArea="string",
        )
        context = {
            "profile": {
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "institution": "string",
                "program": "string",
                "stage": "string",
            },
            "roadmap": {
                "program": {
                    "name": "PhD, Information Science",
                    "institution": "University of Colorado Boulder",
                },
                "current_step": {"title": "Own the Literature"},
                "conversation_focus": {"title": "Own the Literature"},
            },
        }

        prompt = _build_student_context_prompt(context, user)

        self.assertIn("- Program: PhD, Information Science", prompt)
        self.assertIn("- Institution: University of Colorado Boulder", prompt)
        self.assertNotIn("- Program: string", prompt)
        self.assertNotIn("- Institution: string", prompt)
        self.assertNotIn("- Stage: string", prompt)

    def test_placeholder_research_area_is_not_used_as_program(self):
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
            researchArea="string",
        )

        prompt = _build_student_context_prompt({"profile": {}, "roadmap": {}}, user)

        self.assertIn("- Program: ", prompt)
        self.assertNotIn("- Program: string", prompt)


if __name__ == "__main__":
    unittest.main()
