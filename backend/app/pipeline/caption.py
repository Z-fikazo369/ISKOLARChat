"""Phase 2 Step 2 — Multimodal captioning with Moondream.

Uses the Moondream Cloud API. If MOONDREAM_API_KEY is not set (or a call
fails), captioning is skipped gracefully so ingestion never blocks on it.
"""

import base64

import requests

from ..config import get_settings

_API_URL = "https://api.moondream.ai/v1/caption"
_QUERY_URL = "https://api.moondream.ai/v1/query"

# Tiny images are almost always logos/decorations — not worth captioning.
_MIN_IMAGE_BYTES = 5_000


def _data_url(image_bytes: bytes) -> str:
    return f"data:image/jpeg;base64,{base64.b64encode(image_bytes).decode()}"


def caption_image(image_bytes: bytes) -> str | None:
    s = get_settings()
    if not s.moondream_api_key or len(image_bytes) < _MIN_IMAGE_BYTES:
        return None
    try:
        resp = requests.post(
            _API_URL,
            headers={"X-Moondream-Auth": s.moondream_api_key},
            json={"image_url": _data_url(image_bytes), "length": "normal"},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("caption")
    except Exception:
        return None


def query_image(image_bytes: bytes, question: str) -> str | None:
    """Visual question answering — used for student-attached images."""
    s = get_settings()
    if not s.moondream_api_key:
        return None
    try:
        resp = requests.post(
            _QUERY_URL,
            headers={"X-Moondream-Auth": s.moondream_api_key},
            json={"image_url": _data_url(image_bytes), "question": question},
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json().get("answer")
    except Exception:
        return None
