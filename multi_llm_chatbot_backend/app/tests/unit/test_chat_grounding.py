import unittest
from types import SimpleNamespace

from app.llm.responses import (
    _document_sources,
    _response_grounding,
    _split_grounding_sections,
)
from app.models.chat import ChatMessage


class TestChatGrounding(unittest.TestCase):
    def test_extracts_structured_document_sources(self):
        context = """
        === FROM DOCUMENT: Proposal.docx ===
        === SOURCE METADATA: {"file_id":"doc-1","file_type":"docx","filename":"Proposal.docx","page_numbers":[],"slide_numbers":[],"sections":["1.4 Research questions"],"version_or_upload_date":"2026-07-18T12:00:00Z","open_route":"/api/library/documents/doc-1"} ===
        [Document excerpt]
        === FROM DOCUMENT: Notes.pdf ===
        [Document excerpt]
        === FROM DOCUMENT: Proposal.docx ===
        [Document excerpt]
        """
        sources = _document_sources(context)
        self.assertEqual([source["filename"] for source in sources], [
            "Proposal.docx",
            "Notes.pdf",
        ])
        self.assertEqual(sources[0]["file_id"], "doc-1")
        self.assertEqual(sources[0]["sections"], ["1.4 Research questions"])
        self.assertEqual(
            sources[0]["open_route"],
            "/api/library/documents/doc-1",
        )

    def test_moves_assumptions_and_verify_out_of_answer(self):
        response = """### Recommendation
Do the next concrete task.

### Important assumptions
- Your meeting is next week.

### Information to verify
- Confirm the deadline with your program."""
        answer, assumptions, verify = _split_grounding_sections(response)
        self.assertNotIn("Important assumptions", answer)
        self.assertEqual(assumptions, ["Your meeting is next week."])
        self.assertEqual(verify, ["Confirm the deadline with your program."])

    def test_general_guidance_only_without_specific_context(self):
        session = SimpleNamespace(response_grounding={
            "plan_context": "",
            "meeting_notes": [],
        })
        grounding = _response_grounding(session, "", [], [])
        self.assertTrue(grounding["general_guidance_only"])

    def test_visible_document_sources_are_limited_to_included_evidence(self):
        session = SimpleNamespace(
            uploaded_files=["Outline.docx", "Handbook.pdf"],
            response_grounding={"plan_context": ""},
        )
        included = """
        === FROM DOCUMENT: Outline.docx ===
        === SOURCE METADATA: {"file_id":"outline-id","file_type":"docx","filename":"Outline.docx","page_numbers":[],"slide_numbers":[],"sections":["1.4"],"version_or_upload_date":"","open_route":"/api/library/documents/outline-id"} ===
        [Document excerpt]
        """
        retrieved = included + """
        === FROM DOCUMENT: Handbook.pdf ===
        [Document excerpt]
        """

        grounding = _response_grounding(
            session,
            included,
            [],
            [],
            retrieved_document_context=retrieved,
            response="According to Outline.docx, the structure needs revision.",
        )

        self.assertEqual(
            [source["filename"] for source in grounding["uploaded_documents"]],
            ["Outline.docx"],
        )
        self.assertEqual(
            [
                source["filename"]
                for source in grounding["document_source_states"]["retrieved"]
            ],
            ["Outline.docx", "Handbook.pdf"],
        )
        self.assertEqual(
            [
                source["filename"]
                for source in grounding["document_source_states"]["included"]
            ],
            ["Outline.docx"],
        )
        self.assertEqual(
            [
                source["filename"]
                for source in grounding["document_source_states"]["cited"]
            ],
            ["Outline.docx"],
        )

    def test_retry_request_contract(self):
        message = ChatMessage(
            user_input="Try this again",
            active_advisors=["critical_reviewer"],
            retry_of_message_id="answer-1",
            retry_user_input="Review my claim",
        )
        self.assertEqual(message.retry_of_message_id, "answer-1")
        self.assertEqual(message.active_advisors, ["critical_reviewer"])


if __name__ == "__main__":
    unittest.main()
