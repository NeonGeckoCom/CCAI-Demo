import asyncio
import sys
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from bson import ObjectId
from fastapi import APIRouter

# Stub heavy sibling route modules so the package imports cleanly.
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

from app.api.routes.avatar_preferences import (  # noqa: E402
    AddCustomAvatarRequest,
    AvatarPreferencesResponse,
    UpdateAvatarOverrideRequest,
    add_custom_avatar,
    get_avatar_preferences,
    set_avatar_override,
)
from app.models.user import User  # noqa: E402

FAKE_USER_ID = ObjectId()


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
    db.user_preferences.find_one = AsyncMock()
    db.user_preferences.update_one = AsyncMock()
    return db


# ------------------------------------------------------------------
# GET /api/avatar-preferences
# ------------------------------------------------------------------


@patch("app.api.routes.avatar_preferences.get_database")
class TestGetAvatarPreferences(unittest.TestCase):

    def test_returns_defaults_when_no_document(self, mock_get_db):
        db = _mock_db()
        db.user_preferences.find_one = AsyncMock(return_value=None)
        mock_get_db.return_value = db

        user = _make_fake_user()
        result = asyncio.run(get_avatar_preferences(current_user=user))

        db.user_preferences.find_one.assert_called_once_with(
            {"user_id": user.id}
        )
        self.assertEqual(result.avatar_overrides, {})
        self.assertEqual(result.custom_avatars, [])

    def test_returns_saved_preferences(self, mock_get_db):
        saved_doc = {
            "user_id": FAKE_USER_ID,
            "avatar_overrides": {
                "critic": "https://example.com/photo.jpg",
                "empathetic": "",
            },
            "custom_avatars": [
                "https://example.com/photo.jpg",
                "https://example.com/other.png",
            ],
        }
        db = _mock_db()
        db.user_preferences.find_one = AsyncMock(return_value=saved_doc)
        mock_get_db.return_value = db

        user = _make_fake_user()
        result = asyncio.run(get_avatar_preferences(current_user=user))

        self.assertEqual(result.avatar_overrides, saved_doc["avatar_overrides"])
        self.assertEqual(result.custom_avatars, saved_doc["custom_avatars"])

    def test_returns_defaults_for_missing_fields(self, mock_get_db):
        db = _mock_db()
        db.user_preferences.find_one = AsyncMock(
            return_value={"user_id": FAKE_USER_ID}
        )
        mock_get_db.return_value = db

        user = _make_fake_user()
        result = asyncio.run(get_avatar_preferences(current_user=user))

        self.assertEqual(result.avatar_overrides, {})
        self.assertEqual(result.custom_avatars, [])


# ------------------------------------------------------------------
# PUT /api/avatar-preferences/overrides
# ------------------------------------------------------------------


@patch("app.api.routes.avatar_preferences.get_database")
class TestSetAvatarOverride(unittest.TestCase):

    def test_sets_override(self, mock_get_db):
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = UpdateAvatarOverrideRequest(
            advisor_id="critic",
            url="https://example.com/photo.jpg",
        )

        result = asyncio.run(set_avatar_override(body=body, current_user=user))

        call_args = db.user_preferences.update_one.call_args
        self.assertEqual(call_args[0][0], {"user_id": user.id})
        set_payload = call_args[0][1]["$set"]
        self.assertEqual(
            set_payload["avatar_overrides.critic"],
            "https://example.com/photo.jpg",
        )
        self.assertIn("updated_at", set_payload)
        self.assertTrue(call_args[1].get("upsert"))
        self.assertEqual(result["message"], "Avatar override saved")

    def test_reset_override_with_empty_string(self, mock_get_db):
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = UpdateAvatarOverrideRequest(advisor_id="critic", url="")

        asyncio.run(set_avatar_override(body=body, current_user=user))

        call_args = db.user_preferences.update_one.call_args
        set_payload = call_args[0][1]["$set"]
        self.assertEqual(set_payload["avatar_overrides.critic"], "")

    def test_upsert_creates_document(self, mock_get_db):
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = UpdateAvatarOverrideRequest(
            advisor_id="motivator",
            url="/api/avatars/bundled/advisor2.png",
        )

        asyncio.run(set_avatar_override(body=body, current_user=user))

        call_args = db.user_preferences.update_one.call_args
        self.assertTrue(call_args[1].get("upsert"))


# ------------------------------------------------------------------
# POST /api/avatar-preferences/custom-avatars
# ------------------------------------------------------------------


@patch("app.api.routes.avatar_preferences.get_database")
class TestAddCustomAvatar(unittest.TestCase):

    def test_adds_custom_avatar(self, mock_get_db):
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = AddCustomAvatarRequest(url="https://example.com/photo.jpg")

        result = asyncio.run(add_custom_avatar(body=body, current_user=user))

        call_args = db.user_preferences.update_one.call_args
        self.assertEqual(call_args[0][0], {"user_id": user.id})
        self.assertEqual(
            call_args[0][1]["$addToSet"],
            {"custom_avatars": "https://example.com/photo.jpg"},
        )
        self.assertIn("updated_at", call_args[0][1]["$set"])
        self.assertTrue(call_args[1].get("upsert"))
        self.assertEqual(result["message"], "Custom avatar added")

    def test_upsert_creates_document(self, mock_get_db):
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = AddCustomAvatarRequest(url="https://example.com/new.png")

        asyncio.run(add_custom_avatar(body=body, current_user=user))

        call_args = db.user_preferences.update_one.call_args
        self.assertTrue(call_args[1].get("upsert"))


# ------------------------------------------------------------------
# DELETE /auth/me — verify user_preferences cleanup
# ------------------------------------------------------------------


@patch("app.api.routes.auth.get_database")
@patch("app.api.routes.auth.verify_password")
class TestDeleteAccountCleansUpPreferences(unittest.TestCase):

    def test_preferences_deleted_on_account_deletion(self, mock_verify, mock_get_db):
        from app.api.routes.auth import DeleteAccountRequest, delete_account

        mock_verify.return_value = True
        db = MagicMock()
        db.users.delete_one = AsyncMock()
        db.chat_sessions.delete_many = AsyncMock()
        db.phd_canvases.delete_many = AsyncMock()
        db.user_preferences.delete_many = AsyncMock()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = DeleteAccountRequest(password="correct")

        asyncio.run(delete_account(body=body, current_user=user))

        db.user_preferences.delete_many.assert_called_once_with(
            {"user_id": user.id}
        )
