import asyncio
import sys
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from bson import ObjectId
from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

# app.api.routes.__init__ eagerly imports and wires routers from every
# sibling route module, several of which spin up the LLM stack, NLTK
# downloads, and ChromaDB at import time. Stub those heavy modules with
# harmless substitutes so the package imports cleanly and auth.py can
# be loaded via normal import machinery.

_STUBBED_HEAVY_MODULES = ("app.core.bootstrap", "app.core.rag_manager")
_STUBBED_ROUTE_MODULES = (
    "app.api.routes.chat",
    "app.api.routes.documents",
    "app.api.routes.sessions",
    "app.api.routes.provider",
    "app.api.routes.debug",
    "app.api.routes.root",
    "app.api.routes.phd_canvas",
)
_MISSING = object()
_original_sys_modules: dict = {}

# Populated by setUpModule so tests can reference them as module globals.
ChangePasswordRequest = None  # type: ignore[assignment]
DeleteAccountRequest = None  # type: ignore[assignment]
UpdateProfileRequest = None  # type: ignore[assignment]
change_password = None  # type: ignore[assignment]
delete_account = None  # type: ignore[assignment]
update_profile = None  # type: ignore[assignment]
User = None  # type: ignore[assignment]


def setUpModule():
    global ChangePasswordRequest, DeleteAccountRequest, UpdateProfileRequest
    global change_password, delete_account, update_profile, User

    for name in _STUBBED_HEAVY_MODULES:
        _original_sys_modules[name] = sys.modules.get(name, _MISSING)
        sys.modules[name] = MagicMock()

    stub_router_module = MagicMock(router=APIRouter())
    for name in _STUBBED_ROUTE_MODULES:
        _original_sys_modules[name] = sys.modules.get(name, _MISSING)
        sys.modules[name] = stub_router_module

    from app.api.routes.auth import (
        ChangePasswordRequest as _ChangePasswordRequest,
        DeleteAccountRequest as _DeleteAccountRequest,
        UpdateProfileRequest as _UpdateProfileRequest,
        change_password as _change_password,
        delete_account as _delete_account,
        update_profile as _update_profile,
    )
    from app.models.user import User as _User

    ChangePasswordRequest = _ChangePasswordRequest
    DeleteAccountRequest = _DeleteAccountRequest
    UpdateProfileRequest = _UpdateProfileRequest
    change_password = _change_password
    delete_account = _delete_account
    update_profile = _update_profile
    User = _User


def tearDownModule():
    # Restore any modules we overrode, removing the ones that had no
    # prior entry.
    for name, original in _original_sys_modules.items():
        if original is _MISSING:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = original
    _original_sys_modules.clear()

    # Importing app.api.routes.auth also pulled in app.api, app.api.routes,
    # and app.api.routes.auth itself, all resolved against the stubs above.
    # Evict those so other test modules get a clean import.
    for name in list(sys.modules):
        if name == "app.api" or name.startswith("app.api."):
            del sys.modules[name]

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
    db.users.update_one = AsyncMock()
    db.users.delete_one = AsyncMock()
    db.users.find_one = AsyncMock()
    db.chat_sessions.delete_many = AsyncMock()
    db.phd_canvases.delete_many = AsyncMock()
    return db


# ------------------------------------------------------------------
# POST /auth/me/password
# ------------------------------------------------------------------


@patch("app.api.routes.auth.get_database")
@patch("app.api.routes.auth.get_password_hash", return_value="new_hashed")
@patch("app.api.routes.auth.verify_password")
class TestChangePassword(unittest.TestCase):

    def test_success(self, mock_verify, mock_hash, mock_get_db):
        mock_verify.return_value = True
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = ChangePasswordRequest(
            current_password="old", new_password="newsecure",
        )

        result = asyncio.run(change_password(body=body, current_user=user))

        mock_verify.assert_called_once_with("old", user.hashed_password)
        mock_hash.assert_called_once_with("newsecure")
        db.users.update_one.assert_called_once_with(
            {"_id": user.id},
            {"$set": {"hashed_password": "new_hashed"}},
        )
        self.assertEqual(result.message, "Password changed successfully")

    def test_wrong_current_password(self, mock_verify, mock_hash, mock_get_db):
        mock_verify.return_value = False

        user = _make_fake_user()
        body = ChangePasswordRequest(
            current_password="wrong", new_password="newsecure",
        )

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(change_password(body=body, current_user=user))

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("incorrect", ctx.exception.detail.lower())

    def test_new_password_too_short(self, mock_verify, mock_hash, mock_get_db):
        mock_verify.return_value = True

        user = _make_fake_user()
        body = ChangePasswordRequest(
            current_password="old", new_password="short",
        )

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(change_password(body=body, current_user=user))

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("8 characters", ctx.exception.detail)

    def test_db_not_called_on_wrong_password(self, mock_verify, mock_hash, mock_get_db):
        mock_verify.return_value = False
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = ChangePasswordRequest(
            current_password="wrong", new_password="newsecure",
        )

        with self.assertRaises(HTTPException):
            asyncio.run(change_password(body=body, current_user=user))

        db.users.update_one.assert_not_called()

    def test_same_password_rejected(self, mock_verify, mock_hash, mock_get_db):
        with self.assertRaises(ValidationError) as ctx:
            ChangePasswordRequest(
                current_password="samepass", new_password="samepass",
            )

        self.assertIn("different", str(ctx.exception).lower())


