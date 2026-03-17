# NEON AI (TM) SOFTWARE, Software Development Kit & Application Framework
# All Rights Reserved 2008-2025
# Licensed under the BSD 3-Clause License
# https://opensource.org/licenses/BSD-3-Clause
#
# Copyright (c) 2008-2025, Neongecko.com Inc.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are met:
# 1. Redistributions of source code must retain the above copyright notice,
#    this list of conditions and the following disclaimer.
# 2. Redistributions in binary form must reproduce the above copyright notice,
#    this list of conditions and the following disclaimer in the documentation
#    and/or other materials provided with the distribution.
# 3. Neither the name of the copyright holder nor the names of its contributors
#    may be used to endorse or promote products derived from this software
#    without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
# LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
# CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
# SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
# CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
# ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
# POSSIBILITY OF SUCH DAMAGE.

"""Voice service health & wake-up management.

Provides status checks and warm-up pings for the external TTS (Coqui) and
STT (Whisper) services, which may sleep when idle and take time to wake.
"""

import asyncio
import logging
import time
from typing import Any, Dict, Optional

import httpx

from fastapi import APIRouter, Depends

from app.core.auth import get_current_active_user
from app.models.user import User

LOG = logging.getLogger(__name__)

router = APIRouter()

COQUI_BASE = "https://coqui.neonaiservices.com"
WHISPER_BASE = "https://whisper.neonaiservices.com"

PROBE_TIMEOUT = 12
CACHE_TTL = 120

_status_cache: Dict[str, Any] = {
    "tts": {"ready": False, "checked_at": 0.0},
    "stt": {"ready": False, "checked_at": 0.0},
}


async def _probe_tts() -> bool:
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as c:
            r = await c.get(f"{COQUI_BASE}/status")
            ok = r.status_code < 500
            _status_cache["tts"] = {"ready": ok, "checked_at": time.time()}
            return ok
    except Exception:
        _status_cache["tts"] = {"ready": False, "checked_at": time.time()}
        return False


async def _probe_stt() -> bool:
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as c:
            r = await c.get(f"{WHISPER_BASE}/status")
            ok = r.status_code < 500
            _status_cache["stt"] = {"ready": ok, "checked_at": time.time()}
            return ok
    except Exception:
        _status_cache["stt"] = {"ready": False, "checked_at": time.time()}
        return False


def _cached_ready(service: str) -> Optional[bool]:
    """Return cached readiness if still fresh, else None (unknown)."""
    entry = _status_cache[service]
    if time.time() - entry["checked_at"] < CACHE_TTL:
        return entry["ready"]
    return None


async def wake_both() -> None:
    """Fire probes to both services concurrently (background-safe)."""
    await asyncio.gather(_probe_tts(), _probe_stt(), return_exceptions=True)


@router.get("/voice/status")
async def voice_status(
    current_user: User = Depends(get_current_active_user),
) -> Dict[str, bool]:
    """Return cached readiness or probe fresh."""
    tts_ready = _cached_ready("tts")
    stt_ready = _cached_ready("stt")

    if tts_ready is None or stt_ready is None:
        tts_ok, stt_ok = await asyncio.gather(_probe_tts(), _probe_stt())
        tts_ready = tts_ok if tts_ready is None else tts_ready
        stt_ready = stt_ok if stt_ready is None else stt_ready

    return {"tts_ready": tts_ready, "stt_ready": stt_ready}


@router.post("/voice/wake")
async def voice_wake(
    current_user: User = Depends(get_current_active_user),
) -> Dict[str, str]:
    """Kick off warm-up pings for both services and return immediately."""
    asyncio.create_task(wake_both())
    return {"status": "waking"}
