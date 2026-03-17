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

"""Speech-to-text proxy — forwards audio to external Whisper STT service.

The browser records in WebM/Opus which the Whisper API cannot decode from raw
bytes.  We convert to WAV via ffmpeg before forwarding.
"""

import asyncio
import logging
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Dict

import httpx

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.auth import get_current_active_user
from app.models.user import User

LOG = logging.getLogger(__name__)

router = APIRouter()

WHISPER_BASE = "https://whisper.neonaiservices.com"


def _convert_to_wav(audio_bytes: bytes, src_mime: str) -> bytes:
    """Use ffmpeg to convert any audio format to 16 kHz mono WAV."""
    with tempfile.TemporaryDirectory() as tmp:
        ext = "webm" if "webm" in (src_mime or "") else "ogg"
        src = Path(tmp) / f"in.{ext}"
        dst = Path(tmp) / "out.wav"
        src.write_bytes(audio_bytes)
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(src),
                "-ar", "16000", "-ac", "1", "-f", "wav", str(dst),
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            LOG.warning(f"ffmpeg stderr: {result.stderr.decode(errors='replace')[-500:]}")
            raise RuntimeError("ffmpeg conversion failed")
        return dst.read_bytes()


@router.post("/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
) -> Dict[str, str]:
    contents = await audio.read()
    if not contents:
        return {"text": ""}

    mime = audio.content_type or "audio/webm"
    LOG.info(f"STT: received {len(contents)} bytes ({mime})")

    try:
        from app.api.routes.voice import _probe_tts, _cached_ready
        if _cached_ready("tts") is not True:
            asyncio.create_task(_probe_tts())
    except Exception:
        pass

    need_convert = "wav" not in mime.lower()
    if need_convert:
        try:
            loop = asyncio.get_event_loop()
            wav_bytes = await loop.run_in_executor(None, _convert_to_wav, contents, mime)
            LOG.info(f"STT: converted to WAV ({len(wav_bytes)} bytes)")
        except Exception as e:
            LOG.error(f"STT conversion error: {e}")
            raise HTTPException(status_code=500, detail="Audio conversion failed")
    else:
        wav_bytes = contents

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{WHISPER_BASE}/stt",
                content=wav_bytes,
                headers={"Content-Type": "audio/wav"},
            )
            resp.raise_for_status()

            from app.api.routes.voice import _status_cache
            _status_cache["stt"] = {"ready": True, "checked_at": time.time()}

            text = resp.text.strip().strip('"')
            LOG.info(f"STT result: '{text[:100]}'")
            return {"text": text}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="STT service timed out")
    except Exception as e:
        LOG.error(f"STT proxy error: {e}")
        raise HTTPException(status_code=502, detail="STT service unavailable")
