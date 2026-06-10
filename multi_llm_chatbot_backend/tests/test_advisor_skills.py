import json
import shutil
import tempfile
import unittest
from pathlib import Path

from app.advisor_skills import registry
from app.advisor_skills.registry import ADVISOR_SKILLS
from app.llm.classifier import classify_advisor_skill


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
        with isolated_skill_registry() as skill_dir:
            result = await classify_advisor_skill(
                FakeClassifierLLM(
                    '{"skill_id": "other", "confidence": 0.42, '
                    '"reason": "Maybe a new pattern."}'
                ),
                "Can you invent a new advising mode for this?",
            )

            self.assertEqual(result.skill_id, "quick_advice")
            self.assertEqual(len(list(skill_dir.glob("custom_*.md"))), 0)

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

        with isolated_skill_registry() as skill_dir:
            result = await classify_advisor_skill(
                FakeClassifierLLM(
                    [
                        '{"skill_id": "other", "confidence": 0.55, '
                        '"reason": "Existing skills do not focus on rhetorical stance."}',
                        json.dumps(skill_spec),
                    ]
                ),
                "Should my introduction sound persuasive, cautious, or bold?",
            )

            self.assertEqual(result.skill_id, "custom_rhetorical_stance_calibration")
            self.assertIn(result.skill_id, ADVISOR_SKILLS)
            self.assertTrue((skill_dir / "custom_rhetorical_stance_calibration.md").exists())
            self.assertEqual(ADVISOR_SKILLS[result.skill_id].headings, ["Stance diagnosis", "Language moves"])
            self.assertEqual(result.recommended_advisors, ["critic", "storyteller"])

    async def test_invalid_llm_response_defaults_to_quick_advice(self):
        result = await classify_advisor_skill(
            FakeClassifierLLM('{"skill_id": "not_a_skill"}'),
            "Can you review my chapter?",
            has_documents=True,
        )

        self.assertEqual(result.skill_id, "quick_advice")
        self.assertEqual(result.confidence, 0.0)


class isolated_skill_registry:
    def __enter__(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name)
        self.original_dir = registry.SKILLS_DIR
        self.original_skills = dict(registry.ADVISOR_SKILLS)
        for source in self.original_dir.glob("*.md"):
            shutil.copy(source, self.path / source.name)
        registry.SKILLS_DIR = self.path
        registry.reload_advisor_skills()
        return self.path

    def __exit__(self, exc_type, exc, tb):
        registry.SKILLS_DIR = self.original_dir
        registry.ADVISOR_SKILLS.clear()
        registry.ADVISOR_SKILLS.update(self.original_skills)
        self._tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
