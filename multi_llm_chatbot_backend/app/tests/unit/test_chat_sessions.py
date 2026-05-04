import asyncio
import sys
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch, call

from bson import ObjectId
from fastapi import APIRouter, HTTPException

for _name in ("app.core.bootstrap", "app.core.rag_manager"):
    sys.modules.setdefault(_name, MagicMock())

_stub_router_module = MagicMock(router=APIRouter())
for _name in (
    "app.api.routes.chat",
    "app.api.routes.documents",
    "app.api.routes.sessions",
    "app.api.routes.provider",
    "app.api.routes.debug",
    "app.api.routes.root",
    "app.api.routes.phd_canvas",
):
    sys.modules.setdefault(_name, _stub_router_module)

from app.api.routes.chat_sessions import (  # noqa: E402
    CreateChatSessionRequest,
    UpdateChatSessionRequest,
    SaveMessageRequest,
    persist_message,
    create_chat_session,
    get_user_chat_sessions,
    get_chat_sessions_count,
    get_chat_session,
    update_chat_session,
    save_message_to_session,
    delete_all_chat_sessions,
    delete_chat_session,
)
from app.models.user import User  # noqa: E402

FAKE_USER_ID = ObjectId()
OTHER_USER_ID = ObjectId()
FAKE_SESSION_ID = ObjectId()


def _make_fake_user(**overrides):
    defaults = dict(
        _id=FAKE_USER_ID,
        firstName="Test",
        lastName="User",
        email="test@example.com",
        hashed_password="$2b$12$fakehash",
        is_active=True,
        created_at=datetime(2025, 1, 1),
    )
    defaults.update(overrides)
    return User(**defaults)


def _mock_db():
    db = MagicMock()
    db.chat_sessions.insert_one = AsyncMock()
    db.chat_sessions.find_one = AsyncMock()
    db.chat_sessions.update_one = AsyncMock()
    db.chat_sessions.update_many = AsyncMock()
    db.chat_sessions.count_documents = AsyncMock()
    return db


def _make_session_doc(user_id=FAKE_USER_ID, session_id=None, **overrides):
    doc = {
        "_id": session_id or FAKE_SESSION_ID,
        "user_id": user_id,
        "title": "Test Chat",
        "messages": [{"type": "user", "content": "hello"}],
        "created_at": datetime(2025, 6, 1),
        "updated_at": datetime(2025, 6, 1),
        "is_active": True,
    }
    doc.update(overrides)
    return doc


# ------------------------------------------------------------------
# persist_message
# ------------------------------------------------------------------


@patch("app.api.routes.chat_sessions.get_database")
class TestPersistMessage(unittest.TestCase):

    def test_appends_message_with_auto_timestamp(self, mock_get_db):
        db = _mock_db()
        mock_get_db.return_value = db

        msg = {"type": "user", "content": "hello"}
        asyncio.run(persist_message(str(FAKE_SESSION_ID), msg))

        args = db.chat_sessions.update_one.call_args
        pushed = args[0][1]["$push"]["messages"]
        self.assertEqual(pushed["type"], "user")
        self.assertEqual(pushed["content"], "hello")
        self.assertIn("timestamp", pushed)

    def test_preserves_existing_timestamp(self, mock_get_db):
        db = _mock_db()
        mock_get_db.return_value = db

        msg = {"type": "user", "content": "hi", "timestamp": "2025-01-01T00:00:00"}
        asyncio.run(persist_message(str(FAKE_SESSION_ID), msg))

        pushed = db.chat_sessions.update_one.call_args[0][1]["$push"]["messages"]
        self.assertEqual(pushed["timestamp"], "2025-01-01T00:00:00")


# ------------------------------------------------------------------
# POST /chat-sessions (create)
# ------------------------------------------------------------------


