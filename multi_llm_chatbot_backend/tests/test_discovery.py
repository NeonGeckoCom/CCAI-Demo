import os
import unittest

# Importing an API route initializes the configured provider; extraction tests
# replace the client before any network call.
os.environ.setdefault("GEMINI_API_KEY", "test-key")

from app.api.routes.discovery import (
    PlanTool,
    extract_plan_with_direct_llm,
    normalize_llm_deliverables,
)


class FakeLlmClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.response, list):
            index = min(len(self.calls) - 1, len(self.response) - 1)
            return self.response[index]
        return self.response


class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_direct_llm_generates_plan_steps_from_full_material(self):
        llm = FakeLlmClient(
            """```json
            {
              "degree":"PhD, Information Science",
              "institution":"Example University",
              "deliverables":[{
                "name":"Community Research Portfolio Review",
                "when":"Before dissertation fieldwork",
                "source":"handbook.pdf"
              }],
              "steps":[{
                "title":"Community Research Portfolio Review",
                "phase":"Research",
                "objective":"Complete the portfolio review before fieldwork.",
                "estimate":"Before dissertation fieldwork",
                "gate":true,
                "deliverable":"Community Research Portfolio Review",
                "source":"handbook.pdf",
                "subtasks":["Confirm format", "Prepare portfolio", "Submit review packet"],
                "add":["meeting-prep", "not-a-real-tool"],
                "retire":[],
                "icon":"ClipboardCheck"
              }]
            }
            ```"""
        )

        result = await extract_plan_with_direct_llm(
            [
                {
                    "source": "handbook.pdf",
                    "text": "FULL HANDBOOK TEXT. Students complete the Community Research Portfolio Review before fieldwork.",
                    "file_type": "pdf",
                }
            ],
            "PhD, Information Science",
            "Example University",
            llm_client=llm,
            tools=[
                PlanTool(id="meeting-prep", name="Meeting Agenda", blurb="Agenda and asks"),
                PlanTool(id="qa-simulator", name="Q&A Simulator", blurb="Practice questions"),
            ],
        )

        self.assertEqual(result["deliverables"][0]["name"], "Community Research Portfolio Review")
        self.assertEqual(result["steps"][0]["subtasks"], ["Confirm format", "Prepare portfolio", "Submit review packet"])
        self.assertEqual(result["steps"][0]["add"], ["meeting-prep"])
        self.assertEqual(llm.calls[0]["response_mime_type"], "application/json")
        self.assertIn("FULL HANDBOOK TEXT", llm.calls[0]["context"][0]["content"])
        self.assertIn("[SOURCE: handbook.pdf]", llm.calls[0]["context"][0]["content"])

    async def test_invalid_llm_output_returns_none(self):
        llm = FakeLlmClient("not json")

        result = await extract_plan_with_direct_llm(
            [{"source": "rules.txt", "text": "A formal review is required."}],
            "PhD",
            "Example University",
            llm_client=llm,
            tools=[PlanTool(id="meeting-prep", name="Meeting Agenda")],
        )

        self.assertIsNone(result)
        self.assertEqual(len(llm.calls), 2)

    async def test_direct_llm_retries_invalid_response_with_full_material(self):
        llm = FakeLlmClient(
            [
                "not json",
                """{
                  "steps":[{
                    "title":"Diagnostic exam",
                    "phase":"Assessment",
                    "estimate":"First year",
                    "source":"rules.txt",
                    "subtasks":["Register for the exam", "Complete the exam"],
                    "add":["qa-simulator"]
                  }]
                }""",
            ]
        )

        result = await extract_plan_with_direct_llm(
            [{"source": "rules.txt", "text": "FULL RULE TEXT. Students must pass a diagnostic exam in the first year."}],
            "PhD",
            "Example University",
            llm_client=llm,
            tools=[PlanTool(id="qa-simulator", name="Q&A Simulator")],
        )

        self.assertEqual(result["steps"][0]["title"], "Diagnostic exam")
        self.assertEqual(result["steps"][0]["add"], ["qa-simulator"])
        self.assertEqual(len(llm.calls), 2)
        self.assertIn("FULL RULE TEXT", llm.calls[1]["context"][0]["content"])

    async def test_direct_llm_retries_compressed_full_handbook_plan(self):
        def plan_with_steps(count):
            steps = []
            for index in range(count):
                number = index + 1
                steps.append(
                    {
                        "title": f"Requirement {number}",
                        "phase": "Program",
                        "estimate": "Required",
                        "source": "handbook.pdf",
                        "subtasks": [f"Complete requirement {number}"],
                        "add": ["meeting-prep"],
                    }
                )
            return {"steps": steps}

        llm = FakeLlmClient(
            [
                str(plan_with_steps(5)).replace("'", '"'),
                str(plan_with_steps(7)).replace("'", '"'),
            ]
        )
        long_handbook_text = "Students must complete several distinct handbook requirements. " * 300

        result = await extract_plan_with_direct_llm(
            [{"source": "handbook.pdf", "text": long_handbook_text}],
            "PhD",
            "Example University",
            llm_client=llm,
            tools=[PlanTool(id="meeting-prep", name="Meeting Agenda")],
        )

        self.assertEqual(len(result["steps"]), 7)
        self.assertEqual(len(llm.calls), 2)
        self.assertIn("too compressed", llm.calls[1]["context"][0]["content"])
        self.assertIn("Students must complete several distinct handbook requirements.", llm.calls[1]["context"][0]["content"])

    async def test_direct_llm_rejects_still_compressed_full_handbook_plan(self):
        def plan_with_steps(count):
            return {
                "steps": [
                    {
                        "title": f"Requirement {index + 1}",
                        "phase": "Program",
                        "estimate": "Required",
                        "source": "handbook.pdf",
                        "subtasks": [f"Complete requirement {index + 1}"],
                        "add": ["meeting-prep"],
                    }
                    for index in range(count)
                ]
            }

        llm = FakeLlmClient(
            [
                str(plan_with_steps(5)).replace("'", '"'),
                str(plan_with_steps(3)).replace("'", '"'),
            ]
        )
        long_handbook_text = "Students must complete several distinct handbook requirements. " * 300

        result = await extract_plan_with_direct_llm(
            [{"source": "handbook.pdf", "text": long_handbook_text}],
            "PhD",
            "Example University",
            llm_client=llm,
            tools=[PlanTool(id="meeting-prep", name="Meeting Agenda")],
        )

        self.assertIsNone(result)
        self.assertEqual(len(llm.calls), 2)

    async def test_direct_llm_marks_handbook_requirements_as_gates(self):
        llm = FakeLlmClient(
            """{
              "steps":[{
                "title":"Research Seminar",
                "phase":"Year 1",
                "estimate":"First year",
                "source":"handbook.pdf",
                "gate":false,
                "subtasks":["Enroll in seminar", "Complete seminar"],
                "add":["meeting-prep"]
              }]
            }"""
        )

        result = await extract_plan_with_direct_llm(
            [{"source": "handbook.pdf", "text": "Students must complete the research seminar."}],
            "PhD",
            "Example University",
            llm_client=llm,
            tools=[PlanTool(id="meeting-prep", name="Meeting Agenda")],
        )

        self.assertIs(result["steps"][0]["gate"], True)

    async def test_direct_llm_accepts_milestones_schema_variant(self):
        llm = FakeLlmClient(
            """{
              "milestones":[{
                "name":"Portfolio review",
                "when":"Year 2",
                "source":"handbook.pdf",
                "steps_to_complete":["Confirm portfolio format", "Submit review packet"],
                "tools":["meeting-prep"]
              }]
            }"""
        )

        result = await extract_plan_with_direct_llm(
            [{"source": "handbook.pdf", "text": "Students submit a portfolio review in Year 2."}],
            "PhD",
            "Example University",
            llm_client=llm,
            tools=[PlanTool(id="meeting-prep", name="Meeting Prep")],
        )

        self.assertEqual(result["deliverables"][0]["name"], "Portfolio review")
        self.assertEqual(result["steps"][0]["subtasks"], ["Confirm portfolio format", "Submit review packet"])
        self.assertEqual(result["steps"][0]["add"], ["meeting-prep"])

    def test_llm_sources_are_constrained_to_uploaded_files(self):
        result = normalize_llm_deliverables(
            {
                "deliverables": [
                    {
                        "name": "Portfolio review",
                        "when": "Year 2",
                        "source": "invented-source.pdf",
                    }
                ]
            },
            ["actual-handbook.pdf"],
        )

        self.assertEqual(result[0]["source"], "actual-handbook.pdf")


if __name__ == "__main__":
    unittest.main()
