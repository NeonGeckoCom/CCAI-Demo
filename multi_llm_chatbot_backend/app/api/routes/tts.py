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

"""Text-to-speech proxy — forwards to Coqui TTS service.

Raw markdown from the frontend is converted to clean spoken text via the
``markdown`` library (MD → HTML → plaintext), then split into sentence-sized
chunks using ``nltk.sent_tokenize``, synthesised in parallel, and the
resulting WAV segments are concatenated into a single response.
"""

import asyncio
import html as html_module
import logging
import re
import struct
import time as _t
from typing import List, Optional
from urllib.parse import quote

import httpx
import markdown
import nltk

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.auth import get_current_active_user
from app.models.user import User

try:
    nltk.data.find("tokenizers/punkt_tab")
except LookupError:
    nltk.download("punkt_tab", quiet=True)

LOG = logging.getLogger(__name__)

router = APIRouter()

COQUI_BASE = "https://coqui.neonaiservices.com"
MAX_CHUNK_CHARS = 160

_SECTION_HEADERS = re.compile(
    r'\b(Thought|What to do|Next step)\s*[:.]?\s*', flags=re.IGNORECASE
)


class TTSRequest(BaseModel):
    text: str


def _md_to_spoken_text(md: str) -> str:
    """Convert markdown to natural spoken plaintext."""
    html_str = markdown.markdown(md, extensions=["tables"])
    text = re.sub(r'</(?:p|li|h[1-6]|tr|blockquote)>', '. ', html_str)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html_module.unescape(text)
    text = _SECTION_HEADERS.sub(' ', text)
    text = re.sub(r'([.!?])\s*\1+', r'\1', text)
    text = re.sub(r'\s*\.\s*\.', '.', text)
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'^[.\s]+', '', text)
    return text


def _split_sentences(text: str) -> List[str]:
    """Split text into chunks of roughly MAX_CHUNK_CHARS using nltk sentence
    tokenisation, merging short sentences into bigger chunks."""
    sentences = nltk.sent_tokenize(text)
    chunks: List[str] = []
    buf = ""
    for sent in sentences:
        sent = sent.strip()
        if not sent:
            continue
        if buf and len(buf) + len(sent) + 1 > MAX_CHUNK_CHARS:
            chunks.append(buf)
            buf = sent
        else:
            buf = f"{buf} {sent}" if buf else sent
    if buf:
        chunks.append(buf)
    return chunks


async def _synthesize_one(client: httpx.AsyncClient, chunk: str) -> Optional[bytes]:
    url = f"{COQUI_BASE}/synthesize/{quote(chunk, safe='')}"
    try:
        r = await client.get(url)
        r.raise_for_status()
        return r.content
    except Exception as exc:
        LOG.warning(f"TTS chunk failed ({len(chunk)} chars): {exc}")
        return None


def _concat_wav(segments: List[bytes]) -> bytes:
    """Concatenate multiple WAV byte strings into a single WAV.

    Assumes all segments share the same format (sample rate, channels, etc.).
    """
    if len(segments) == 1:
        return segments[0]

    pcm_parts: List[bytes] = []
    first_header: bytes = b""

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


@router.post("/tts")
async def text_to_speech(
    req: TTSRequest,
    current_user: User = Depends(get_current_active_user),
) -> Response:
    raw = req.text.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Text is required")

    if len(raw) > 5000:
        raw = raw[:5000]

    try:
        from app.api.routes.voice import _probe_stt, _cached_ready
        if _cached_ready("stt") is not True:
            asyncio.create_task(_probe_stt())
    except Exception:
        pass

    spoken = _md_to_spoken_text(raw)
    chunks = _split_sentences(spoken)
    LOG.info(f"TTS: {len(chunks)} chunk(s) from {len(raw)} md chars → {len(spoken)} spoken chars")

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            results = await asyncio.gather(
                *[_synthesize_one(client, c) for c in chunks]
            )
            wav_segments = [r for r in results if r and len(r) > 44]

            if not wav_segments:
                raise HTTPException(status_code=502, detail="TTS synthesis failed for all chunks")

            combined = _concat_wav(wav_segments)

            from app.api.routes.voice import _status_cache
            _status_cache["tts"] = {"ready": True, "checked_at": _t.time()}

            return Response(content=combined, media_type="audio/wav")
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="TTS service timed out")
    except Exception as e:
        LOG.error(f"TTS proxy error: {e}")
        raise HTTPException(status_code=502, detail="TTS service unavailable")
