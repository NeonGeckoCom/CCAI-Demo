import asyncio
import sys
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from bson import ObjectId
from fastapi import APIRouter, HTTPException

# app.api.routes.__init__ eagerly imports and wires routers from every
# sibling route module, several of which spin up the LLM stack, NLTK
# downloads, and ChromaDB at import time. Stub those heavy modules with
# harmless substitutes so the package imports cleanly and auth.py can
# be loaded via normal import machinery.
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

from app.api.routes.auth import (  # noqa: E402
    ChangePasswordRequest,
    DeleteAccountRequest,
    UpdateProfileRequest,
    change_password,
    delete_account,
    update_profile,
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
        user = _make_fake_user()
        body = UpdateProfileRequest()

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(update_profile(body=body, current_user=user))

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("No fields to update", ctx.exception.detail)

    def test_strips_whitespace(self, mock_get_db):
        user = _make_fake_user()
        updated_doc = {**user.model_dump(by_alias=True), "firstName": "Alice"}
        db = _mock_db()
        db.users.find_one = AsyncMock(return_value=updated_doc)
        mock_get_db.return_value = db

        body = UpdateProfileRequest(first_name="  Alice  ")
        asyncio.run(update_profile(body=body, current_user=user))

        db.users.update_one.assert_called_once_with(
            {"_id": user.id},
            {"$set": {"firstName": "Alice"}},
        )


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
