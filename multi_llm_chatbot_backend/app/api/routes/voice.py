import asyncio
import html as html_module
import logging
import re
import struct
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.auth import get_current_active_user
from app.models.user import User
from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()

voice_settings = get_settings().voice
TTS_BASE = voice_settings.tts_endpoint
STT_BASE = voice_settings.stt_endpoint

HTTP_TIMEOUT = 120
# Coqui uses GET /synthesize/{text}; keep chunks small for URL limits.
MAX_SYNTH_CHUNK = 200

_SECTION_HEADERS = re.compile(
    r"\b(Thought|What to do|Next step)\s*[:.]?\s*", flags=re.IGNORECASE
)


class TTSRequest(BaseModel):
    text: str


def _rough_spoken_text(raw: str) -> str:
    """Light cleanup so model markdown is tolerable for TTS (no extra deps)."""
    t = raw.strip()
    t = re.sub(r"```[\s\S]*?```", " ", t)
    t = re.sub(r"`([^`]+)`", r"\1", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"^#{1,6}\s+", "", t, flags=re.MULTILINE)
    t = re.sub(r"[*_]{1,3}", "", t)
    t = html_module.unescape(t)
    t = _SECTION_HEADERS.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _text_chunks(text: str, max_len: int = MAX_SYNTH_CHUNK) -> List[str]:
    text = text.strip()
    if not text:
        return []
    out: List[str] = []
    while text:
        if len(text) <= max_len:
            out.append(text)
            break
        cut = text.rfind(" ", 0, max_len)
        if cut <= 0:
            cut = max_len
        piece = text[:cut].strip()
        if piece:
            out.append(piece)
        text = text[cut:].strip()
    return out


async def _synthesize_one(client: httpx.AsyncClient, chunk: str) -> Optional[bytes]:
    url = f"{TTS_BASE}/synthesize/{quote(chunk, safe='')}"
    try:
        r = await client.get(url)
        r.raise_for_status()
        return r.content
    except Exception as exc:
        logger.warning("TTS chunk failed (%s chars): %s", len(chunk), exc)
        return None


def _concat_wav(segments: List[bytes]) -> bytes:
    if len(segments) == 1:
        return segments[0]

    pcm_parts: List[bytes] = []
    first_header = b""

    for i, seg in enumerate(segments):
        if len(seg) < 44:
            continue
        if i == 0:
            first_header = seg[:44]
        data_offset = 44
        idx = seg.find(b"data")
        if idx != -1 and idx + 8 <= len(seg):
            data_offset = idx + 8
        pcm_parts.append(seg[data_offset:])

    if not pcm_parts or not first_header:
        return segments[0] if segments else b""

    all_pcm = b"".join(pcm_parts)
    pcm_len = len(all_pcm)

    header = bytearray(first_header)
    struct.pack_into("<I", header, 4, pcm_len + 36)
    struct.pack_into("<I", header, 40, pcm_len)
    return bytes(header) + all_pcm


def _convert_to_wav(audio_bytes: bytes, src_mime: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        ext = "webm" if "webm" in (src_mime or "") else "ogg"
        src = Path(tmp) / f"in.{ext}"
        dst = Path(tmp) / "out.wav"
        src.write_bytes(audio_bytes)
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(src),
                "-ar",
                "16000",
                "-ac",
                "1",
                "-f",
                "wav",
                str(dst),
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            logger.warning(
                "ffmpeg stderr: %s",
                result.stderr.decode(errors="replace")[-500:],
            )
            raise RuntimeError("ffmpeg conversion failed")
        return dst.read_bytes()


@router.get("/voice/status")
async def voice_status(
    current_user: User = Depends(get_current_active_user),
) -> Dict[str, bool]:
    tts_ready = TTS_BASE is not None
    stt_ready = STT_BASE is not None

    return {"tts_ready": tts_ready, "stt_ready": stt_ready}


@router.post("/voice/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
) -> Dict[str, str]:
    contents = await audio.read()
    if not contents:
        return {"text": ""}

    mime = audio.content_type or "audio/webm"
    logger.info("STT: received %s bytes (%s)", len(contents), mime)

    need_convert = "wav" not in mime.lower()
    if need_convert:
        try:
            loop = asyncio.get_running_loop()
            wav_bytes = await loop.run_in_executor(
                None, _convert_to_wav, contents, mime
            )
            logger.info("STT: converted to WAV (%s bytes)", len(wav_bytes))
        except Exception as e:
            logger.error("STT conversion error: %s", e)
            raise HTTPException(status_code=500, detail="Audio conversion failed")
    else:
        wav_bytes = contents

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.post(
                f"{STT_BASE}/stt",
                content=wav_bytes,
                headers={"Content-Type": "audio/wav"},
            )
            resp.raise_for_status()
            text = resp.text.strip().strip('"')
            logger.info("STT result: %r", text[:100])
            return {"text": text}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="STT service timed out")
    except Exception as e:
        logger.error("STT proxy error: %s", e)
        raise HTTPException(status_code=502, detail="STT service unavailable")


@router.post("/voice/tts")
async def text_to_speech(
    req: TTSRequest,
    current_user: User = Depends(get_current_active_user),
) -> Response:
    raw = req.text.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Text is required")

    if len(raw) > 5000:
        raw = raw[:5000]

    spoken = _rough_spoken_text(raw)
    chunks = _text_chunks(spoken)
    logger.info(
        "TTS: %s chunk(s) from %s input chars → %s spoken chars",
        len(chunks),
        len(req.text),
        len(spoken),
    )

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            results = await asyncio.gather(
                *[_synthesize_one(client, c) for c in chunks]
            )
            wav_segments = [r for r in results if r and len(r) > 44]

            if not wav_segments:
                raise HTTPException(
                    status_code=502, detail="TTS synthesis failed for all chunks"
                )

            combined = _concat_wav(wav_segments)
            return Response(content=combined, media_type="audio/wav")
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="TTS service timed out")
    except Exception as e:
        logger.error("TTS proxy error: %s", e)
        raise HTTPException(status_code=502, detail="TTS service unavailable")
