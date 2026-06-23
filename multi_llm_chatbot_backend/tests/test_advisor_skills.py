import json
import unittest
from unittest.mock import AsyncMock, patch

from app.advisor_skills.registry import ADVISOR_SKILLS, build_generated_advisor_skill
from app.llm.classifier import classify_advisor_skill, draft_advisor_skill_spec


BUILT_IN_SKILL_IDS = {
    "quick_advice",
    "deep_review",
    "action_plan",
    "socratic_coaching",
    "document_feedback",
    "committee_prep",
    "research_design_review",
}


class FakeClassifierLLM:
    def __init__(self, response):
        self.responses = response if isinstance(response, list) else [response]
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


class AdvisorSkillClassifierTests(unittest.IsolatedAsyncioTestCase):
    def test_all_advisor_skills_are_registered(self):
        self.assertTrue(BUILT_IN_SKILL_IDS.issubset(set(ADVISOR_SKILLS)))
        generated_ids = set(ADVISOR_SKILLS) - BUILT_IN_SKILL_IDS
        self.assertTrue(all(skill_id.startswith("custom_") for skill_id in generated_ids))

    def test_advisor_skills_are_markdown_backed(self):
        for skill in ADVISOR_SKILLS.values():
            self.assertEqual(skill.source_path.suffix, ".md")
            self.assertIn("# ", skill.markdown)
            self.assertTrue(skill.prompt_contract("medium", "</END>"))
            self.assertIn("not a fill-in template", skill.prompt_contract("medium", "</END>"))
            self.assertIn("summarize or explain what a document says", skill.prompt_contract("medium", "</END>"))

    async def test_llm_classification_is_used(self):
        llm = FakeClassifierLLM(
            '{"skill_id": "committee_prep", "confidence": 0.91, '
            '"reason": "The student is preparing for a defense.", '
            '"secondary_skill_ids": ["research_design_review"]}'
        )

        result = await classify_advisor_skill(
            llm,
            "What questions might they ask at my proposal defense?",
            has_documents=False,
        )

        self.assertEqual(result.skill_id, "committee_prep")
        self.assertEqual(result.confidence, 0.91)
        self.assertEqual(result.secondary_skill_ids, ["research_design_review"])
        self.assertTrue(llm.calls)
        prompt = llm.calls[0]["system_prompt"]
        self.assertIn("- committee_prep (Committee Prep)", prompt)
        self.assertIn("How it works:", prompt)
        self.assertIn("Useful response moves:", prompt)

    async def test_broad_need_can_draft_valid_skill_spec(self):
        llm = FakeClassifierLLM(
            json.dumps({
                "id": "advisor_feedback_triage",
                "name": "Advisor Feedback Triage",
                "description": "Helps turn scattered advisor comments into a prioritized revision plan.",
                "use_when": "Use when the student needs to interpret, prioritize, or act on advisor feedback.",
                "how_to_work": [
                    "Identify the main workstreams in the feedback.",
                    "Separate urgent changes from lower-priority refinements.",
                    "Give the student a short next-action plan.",
                ],
                "response_moves": [
                    {
                        "heading": "Feedback map",
                        "instruction": "Group the comments by theme and urgency.",
                    },
                    {
                        "heading": "Revision priorities",
                        "instruction": "Name the changes that should happen first.",
                    },
                ],
                "format_guidance": "Use bullets for action items and short paragraphs for explanation.",
                "preferred_advisors": ["critic", "pragmatist"],
                "rag_policy": "optional",
                "token_budgets": {"short": 650, "medium": 1000, "long": 1500},
            })
        )

        spec = await draft_advisor_skill_spec(
            llm,
            "I get scattered advisor comments and need help turning them into revision priorities.",
            skills=dict(ADVISOR_SKILLS),
        )

        self.assertEqual(spec["id"], "advisor_feedback_triage")
        self.assertEqual(spec["name"], "Advisor Feedback Triage")
        self.assertEqual(spec["response_moves"][0]["heading"], "Feedback map")
        self.assertIn("everyday-language need", llm.calls[0]["system_prompt"])
        self.assertIn("scattered advisor comments", llm.calls[0]["context"][0]["content"])

    async def test_llm_classification_can_request_clarification(self):
        llm = FakeClassifierLLM(
            json.dumps({
                "needs_clarification": True,
                "clarification_reason": "The message is too vague to route.",
                "clarification_question": "What part of your PhD work should we focus on?",
                "clarification_suggestions": [
                    "I need help refining my research question.",
                    "I need help planning my next committee meeting.",
                    "I need help choosing a method for my study.",
                    "I need help turning advisor feedback into next steps.",
                ],
                "skill_id": "quick_advice",
                "confidence": 0.0,
                "reason": "Clarification should happen before advisor routing.",
                "secondary_skill_ids": [],
            })
        )

        result = await classify_advisor_skill(
            llm,
            "help",
            has_documents=False,
        )

        self.assertTrue(result.needs_clarification)
        self.assertEqual(result.skill_id, "quick_advice")
        self.assertEqual(result.clarification_reason, "The message is too vague to route.")
        self.assertEqual(result.clarification_question, "What part of your PhD work should we focus on?")
        self.assertEqual(len(result.clarification_suggestions), 4)
        prompt = llm.calls[0]["system_prompt"]
        self.assertIn("needs_clarification", prompt)
        self.assertIn("clarification_suggestions", prompt)

    async def test_clarification_can_be_disabled_for_followups(self):
        llm = FakeClassifierLLM(
            json.dumps({
                "needs_clarification": True,
                "clarification_reason": "The model wanted clarification.",
                "clarification_question": "What do you mean?",
                "clarification_suggestions": ["I mean my methods.", "I mean my timeline."],
                "skill_id": "quick_advice",
                "confidence": 0.8,
                "reason": "Follow-up routing should continue.",
            })
        )

        result = await classify_advisor_skill(
            llm,
            "What about that?",
            allow_clarification=False,
        )

        self.assertFalse(result.needs_clarification)
        self.assertEqual(result.skill_id, "quick_advice")

    async def test_classifier_prompt_names_other_boundary_examples(self):
        llm = FakeClassifierLLM(
            '{"skill_id": "quick_advice", "confidence": 0.8, '
            '"reason": "Small orientation question."}'
        )

        await classify_advisor_skill(
            llm,
            "What is one thing I should do this week?",
            has_documents=False,
        )

        prompt = llm.calls[0]["system_prompt"]
        self.assertIn("Choose other for publication workflows", prompt)
        self.assertIn("Choose other for authorship, credit, contribution", prompt)
        self.assertIn("Choose other for academic job-market materials", prompt)
        self.assertIn("Choose other for audience translation", prompt)
        self.assertIn("Choose other for navigating conflicting faculty advice", prompt)

    async def test_explicit_skill_override_skips_llm(self):
        llm = FakeClassifierLLM('{"skill_id": "quick_advice"}')

        result = await classify_advisor_skill(
            llm,
            "Use the forced mode.",
            requested_skill_id="deep_review",
        )

        self.assertEqual(result.skill_id, "deep_review")
        self.assertEqual(result.confidence, 1.0)
        self.assertEqual(llm.calls, [])

    async def test_no_llm_defaults_to_quick_advice(self):
        result = await classify_advisor_skill(
            None,
            "How should I think about my first semester?",
        )

        self.assertEqual(result.skill_id, "quick_advice")
        self.assertEqual(result.confidence, 0.0)

    async def test_other_with_low_confidence_does_not_generate_skill(self):
        with patch(
            "app.llm.classifier.get_effective_advisor_skills",
            new=AsyncMock(return_value=dict(ADVISOR_SKILLS)),
        ):
            result = await classify_advisor_skill(
                FakeClassifierLLM(
                    '{"skill_id": "other", "confidence": 0.42, '
                    '"reason": "Maybe a new pattern."}'
                ),
                "Can you invent a new advising mode for this?",
                user_id="64f000000000000000000001",
            )

        self.assertEqual(result.skill_id, "quick_advice")

    async def test_other_generates_and_loads_new_skill(self):
        skill_spec = {
            "id": "rhetorical_stance_calibration",
            "name": "Rhetorical Stance Calibration",
            "description": "Helps tune the intellectual stance of scholarly writing.",
            "use_when": "Use when the student asks how bold, cautious, persuasive, or exploratory their writing should be.",
            "how_to_work": [
                "Identify the stance the audience needs to trust.",
                "Separate confidence from overclaiming.",
                "Give concrete language moves the student can revise into the text.",
            ],
            "headings": [
                {
                    "heading": "Stance diagnosis",
                    "instruction": "Name the stance tension in the student's request.",
                },
                {
                    "heading": "Language moves",
                    "instruction": "Offer concrete phrasing strategies.",
                },
            ],
            "preferred_advisors": ["critic", "storyteller"],
            "rag_policy": "optional",
            "token_budgets": {"short": 650, "medium": 1000, "long": 1500},
        }
        generated_skill = build_generated_advisor_skill(skill_spec)

        async def fake_create(_user_id, _spec):
            self.assertEqual(_user_id, "64f000000000000000000001")
            self.assertEqual(_spec["id"], "rhetorical_stance_calibration")
            return generated_skill

        with patch(
            "app.llm.classifier.get_effective_advisor_skills",
            new=AsyncMock(return_value=dict(ADVISOR_SKILLS)),
        ), patch(
            "app.llm.classifier.create_user_advisor_skill",
            new=AsyncMock(side_effect=fake_create),
        ):
            result = await classify_advisor_skill(
                FakeClassifierLLM(
                    [
                        '{"skill_id": "other", "confidence": 0.55, '
                        '"reason": "Existing skills do not focus on rhetorical stance."}',
                        json.dumps(skill_spec),
                    ]
                ),
                "Should my introduction sound persuasive, cautious, or bold?",
                user_id="64f000000000000000000001",
            )

            self.assertEqual(result.skill_id, "custom_rhetorical_stance_calibration")
            self.assertEqual(result.skill.headings, ["Stance diagnosis", "Language moves"])
            self.assertEqual(result.recommended_advisors, ["critic", "storyteller"])

    async def test_invalid_llm_response_defaults_to_quick_advice(self):
        result = await classify_advisor_skill(
            FakeClassifierLLM('{"skill_id": "not_a_skill"}'),
            "Can you review my chapter?",
            has_documents=True,
        )

        self.assertEqual(result.skill_id, "quick_advice")
        self.assertEqual(result.confidence, 0.0)


if __name__ == "__main__":
    unittest.main()