# ------------------------------------------------------------------
# PATCH /auth/me
# ------------------------------------------------------------------


@patch("app.api.routes.auth.get_database")
class TestUpdateProfile(unittest.TestCase):

    def test_update_first_name(self, mock_get_db):
        user = _make_fake_user()
        updated_doc = {**user.model_dump(by_alias=True), "firstName": "Alice"}
        db = _mock_db()
        db.users.find_one = AsyncMock(return_value=updated_doc)
        mock_get_db.return_value = db

        body = UpdateProfileRequest(first_name="Alice")
        result = asyncio.run(update_profile(body=body, current_user=user))

        db.users.update_one.assert_called_once_with(
            {"_id": user.id},
            {"$set": {"firstName": "Alice"}},
        )
        self.assertEqual(result.firstName, "Alice")

    def test_update_both_names(self, mock_get_db):
        user = _make_fake_user()
        updated_doc = {
            **user.model_dump(by_alias=True),
            "firstName": "Alice",
            "lastName": "Smith",
        }
        db = _mock_db()
        db.users.find_one = AsyncMock(return_value=updated_doc)
        mock_get_db.return_value = db

        body = UpdateProfileRequest(first_name="Alice", last_name="Smith")
        result = asyncio.run(update_profile(body=body, current_user=user))

        db.users.update_one.assert_called_once_with(
            {"_id": user.id},
            {"$set": {"firstName": "Alice", "lastName": "Smith"}},
        )
        self.assertEqual(result.firstName, "Alice")
        self.assertEqual(result.lastName, "Smith")

    def test_empty_body_rejected(self, mock_get_db):
        with self.assertRaises(ValidationError) as ctx:
            UpdateProfileRequest()

        self.assertIn("at least one field", str(ctx.exception).lower())

    def test_strips_whitespace(self, mock_get_db):
        user = _make_fake_user()
        updated_doc = {**user.model_dump(by_alias=True), "firstName": "Alice"}
        db = _mock_db()
        db.users.find_one = AsyncMock(return_value=updated_doc)
        mock_get_db.return_value = db

        body = UpdateProfileRequest(first_name="  Alice  ")
        self.assertEqual(body.first_name, "Alice")

        asyncio.run(update_profile(body=body, current_user=user))

        db.users.update_one.assert_called_once_with(
            {"_id": user.id},
            {"$set": {"firstName": "Alice"}},
        )

    def test_whitespace_only_body_rejected(self, mock_get_db):
        with self.assertRaises(ValidationError) as ctx:
            UpdateProfileRequest(first_name="   ")

        self.assertIn("at least one field", str(ctx.exception).lower())


# ------------------------------------------------------------------
# DELETE /auth/me
# ------------------------------------------------------------------


@patch("app.api.routes.auth.get_database")
@patch("app.api.routes.auth.verify_password")
class TestDeleteAccount(unittest.TestCase):

    def test_success(self, mock_verify, mock_get_db):
        mock_verify.return_value = True
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = DeleteAccountRequest(password="correct")

        result = asyncio.run(delete_account(body=body, current_user=user))

        mock_verify.assert_called_once_with("correct", user.hashed_password)
        db.chat_sessions.delete_many.assert_called_once_with({"user_id": user.id})
        db.phd_canvases.delete_many.assert_called_once_with({"user_id": user.id})
        db.users.delete_one.assert_called_once_with({"_id": user.id})
        self.assertEqual(result.message, "Account deleted")

    def test_wrong_password(self, mock_verify, mock_get_db):
        mock_verify.return_value = False
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = DeleteAccountRequest(password="wrong")

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(delete_account(body=body, current_user=user))

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Incorrect password", ctx.exception.detail)

    def test_no_deletion_on_wrong_password(self, mock_verify, mock_get_db):
        mock_verify.return_value = False
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = DeleteAccountRequest(password="wrong")

        with self.assertRaises(HTTPException):
            asyncio.run(delete_account(body=body, current_user=user))

        db.users.delete_one.assert_not_called()
        db.chat_sessions.delete_many.assert_not_called()
        db.phd_canvases.delete_many.assert_not_called()
