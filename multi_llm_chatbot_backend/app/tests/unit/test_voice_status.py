import asyncio
import sys
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from bson import ObjectId
from fastapi import APIRouter

# app.api.routes.__init__ eagerly imports and wires routers from every
# sibling route module, several of which spin up the LLM stack, NLTK
# downloads, and ChromaDB at import time. Stub those heavy modules with
# harmless substitutes so app.api.routes.voice can be imported via normal
# import machinery.
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
    "app.api.routes.auth",
):
    sys.modules.setdefault(_name, _stub_router_module)

from app.api.routes.voice import voice_status  # noqa: E402
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


def _make_async_client(get_side_effect):
    """Build a mock httpx.AsyncClient whose `async with` yields a client
    with `.get` driven by the supplied side_effect (callable or list)."""
    client = MagicMock()
    client.get = AsyncMock(side_effect=get_side_effect)

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=None)
    return cm, client


def _ok_response():
    resp = MagicMock()
    resp.status_code = 200
    return resp


def _err_response():
    resp = MagicMock()
    resp.status_code = 503
    return resp


# ------------------------------------------------------------------
# GET /voice/status
# ------------------------------------------------------------------


class TestVoiceStatus(unittest.TestCase):

    @patch("app.api.routes.voice.STT_BASE", "https://stt.example.com")
    @patch("app.api.routes.voice.TTS_BASE", "https://tts.example.com")
    def test_both_services_ready(self):
        cm, client = _make_async_client([_ok_response(), _ok_response()])
        user = _make_fake_user()

        with patch("app.api.routes.voice.httpx.AsyncClient", return_value=cm):
            result = asyncio.run(voice_status(current_user=user))

        self.assertEqual(result, {"tts_ready": True, "stt_ready": True})
        self.assertEqual(client.get.await_count, 2)
        client.get.assert_any_await("https://tts.example.com/status")
        client.get.assert_any_await("https://stt.example.com/status")

    @patch("app.api.routes.voice.STT_BASE", "https://stt.example.com")
    @patch("app.api.routes.voice.TTS_BASE", "https://tts.example.com")
    def test_tts_ready_stt_failure_status(self):
        cm, _ = _make_async_client([_ok_response(), _err_response()])
        user = _make_fake_user()

        with patch("app.api.routes.voice.httpx.AsyncClient", return_value=cm):
            result = asyncio.run(voice_status(current_user=user))

        self.assertEqual(result, {"tts_ready": True, "stt_ready": False})

    @patch("app.api.routes.voice.STT_BASE", "https://stt.example.com")
    @patch("app.api.routes.voice.TTS_BASE", "https://tts.example.com")
    def test_tts_failure_status_stt_ready(self):
        cm, _ = _make_async_client([_err_response(), _ok_response()])
        user = _make_fake_user()

        with patch("app.api.routes.voice.httpx.AsyncClient", return_value=cm):
            result = asyncio.run(voice_status(current_user=user))

        self.assertEqual(result, {"tts_ready": False, "stt_ready": True})

    @patch("app.api.routes.voice.STT_BASE", "https://stt.example.com")
    @patch("app.api.routes.voice.TTS_BASE", "https://tts.example.com")
    def test_tts_exception_does_not_break_stt_check(self):
        cm, client = _make_async_client(
            [httpx.ConnectError("boom"), _ok_response()],
        )
        user = _make_fake_user()

        with patch("app.api.routes.voice.httpx.AsyncClient", return_value=cm):
            result = asyncio.run(voice_status(current_user=user))

        self.assertEqual(result, {"tts_ready": False, "stt_ready": True})
        self.assertEqual(client.get.await_count, 2)

    @patch("app.api.routes.voice.STT_BASE", "https://stt.example.com")
    @patch("app.api.routes.voice.TTS_BASE", "https://tts.example.com")
    def test_stt_exception_keeps_tts_result(self):
        cm, _ = _make_async_client(
            [_ok_response(), httpx.TimeoutException("slow")],
        )
        user = _make_fake_user()

        with patch("app.api.routes.voice.httpx.AsyncClient", return_value=cm):
            result = asyncio.run(voice_status(current_user=user))

        self.assertEqual(result, {"tts_ready": True, "stt_ready": False})

    @patch("app.api.routes.voice.STT_BASE", "https://stt.example.com")
    @patch("app.api.routes.voice.TTS_BASE", "https://tts.example.com")
    def test_both_exceptions(self):
        cm, _ = _make_async_client(
            [httpx.ConnectError("nope"), httpx.ConnectError("nope")],
        )
        user = _make_fake_user()

        with patch("app.api.routes.voice.httpx.AsyncClient", return_value=cm):
            result = asyncio.run(voice_status(current_user=user))

        self.assertEqual(result, {"tts_ready": False, "stt_ready": False})

    @patch("app.api.routes.voice.STT_BASE", "")
    @patch("app.api.routes.voice.TTS_BASE", "")
    def test_empty_endpoints_skip_http_calls(self):
        cm, client = _make_async_client([])
        user = _make_fake_user()

        with patch("app.api.routes.voice.httpx.AsyncClient", return_value=cm):
            result = asyncio.run(voice_status(current_user=user))

        self.assertEqual(result, {"tts_ready": False, "stt_ready": False})
        client.get.assert_not_awaited()

    @patch("app.api.routes.voice.STT_BASE", None)
    @patch("app.api.routes.voice.TTS_BASE", None)
    def test_none_endpoints_skip_http_calls(self):
        cm, client = _make_async_client([])
        user = _make_fake_user()

        with patch("app.api.routes.voice.httpx.AsyncClient", return_value=cm):
            result = asyncio.run(voice_status(current_user=user))

        self.assertEqual(result, {"tts_ready": False, "stt_ready": False})
        client.get.assert_not_awaited()

    @patch("app.api.routes.voice.STT_BASE", "https://stt.example.com")
    @patch("app.api.routes.voice.TTS_BASE", "")
    def test_only_stt_configured(self):
        cm, client = _make_async_client([_ok_response()])
        user = _make_fake_user()

        with patch("app.api.routes.voice.httpx.AsyncClient", return_value=cm):
            result = asyncio.run(voice_status(current_user=user))

        self.assertEqual(result, {"tts_ready": False, "stt_ready": True})
        client.get.assert_awaited_once_with("https://stt.example.com/status")

    @patch("app.api.routes.voice.STT_BASE", "")
    @patch("app.api.routes.voice.TTS_BASE", "https://tts.example.com")
    def test_only_tts_configured(self):
        cm, client = _make_async_client([_ok_response()])
        user = _make_fake_user()

        with patch("app.api.routes.voice.httpx.AsyncClient", return_value=cm):
            result = asyncio.run(voice_status(current_user=user))

        self.assertEqual(result, {"tts_ready": True, "stt_ready": False})
        client.get.assert_awaited_once_with("https://tts.example.com/status")


if __name__ == "__main__":
    unittest.main()
