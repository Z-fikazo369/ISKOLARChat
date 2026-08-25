from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile

from app.routers import chat as chat_router


TEST_USER = {
    "id": "student-1",
    "email": "student@example.com",
    "name": "Student",
    "role": "student",
}


def test_chat_returns_agent_result(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    def fake_run_agent(question, **kwargs):
        captured["question"] = question
        captured.update(kwargs)
        return {
            "answer": "Verified answer",
            "reasoning": "",
            "sources": [{"document_name": "handbook.pdf"}],
            "escalated": False,
        }

    monkeypatch.setattr(chat_router, "run_agent", fake_run_agent)
    body = chat_router.ChatRequest(
        question="  Enrollment requirements?  ",
        model_variant="flash",
        reasoning_effort="low",
    )

    response = chat_router.chat(body, user=TEST_USER)

    assert response.answer == "Verified answer"
    assert response.sources == [{"document_name": "handbook.pdf"}]
    assert captured["question"] == "Enrollment requirements?"
    assert captured["student"] == TEST_USER
    assert captured["model"] == chat_router._model_for_variant("flash")
    assert captured["effort"] == "low"


def test_unknown_model_variant_uses_default_model(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    def fake_run_agent(_question, **kwargs):
        captured.update(kwargs)
        return {"answer": "Hello"}

    monkeypatch.setattr(chat_router, "run_agent", fake_run_agent)
    body = chat_router.ChatRequest(question="Hello", model_variant="not-allowed")

    chat_router.chat(body, user=TEST_USER)

    assert captured["model"] is None


def test_chat_converts_agent_failure_to_503(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_agent(*_args, **_kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(chat_router, "run_agent", fail_agent)

    with pytest.raises(HTTPException) as exc:
        chat_router.chat(chat_router.ChatRequest(question="Hello"), user=TEST_USER)
    assert exc.value.status_code == 503


def test_file_chat_rejects_oversized_upload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chat_router, "MAX_FILE_BYTES", 4)
    upload = UploadFile(filename="large.txt", file=BytesIO(b"12345"))

    with pytest.raises(HTTPException) as exc:
        chat_router.chat_with_file("Summarize", upload, user=TEST_USER)
    assert exc.value.status_code == 413


def test_file_chat_rejects_unsupported_type() -> None:
    upload = UploadFile(filename="grades.csv", file=BytesIO(b"a,b\n1,2"))

    with pytest.raises(HTTPException) as exc:
        chat_router.chat_with_file("Summarize", upload, user=TEST_USER)
    assert exc.value.status_code == 422


def test_file_chat_rejects_malformed_pdf() -> None:
    upload = UploadFile(filename="fake.pdf", file=BytesIO(b"not a pdf"))

    with pytest.raises(HTTPException) as exc:
        chat_router.chat_with_file("Summarize", upload, user=TEST_USER)
    assert exc.value.status_code == 422


def test_file_chat_rejects_malformed_docx() -> None:
    upload = UploadFile(filename="fake.docx", file=BytesIO(b"not a zip"))

    with pytest.raises(HTTPException) as exc:
        chat_router.chat_with_file("Summarize", upload, user=TEST_USER)
    assert exc.value.status_code == 422


def test_text_file_chat_returns_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chat_router.llm, "chat", lambda *_args, **_kwargs: ("Summary", ""))
    upload = UploadFile(filename="memo.txt", file=BytesIO(b"Enrollment starts Monday."))

    response = chat_router.chat_with_file("Summarize", upload, user=TEST_USER)

    assert response.answer == "Summary"
    assert response.escalated is False
    assert response.sources[0]["source"] == "attachment"
