"""LLM access via any OpenAI-compatible endpoint (OpenRouter, Groq, ...).

DeepSeek R1 emits chain-of-thought either in a `reasoning` field or inside
<think>...</think> tags; helpers below separate reasoning from the answer.
"""

import json
import re
from functools import lru_cache

from openai import OpenAI

from ..config import get_settings

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


@lru_cache
def _client() -> OpenAI:
    s = get_settings()
    return OpenAI(base_url=s.llm_base_url, api_key=s.llm_api_key)


def _extra_body() -> dict:
    # OpenRouter routes each request to one of several upstream providers,
    # whose speed varies wildly; prefer the highest-throughput one.
    # (Param is OpenRouter-specific — Groq etc. would reject it.)
    if "openrouter" in get_settings().llm_base_url:
        return {"provider": {"sort": "throughput"}}
    return {}


def chat(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.2,
    effort: str | None = None,
) -> tuple[str, str]:
    """Returns (answer, reasoning). `effort` ('low'/'medium'/'high') controls
    how much the model thinks before answering (OpenRouter reasoning param)."""
    s = get_settings()
    extra = _extra_body()
    if effort and "openrouter" in s.llm_base_url:
        extra = {**extra, "reasoning": {"effort": effort}}
    resp = _client().chat.completions.create(
        model=model or s.llm_model,
        messages=messages,
        temperature=temperature,
        extra_body=extra,
    )
    msg = resp.choices[0].message
    content = msg.content or ""
    reasoning = getattr(msg, "reasoning", None) or ""
    thinks = _THINK_RE.findall(content)
    if thinks:
        reasoning = reasoning or "\n".join(t[7:-8].strip() for t in thinks)
        content = _THINK_RE.sub("", content).strip()
    return content.strip(), reasoning.strip()


def ask_about_image(question: str, image_data_url: str, system: str | None = None) -> tuple[str, str]:
    """Ask the configured vision model about an image. Returns (answer, reasoning)."""
    s = get_settings()
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": question},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }
    )
    resp = _client().chat.completions.create(
        model=s.vision_model,
        messages=messages,
        temperature=0.2,
        extra_body=_extra_body(),
    )
    msg = resp.choices[0].message
    content = _THINK_RE.sub("", msg.content or "").strip()
    return content, (getattr(msg, "reasoning", None) or "").strip()


def chat_json(messages: list[dict], model: str | None = None) -> dict | list | None:
    """Chat call whose reply is expected to be JSON; tolerates code fences
    and R1 thinking tags. Returns None if parsing fails."""
    content, _ = chat(messages, model=model, temperature=0.0)
    content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.MULTILINE).strip()
    match = re.search(r"[\[{].*[\]}]", content, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
