import asyncio
import sys
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from bson import ObjectId
from fastapi import HTTPException

# Stub heavy modules before importing the preferences route module.
_mock_bootstrap = MagicMock()
_mock_bootstrap.chat_orchestrator.list_personas.return_value = [
    "pragmatist", "theorist", "methodologist",
]
sys.modules.setdefault("app.core.bootstrap", _mock_bootstrap)
sys.modules.setdefault("app.core.rag_manager", MagicMock())

from fastapi import APIRouter  # noqa: E402

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

from app.api.routes.preferences import (  # noqa: E402
    AdvisorPreferencesRequest,
    get_advisor_preferences,
    update_advisor_preferences,
)
from app.models.user import User  # noqa: E402

FAKE_USER_ID = ObjectId()
ALL_IDS = ["pragmatist", "theorist", "methodologist"]


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
    db.users.update_one = AsyncMock()
    return db


def _mock_settings(allowed_advisors=None):
    settings = MagicMock()
    settings.personas.allowed_advisors = allowed_advisors
    return settings


# ------------------------------------------------------------------
# GET /api/me/advisor-preferences
# ------------------------------------------------------------------


@patch("app.api.routes.preferences.get_settings")
@patch("app.api.routes.preferences.chat_orchestrator")
class TestGetAdvisorPreferences(unittest.TestCase):

    def test_returns_none_when_no_prefs_set(self, mock_orch, mock_settings):
        mock_orch.list_personas.return_value = ALL_IDS
        mock_settings.return_value = _mock_settings()

        user = _make_fake_user()
        result = asyncio.run(get_advisor_preferences(current_user=user))

        self.assertIsNone(result.disabled_advisors)
        self.assertEqual(result.available_advisors, ALL_IDS)

    def test_returns_disabled_list(self, mock_orch, mock_settings):
        mock_orch.list_personas.return_value = ALL_IDS
        mock_settings.return_value = _mock_settings()

        user = _make_fake_user(disabled_advisors=["theorist"])
        result = asyncio.run(get_advisor_preferences(current_user=user))

        self.assertEqual(result.disabled_advisors, ["theorist"])

    def test_available_reflects_system_whitelist(self, mock_orch, mock_settings):
        mock_orch.list_personas.return_value = ALL_IDS
        mock_settings.return_value = _mock_settings(
            allowed_advisors=["pragmatist", "theorist"],
        )

        user = _make_fake_user()
        result = asyncio.run(get_advisor_preferences(current_user=user))

        self.assertEqual(result.available_advisors, ["pragmatist", "theorist"])


# ------------------------------------------------------------------
# PUT /api/me/advisor-preferences
# ------------------------------------------------------------------


@patch("app.api.routes.preferences.get_database")
@patch("app.api.routes.preferences.get_settings")
@patch("app.api.routes.preferences.chat_orchestrator")
class TestUpdateAdvisorPreferences(unittest.TestCase):

    def test_valid_ids_persisted(self, mock_orch, mock_settings, mock_get_db):
        mock_orch.list_personas.return_value = ALL_IDS
        mock_settings.return_value = _mock_settings()
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = AdvisorPreferencesRequest(disabled_advisors=["theorist"])
        result = asyncio.run(
            update_advisor_preferences(body=body, current_user=user)
        )

        db.users.update_one.assert_called_once_with(
            {"_id": user.id},
            {"$set": {"disabled_advisors": ["theorist"]}},
        )
        self.assertEqual(result.disabled_advisors, ["theorist"])

    def test_unknown_ids_rejected(self, mock_orch, mock_settings, mock_get_db):
        mock_orch.list_personas.return_value = ALL_IDS
        mock_settings.return_value = _mock_settings()

        user = _make_fake_user()
        body = AdvisorPreferencesRequest(disabled_advisors=["fake_advisor"])

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(
                update_advisor_preferences(body=body, current_user=user)
            )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("fake_advisor", ctx.exception.detail)

    def test_null_clears_preferences(self, mock_orch, mock_settings, mock_get_db):
        mock_orch.list_personas.return_value = ALL_IDS
        mock_settings.return_value = _mock_settings()
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user(disabled_advisors=["theorist"])
        body = AdvisorPreferencesRequest(disabled_advisors=None)
        result = asyncio.run(
            update_advisor_preferences(body=body, current_user=user)
        )

        db.users.update_one.assert_called_once_with(
            {"_id": user.id},
            {"$set": {"disabled_advisors": None}},
        )
        self.assertIsNone(result.disabled_advisors)

    def test_empty_list_accepted(self, mock_orch, mock_settings, mock_get_db):
        mock_orch.list_personas.return_value = ALL_IDS
        mock_settings.return_value = _mock_settings()
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user(disabled_advisors=["theorist"])
        body = AdvisorPreferencesRequest(disabled_advisors=[])
        result = asyncio.run(
            update_advisor_preferences(body=body, current_user=user)
        )

        db.users.update_one.assert_called_once_with(
            {"_id": user.id},
            {"$set": {"disabled_advisors": []}},
        )
        self.assertEqual(result.disabled_advisors, [])
