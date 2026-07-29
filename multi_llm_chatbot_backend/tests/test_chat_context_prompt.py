import os
import unittest

os.environ.setdefault("GEMINI_API_KEY", "test-key")

from app.api.routes.chat import (
    _base_grounding,
    _build_student_context_prompt,
    _is_memory_eligible,
)
from app.models.chat import ChatMessage
from app.models.user import User


class TestChatContextPrompt(unittest.TestCase):

    def test_grounding_names_specific_plan_milestones(self):
        grounding = _base_grounding(
            {
                "chat_context": {"type": "automatic", "title": "My Plan"},
                "roadmap": {
                    "status_last_updated": "2026-07-18T12:00:00Z",
                    "current_step": {
                        "title": "Complete Technical/Education Coursework Bins",
                        "status": "current",
                    },
                    "steps": [
                        {
                            "title": "Complete Technical/Education Coursework Bins",
                            "status": "current",
                        },
                        {
                            "title": "Complete Comprehensive Examination",
                            "status": "upcoming",
                        },
                    ],
                },
            },
            "What edits should I make to my plan?",
        )

        self.assertEqual(grounding["plan_context"]["label"], "My Plan")
        self.assertEqual(
            [item["title"] for item in grounding["plan_context"]["items"]],
            [
                "Complete Technical/Education Coursework Bins",
                "Complete Comprehensive Examination",
            ],
        )
        self.assertEqual(
            grounding["plan_context"]["status_last_updated"],
            "2026-07-18T12:00:00Z",
        )

    def test_generic_plan_existence_is_not_shown_for_document_question(self):
        grounding = _base_grounding(
            {
                "chat_context": {"type": "automatic", "title": "My Plan"},
                "roadmap": {
                    "current_step": {"title": "Coursework", "status": "current"},
                    "steps": [{"title": "Coursework", "status": "current"}],
                },
            },
            "What are the weakest sections of my dissertation outline?",
        )

        self.assertIsNone(grounding["plan_context"])

    def test_defense_practice_is_never_eligible_for_durable_memory(self):
        message = ChatMessage(
            user_input="Debrief this simulated question.",
            context_source="defense_practice",
            eligible_for_memory=True,
        )

        self.assertFalse(_is_memory_eligible(message, "defense_practice"))

    def test_explicit_memory_opt_out_is_honored(self):
        message = ChatMessage(
            user_input="Do not remember this.",
            eligible_for_memory=False,
        )

        self.assertFalse(_is_memory_eligible(message, None))

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

    def test_automatic_context_exposes_complete_plan_without_manual_focus(self):
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )
        context = {
            "chat_context": {"type": "automatic", "title": "My Plan"},
            "profile": {},
            "roadmap": {
                "current_step": {
                    "title": "Maintain recurring advising practices",
                    "status": "current",
                },
                "steps": [
                    {
                        "step_number": 1,
                        "title": "Maintain recurring advising practices",
                        "status": "current",
                        "phase": "Advising",
                        "objective": "Build a reliable meeting cadence.",
                    },
                    {
                        "step_number": 2,
                        "title": "Draft the proposal",
                        "status": "upcoming",
                        "phase": "Proposal",
                        "objective": "Develop the dissertation proposal.",
                    },
                ],
            },
        }

        prompt = _build_student_context_prompt(context, user)

        self.assertIn("Only the current and query-relevant plan details", prompt)
        self.assertIn("Relevant plan milestones:", prompt)
        self.assertIn("Step 2: Draft the proposal", prompt)
        self.assertNotIn("Complete plan:", prompt)
        self.assertNotIn("Current conversation focus:", prompt)

    def test_automatic_context_filters_plan_and_includes_tasks_and_deadlines(self):
        user = User(
            firstName="Ada",
            lastName="Lovelace",
            email="ada@example.com",
            hashed_password="hashed",
        )
        context = {
            "chat_context": {"type": "automatic", "title": "My Plan"},
            "profile": {},
            "roadmap": {
                "current_step": {"title": "Draft the proposal", "status": "current"},
                "steps": [
                    {
                        "step_number": 1,
                        "title": "Draft the proposal",
                        "status": "current",
                        "phase": "Proposal",
                        "objective": "Complete the proposal.",
                        "subtasks": ["Clarify the methods section"],
                    },
                    {
                        "step_number": 2,
                        "title": "Submit the IRB protocol",
                        "status": "upcoming",
                        "phase": "Research",
                        "objective": "Obtain ethics approval.",
                    },
                    {
                        "step_number": 3,
                        "title": "Prepare for the defense",
                        "status": "upcoming",
                        "phase": "Defense",
                        "objective": "Rehearse the presentation.",
                    },
                ],
            },
            "tasks": [{
                "title": "Clarify the methods section",
                "milestone": "Draft the proposal",
                "status": "open",
            }],
            "deadlines": [{
                "label": "Proposal submission",
                "date": "2026-09-15",
                "time": "17:00",
            }],
        }

        prompt = _build_student_context_prompt(
            context,
            user,
            "Help me strengthen the proposal methods section",
        )

        self.assertIn("Step 1: Draft the proposal", prompt)
        self.assertNotIn("Prepare for the defense", prompt)
        self.assertIn("Relevant existing tasks:", prompt)
        self.assertIn("Clarify the methods section", prompt)
        self.assertIn("Nearest recorded deadlines:", prompt)
        self.assertIn("Proposal submission", prompt)


if __name__ == "__main__":
    unittest.main()