@patch("app.api.routes.chat_sessions.get_database")
class TestCreateChatSession(unittest.TestCase):

    def test_creates_session_and_returns_expected_shape(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.insert_one.return_value = MagicMock(inserted_id=FAKE_SESSION_ID)
        mock_get_db.return_value = db

        user = _make_fake_user()
        req = CreateChatSessionRequest(title="My Chat")

        result = asyncio.run(create_chat_session(request=req, current_user=user))

        self.assertEqual(result["id"], str(FAKE_SESSION_ID))
        self.assertEqual(result["title"], "My Chat")
        self.assertEqual(result["message_count"], 0)
        self.assertIn("created_at", result)
        self.assertIn("updated_at", result)

    def test_db_error_returns_500(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.insert_one.side_effect = Exception("DB down")
        mock_get_db.return_value = db

        user = _make_fake_user()
        req = CreateChatSessionRequest(title="Fail")

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(create_chat_session(request=req, current_user=user))

        self.assertEqual(ctx.exception.status_code, 500)


# ------------------------------------------------------------------
# GET /chat-sessions (list)
# ------------------------------------------------------------------


@patch("app.api.routes.chat_sessions.get_database")
class TestGetUserChatSessions(unittest.TestCase):

    def test_returns_sessions_for_user(self, mock_get_db):
        db = _mock_db()
        mock_get_db.return_value = db

        session_doc = _make_session_doc()
        mock_cursor = MagicMock()
        mock_cursor.sort.return_value = mock_cursor
        mock_cursor.skip.return_value = mock_cursor
        mock_cursor.limit.return_value = mock_cursor
        mock_cursor.__aiter__ = lambda self: self
        mock_cursor._items = [session_doc]
        mock_cursor.__anext__ = AsyncMock(
            side_effect=[session_doc, StopAsyncIteration]
        )
        db.chat_sessions.find.return_value = mock_cursor

        user = _make_fake_user()
        result = asyncio.run(get_user_chat_sessions(current_user=user))

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].title, "Test Chat")
        self.assertEqual(result[0].message_count, 1)

    def test_returns_empty_list_when_no_sessions(self, mock_get_db):
        db = _mock_db()
        mock_get_db.return_value = db

        mock_cursor = MagicMock()
        mock_cursor.sort.return_value = mock_cursor
        mock_cursor.skip.return_value = mock_cursor
        mock_cursor.limit.return_value = mock_cursor
        mock_cursor.__aiter__ = lambda self: self
        mock_cursor.__anext__ = AsyncMock(side_effect=StopAsyncIteration)
        db.chat_sessions.find.return_value = mock_cursor

        user = _make_fake_user()
        result = asyncio.run(get_user_chat_sessions(current_user=user))

        self.assertEqual(len(result), 0)


# ------------------------------------------------------------------
# GET /chat-sessions/count
# ------------------------------------------------------------------


