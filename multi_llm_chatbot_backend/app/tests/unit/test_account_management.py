import asyncio
import importlib.util
import os
import sys
import types
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from bson import ObjectId
from fastapi import HTTPException

from app.models.user import User

# app.api.routes.__init__ imports sibling route modules that run heavy
# module-level code (LLM bootstrap, etc.).  We only need auth.py, so
# we register a thin stub for the *package* then load auth.py by file
# path so the real __init__ is never executed.
_pkg_name = "app.api.routes"
if _pkg_name not in sys.modules:
    _pkg = types.ModuleType(_pkg_name)
    _pkg.__path__ = [
        os.path.join(os.path.dirname(__file__), os.pardir, os.pardir, "api", "routes")
    ]
    _pkg.__package__ = _pkg_name
    sys.modules[_pkg_name] = _pkg

_auth_path = os.path.normpath(
    os.path.join(os.path.dirname(__file__), os.pardir, os.pardir, "api", "routes", "auth.py")
)
_spec = importlib.util.spec_from_file_location("app.api.routes.auth", _auth_path)
_auth_mod = importlib.util.module_from_spec(_spec)
sys.modules["app.api.routes.auth"] = _auth_mod
_spec.loader.exec_module(_auth_mod)

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
        body = _auth_mod.ChangePasswordRequest(
            current_password="old", new_password="newsecure",
        )

        result = asyncio.run(_auth_mod.change_password(body=body, current_user=user))

        mock_verify.assert_called_once_with("old", user.hashed_password)
        mock_hash.assert_called_once_with("newsecure")
        db.users.update_one.assert_called_once_with(
            {"_id": user.id},
            {"$set": {"hashed_password": "new_hashed"}},
        )
        self.assertEqual(result["message"], "Password changed successfully")

    def test_wrong_current_password(self, mock_verify, mock_hash, mock_get_db):
        mock_verify.return_value = False

        user = _make_fake_user()
        body = _auth_mod.ChangePasswordRequest(
            current_password="wrong", new_password="newsecure",
        )

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(_auth_mod.change_password(body=body, current_user=user))

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("incorrect", ctx.exception.detail.lower())

    def test_new_password_too_short(self, mock_verify, mock_hash, mock_get_db):
        mock_verify.return_value = True

        user = _make_fake_user()
        body = _auth_mod.ChangePasswordRequest(
            current_password="old", new_password="short",
        )

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(_auth_mod.change_password(body=body, current_user=user))

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("6 characters", ctx.exception.detail)

    def test_db_not_called_on_wrong_password(self, mock_verify, mock_hash, mock_get_db):
        mock_verify.return_value = False
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = _auth_mod.ChangePasswordRequest(
            current_password="wrong", new_password="newsecure",
        )

        with self.assertRaises(HTTPException):
            asyncio.run(_auth_mod.change_password(body=body, current_user=user))

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

        body = _auth_mod.UpdateProfileRequest(firstName="Alice")
        result = asyncio.run(_auth_mod.update_profile(body=body, current_user=user))

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

        body = _auth_mod.UpdateProfileRequest(firstName="Alice", lastName="Smith")
        result = asyncio.run(_auth_mod.update_profile(body=body, current_user=user))

        db.users.update_one.assert_called_once_with(
            {"_id": user.id},
            {"$set": {"firstName": "Alice", "lastName": "Smith"}},
        )
        self.assertEqual(result.firstName, "Alice")
        self.assertEqual(result.lastName, "Smith")

    def test_empty_body_rejected(self, mock_get_db):
        user = _make_fake_user()
        body = _auth_mod.UpdateProfileRequest()

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(_auth_mod.update_profile(body=body, current_user=user))

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("No fields to update", ctx.exception.detail)

    def test_strips_whitespace(self, mock_get_db):
        user = _make_fake_user()
        updated_doc = {**user.model_dump(by_alias=True), "firstName": "Alice"}
        db = _mock_db()
        db.users.find_one = AsyncMock(return_value=updated_doc)
        mock_get_db.return_value = db

        body = _auth_mod.UpdateProfileRequest(firstName="  Alice  ")
        asyncio.run(_auth_mod.update_profile(body=body, current_user=user))

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
        body = _auth_mod.DeleteAccountRequest(password="correct")

        result = asyncio.run(_auth_mod.delete_account(body=body, current_user=user))

        mock_verify.assert_called_once_with("correct", user.hashed_password)
        db.chat_sessions.delete_many.assert_called_once_with({"user_id": user.id})
        db.users.delete_one.assert_called_once_with({"_id": user.id})
        self.assertEqual(result["message"], "Account deleted")

    def test_wrong_password(self, mock_verify, mock_get_db):
        mock_verify.return_value = False
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = _auth_mod.DeleteAccountRequest(password="wrong")

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(_auth_mod.delete_account(body=body, current_user=user))

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Incorrect password", ctx.exception.detail)

    def test_no_deletion_on_wrong_password(self, mock_verify, mock_get_db):
        mock_verify.return_value = False
        db = _mock_db()
        mock_get_db.return_value = db

        user = _make_fake_user()
        body = _auth_mod.DeleteAccountRequest(password="wrong")

        with self.assertRaises(HTTPException):
            asyncio.run(_auth_mod.delete_account(body=body, current_user=user))

        db.users.delete_one.assert_not_called()
        db.chat_sessions.delete_many.assert_not_called()
