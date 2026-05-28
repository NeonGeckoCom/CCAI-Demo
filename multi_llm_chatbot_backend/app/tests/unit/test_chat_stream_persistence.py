import unittest

from bson import ObjectId

from app.models.user import PersistMessage


# ------------------------------------------------------------------
# PersistMessage – advisor type
# ------------------------------------------------------------------


ADVISOR_REQUIRED_FIELDS = {"id", "type", "persona_id", "advisorName", "content",
                           "used_documents", "document_chunks_used"}


class TestAdvisorPersistMessage(unittest.TestCase):

    def test_includes_all_required_fields(self):
        msg = PersistMessage(
            type="advisor",
            persona_id="advisor_a",
            advisorName="Advisor A",
            content="Some advice.",
        ).model_dump(exclude_none=True)
        self.assertTrue(ADVISOR_REQUIRED_FIELDS.issubset(msg.keys()),
                        f"Missing fields: {ADVISOR_REQUIRED_FIELDS - msg.keys()}")

    def test_type_is_advisor(self):
        msg = PersistMessage(
            type="advisor", persona_id="x", advisorName="X", content="c",
        )
        self.assertEqual(msg.type, "advisor")

    def test_advisor_name_stored(self):
        msg = PersistMessage(
            type="advisor",
            persona_id="methodologist",
            advisorName="Dr. Method",
            content="content",
        )
        self.assertEqual(msg.advisorName, "Dr. Method")
        self.assertEqual(msg.persona_id, "methodologist")

    def test_defaults_for_document_fields(self):
        msg = PersistMessage(
            type="advisor", persona_id="x", advisorName="X", content="c",
        )
        self.assertFalse(msg.used_documents)
        self.assertEqual(msg.document_chunks_used, 0)

    def test_explicit_document_fields(self):
        msg = PersistMessage(
            type="advisor",
            persona_id="x",
            advisorName="X",
            content="c",
            used_documents=True,
            document_chunks_used=5,
        )
        self.assertTrue(msg.used_documents)
        self.assertEqual(msg.document_chunks_used, 5)

    def test_id_is_valid_objectid_string(self):
        msg = PersistMessage(
            type="advisor", persona_id="x", advisorName="X", content="c",
        )
        ObjectId(msg.id)

    def test_each_call_generates_unique_id(self):
        ids = {
            PersistMessage(
                type="advisor", persona_id="x", advisorName="X", content="c",
            ).id
            for _ in range(10)
        }
        self.assertEqual(len(ids), 10)

    def test_reply_flag(self):
        msg = PersistMessage(
            type="advisor",
            persona_id="x",
            advisorName="X",
            content="c",
            isReply=True,
        )
        self.assertTrue(msg.isReply)

    def test_orchestrator_message_shape(self):
        msg = PersistMessage(
            type="advisor",
            persona_id="orchestrator",
            advisorName="Orchestrator",
            content="Tool output here",
        )
        self.assertEqual(msg.persona_id, "orchestrator")
        self.assertEqual(msg.advisorName, "Orchestrator")
        self.assertEqual(msg.content, "Tool output here")
        self.assertEqual(msg.type, "advisor")

    def test_expansion_flag(self):
        msg = PersistMessage(
            type="advisor",
            persona_id="theorist",
            advisorName="Dr. Theory",
            content="Here is a deeper explanation...",
            isExpansion=True,
        )
        self.assertEqual(msg.type, "advisor")
        self.assertTrue(msg.isExpansion)
        self.assertEqual(msg.persona_id, "theorist")


# ------------------------------------------------------------------
# PersistMessage – user type
# ------------------------------------------------------------------


USER_REQUIRED_FIELDS = {"id", "type", "content"}


class TestUserPersistMessage(unittest.TestCase):

    def test_includes_required_fields(self):
        msg = PersistMessage(type="user", content="hello").model_dump(exclude_none=True)
        self.assertTrue(USER_REQUIRED_FIELDS.issubset(msg.keys()),
                        f"Missing fields: {USER_REQUIRED_FIELDS - msg.keys()}")

    def test_type_is_user(self):
        msg = PersistMessage(type="user", content="hello")
        self.assertEqual(msg.type, "user")

    def test_content_preserved(self):
        msg = PersistMessage(type="user", content="Tell me more")
        self.assertEqual(msg.content, "Tell me more")

    def test_id_is_valid_objectid_string(self):
        msg = PersistMessage(type="user", content="hello")
        ObjectId(msg.id)

    def test_each_call_generates_unique_id(self):
        ids = {
            PersistMessage(type="user", content="hello").id
            for _ in range(10)
        }
        self.assertEqual(len(ids), 10)

    def test_reply_to_metadata(self):
        msg = PersistMessage(
            type="user",
            content="I disagree",
            replyTo={
                "advisorId": "methodologist",
                "messageId": "msg_123",
            },
        )
        self.assertEqual(msg.replyTo["advisorId"], "methodologist")
        self.assertEqual(msg.replyTo["messageId"], "msg_123")

    def test_plain_message_has_no_replyTo(self):
        msg = PersistMessage(type="user", content="hello").model_dump(exclude_none=True)
        self.assertNotIn("replyTo", msg)

    def test_expand_request_shape(self):
        msg = PersistMessage(
            type="user",
            content="Please expand on your previous response...",
            isExpandRequest=True,
        )
        self.assertEqual(msg.type, "user")
        self.assertTrue(msg.isExpandRequest)


# ------------------------------------------------------------------
# PersistMessage – error type
# ------------------------------------------------------------------


class TestErrorPersistMessage(unittest.TestCase):

    def test_type_is_error(self):
        msg = PersistMessage(type="error", content="Something went wrong")
        self.assertEqual(msg.type, "error")

    def test_error_code(self):
        msg = PersistMessage(
            type="error",
            content="No advisors available",
            code="NO_ADVISORS_AVAILABLE",
        )
        self.assertEqual(msg.code, "NO_ADVISORS_AVAILABLE")

    def test_error_without_code(self):
        msg = PersistMessage(type="error", content="Generic error")
        self.assertIsNone(msg.code)


# ------------------------------------------------------------------
# PersistMessage – type validation
# ------------------------------------------------------------------


class TestPersistMessageTypeValidation(unittest.TestCase):

    def test_rejects_invalid_type(self):
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            PersistMessage(type="bogus", content="hello")

    def test_all_valid_types_accepted(self):
        for t in ("user", "advisor", "error", "clarification", "document_upload", "system"):
            msg = PersistMessage(type=t, content="test")
            self.assertEqual(msg.type, t)