@patch("app.api.routes.chat_sessions.get_database")
class TestGetChatSessionsCount(unittest.TestCase):

    def test_returns_correct_count(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.count_documents.return_value = 7
        mock_get_db.return_value = db

        user = _make_fake_user()
        result = asyncio.run(get_chat_sessions_count(current_user=user))

        self.assertEqual(result["count"], 7)

    def test_db_error_returns_500(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.count_documents.side_effect = Exception("DB error")
        mock_get_db.return_value = db

        user = _make_fake_user()
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(get_chat_sessions_count(current_user=user))

        self.assertEqual(ctx.exception.status_code, 500)


# ------------------------------------------------------------------
# GET /chat-sessions/{session_id}
# ------------------------------------------------------------------


@patch("app.api.routes.chat_sessions.get_database")
class TestGetChatSession(unittest.TestCase):

    def test_returns_session_with_messages(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.find_one.return_value = _make_session_doc()
        mock_get_db.return_value = db

        user = _make_fake_user()
        result = asyncio.run(
            get_chat_session(session_id=str(FAKE_SESSION_ID), current_user=user)
        )

        self.assertEqual(result["id"], str(FAKE_SESSION_ID))
        self.assertEqual(result["title"], "Test Chat")
        self.assertEqual(len(result["messages"]), 1)

    def test_returns_404_when_not_found(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.find_one.return_value = None
        mock_get_db.return_value = db

        user = _make_fake_user()
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(
                get_chat_session(session_id=str(ObjectId()), current_user=user)
            )

        self.assertEqual(ctx.exception.status_code, 404)


# ------------------------------------------------------------------
# PUT /chat-sessions/{session_id}
# ------------------------------------------------------------------


@patch("app.api.routes.chat_sessions.get_database")
class TestUpdateChatSession(unittest.TestCase):

    def test_updates_title(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.find_one.return_value = _make_session_doc()
        mock_get_db.return_value = db

        user = _make_fake_user()
        req = UpdateChatSessionRequest(title="New Title")

        result = asyncio.run(
            update_chat_session(
                session_id=str(FAKE_SESSION_ID), request=req, current_user=user
            )
        )

        self.assertEqual(result["message"], "Chat session updated successfully")
        set_data = db.chat_sessions.update_one.call_args[0][1]["$set"]
        self.assertEqual(set_data["title"], "New Title")
        self.assertNotIn("messages", set_data)

    def test_returns_404_for_nonexistent_session(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.find_one.return_value = None
        mock_get_db.return_value = db

        user = _make_fake_user()
        req = UpdateChatSessionRequest(title="Whatever")

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(
                update_chat_session(
                    session_id=str(ObjectId()), request=req, current_user=user
                )
            )

        self.assertEqual(ctx.exception.status_code, 404)


# ------------------------------------------------------------------
# POST /chat-sessions/{session_id}/messages
# ------------------------------------------------------------------


@patch("app.api.routes.chat_sessions.get_database")
class TestSaveMessageToSession(unittest.TestCase):

    def test_saves_message_to_valid_session(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.find_one.return_value = _make_session_doc()
        mock_get_db.return_value = db

        user = _make_fake_user()
        req = SaveMessageRequest(
            session_id=str(FAKE_SESSION_ID),
            message={"type": "user", "content": "test"},
        )

        result = asyncio.run(
            save_message_to_session(
                session_id=str(FAKE_SESSION_ID), request=req, current_user=user
            )
        )

        self.assertEqual(result["message"], "Message saved successfully")

    def test_returns_404_for_nonexistent_session(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.find_one.return_value = None
        mock_get_db.return_value = db

        user = _make_fake_user()
        req = SaveMessageRequest(
            session_id=str(FAKE_SESSION_ID),
            message={"type": "user", "content": "test"},
        )

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(
                save_message_to_session(
                    session_id=str(FAKE_SESSION_ID), request=req, current_user=user
                )
            )

        self.assertEqual(ctx.exception.status_code, 404)


# ------------------------------------------------------------------
# DELETE /chat-sessions (bulk delete)
# ------------------------------------------------------------------


@patch("app.api.routes.chat_sessions.get_database")
class TestDeleteAllChatSessions(unittest.TestCase):

    def test_soft_deletes_all_active_sessions(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.update_many.return_value = MagicMock(modified_count=3)
        mock_get_db.return_value = db

        user = _make_fake_user()
        result = asyncio.run(delete_all_chat_sessions(current_user=user))

        self.assertEqual(result["deleted_count"], 3)
        self.assertIn("3", result["message"])

        filter_arg = db.chat_sessions.update_many.call_args[0][0]
        self.assertEqual(filter_arg["user_id"], user.id)
        self.assertEqual(filter_arg["is_active"], True)

        set_arg = db.chat_sessions.update_many.call_args[0][1]["$set"]
        self.assertFalse(set_arg["is_active"])

    def test_returns_zero_when_no_active_sessions(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.update_many.return_value = MagicMock(modified_count=0)
        mock_get_db.return_value = db

        user = _make_fake_user()
        result = asyncio.run(delete_all_chat_sessions(current_user=user))

        self.assertEqual(result["deleted_count"], 0)

    def test_scoped_to_current_user(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.update_many.return_value = MagicMock(modified_count=1)
        mock_get_db.return_value = db

        user = _make_fake_user()
        asyncio.run(delete_all_chat_sessions(current_user=user))

        filter_arg = db.chat_sessions.update_many.call_args[0][0]
        self.assertEqual(filter_arg["user_id"], FAKE_USER_ID)


# ------------------------------------------------------------------
# DELETE /chat-sessions/{session_id}
# ------------------------------------------------------------------


@patch("app.api.routes.chat_sessions.get_database")
class TestDeleteChatSession(unittest.TestCase):

    def test_soft_deletes_session(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.update_one.return_value = MagicMock(matched_count=1)
        mock_get_db.return_value = db

        user = _make_fake_user()
        result = asyncio.run(
            delete_chat_session(session_id=str(FAKE_SESSION_ID), current_user=user)
        )

        self.assertEqual(result["message"], "Chat session deleted successfully")

        set_arg = db.chat_sessions.update_one.call_args[0][1]["$set"]
        self.assertFalse(set_arg["is_active"])

    def test_returns_404_for_nonexistent_session(self, mock_get_db):
        db = _mock_db()
        db.chat_sessions.update_one.return_value = MagicMock(matched_count=0)
        mock_get_db.return_value = db

        user = _make_fake_user()
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(
                delete_chat_session(
                    session_id=str(ObjectId()), current_user=user
                )
            )

        self.assertEqual(ctx.exception.status_code, 404)
