import unittest

from bson import ObjectId

# The conftest stubs ``app.api.routes.chat`` with a MagicMock so that other
# test modules can import ``app.api.routes`` without booting the LLM stack.
# Pop the stub so we can import the real helper, then leave the real module
# in sys.modules so it doesn't interfere with other test files.
import sys

sys.modules.pop("app.api.routes.chat", None)

from app.api.routes.chat import build_advisor_persist_message  # noqa: E402


REQUIRED_FIELDS = {"id", "type", "persona_id", "advisorName", "content",
                    "used_documents", "document_chunks_used"}


class TestBuildAdvisorPersistMessage(unittest.TestCase):

    def test_includes_all_required_fields(self):
        msg = build_advisor_persist_message(
            persona_id="advisor_a",
            persona_name="Advisor A",
            content="Some advice.",
        )
        self.assertTrue(REQUIRED_FIELDS.issubset(msg.keys()),
                        f"Missing fields: {REQUIRED_FIELDS - msg.keys()}")

    def test_type_is_advisor(self):
        msg = build_advisor_persist_message(
            persona_id="x", persona_name="X", content="c",
        )
        self.assertEqual(msg["type"], "advisor")

    def test_maps_persona_name_to_advisorName(self):
        msg = build_advisor_persist_message(
            persona_id="methodologist",
            persona_name="Dr. Method",
            content="content",
        )
        self.assertEqual(msg["advisorName"], "Dr. Method")
        self.assertEqual(msg["persona_id"], "methodologist")

    def test_defaults_for_document_fields(self):
        msg = build_advisor_persist_message(
            persona_id="x", persona_name="X", content="c",
        )
        self.assertFalse(msg["used_documents"])
        self.assertEqual(msg["document_chunks_used"], 0)

    def test_explicit_document_fields(self):
        msg = build_advisor_persist_message(
            persona_id="x",
            persona_name="X",
            content="c",
            used_documents=True,
            document_chunks_used=5,
        )
        self.assertTrue(msg["used_documents"])
        self.assertEqual(msg["document_chunks_used"], 5)

    def test_id_is_valid_objectid_string(self):
        msg = build_advisor_persist_message(
            persona_id="x", persona_name="X", content="c",
        )
        ObjectId(msg["id"])  # raises if invalid

    def test_each_call_generates_unique_id(self):
        ids = {
            build_advisor_persist_message(
                persona_id="x", persona_name="X", content="c",
            )["id"]
            for _ in range(10)
        }
        self.assertEqual(len(ids), 10)

    def test_extra_kwargs_included(self):
        msg = build_advisor_persist_message(
            persona_id="x",
            persona_name="X",
            content="c",
            isReply=True,
        )
        self.assertTrue(msg["isReply"])

    def test_orchestrator_message_shape(self):
        msg = build_advisor_persist_message(
            persona_id="orchestrator",
            persona_name="Orchestrator",
            content="Tool output here",
        )
        self.assertEqual(msg["persona_id"], "orchestrator")
        self.assertEqual(msg["advisorName"], "Orchestrator")
        self.assertEqual(msg["content"], "Tool output here")
        self.assertEqual(msg["type"], "advisor")
