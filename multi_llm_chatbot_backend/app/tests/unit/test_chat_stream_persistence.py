import unittest

from bson import ObjectId

# The conftest stubs ``app.api.routes.chat`` with a MagicMock so that other
# test modules can import ``app.api.routes`` without booting the LLM stack.
# Pop the stub so we can import the real helpers, then leave the real module
# in sys.modules so it doesn't interfere with other test files.
import sys

sys.modules.pop("app.api.routes.chat", None)

from app.api.routes.chat import (  # noqa: E402
    build_advisor_persist_message,
    build_user_persist_message,
)


REQUIRED_FIELDS = {"id", "type", "persona_id", "advisorName", "content",
                    "used_documents", "document_chunks_used"}


# ------------------------------------------------------------------
# build_advisor_persist_message
# ------------------------------------------------------------------


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


# ------------------------------------------------------------------
# build_user_persist_message
# ------------------------------------------------------------------

USER_REQUIRED_FIELDS = {"id", "type", "content"}


class TestBuildUserPersistMessage(unittest.TestCase):

    def test_includes_required_fields(self):
        msg = build_user_persist_message(content="hello")
        self.assertTrue(USER_REQUIRED_FIELDS.issubset(msg.keys()),
                        f"Missing fields: {USER_REQUIRED_FIELDS - msg.keys()}")

    def test_type_is_user(self):
        msg = build_user_persist_message(content="hello")
        self.assertEqual(msg["type"], "user")

    def test_content_preserved(self):
        msg = build_user_persist_message(content="Tell me more")
        self.assertEqual(msg["content"], "Tell me more")

    def test_id_is_valid_objectid_string(self):
        msg = build_user_persist_message(content="hello")
        ObjectId(msg["id"])

    def test_each_call_generates_unique_id(self):
        ids = {
            build_user_persist_message(content="hello")["id"]
            for _ in range(10)
        }
        self.assertEqual(len(ids), 10)

    def test_reply_to_metadata_included(self):
        msg = build_user_persist_message(
            content="I disagree",
            replyTo={
                "advisorId": "methodologist",
                "messageId": "msg_123",
            },
        )
        self.assertEqual(msg["replyTo"]["advisorId"], "methodologist")
        self.assertEqual(msg["replyTo"]["messageId"], "msg_123")

    def test_plain_message_has_no_replyTo(self):
        msg = build_user_persist_message(content="hello")
        self.assertNotIn("replyTo", msg)
