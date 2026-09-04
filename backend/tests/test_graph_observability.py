import logging

from app.agent import graph


def test_timed_node_logs_stage_duration(caplog) -> None:
    wrapped = graph._timed_node("sample", lambda _state: {"answer": "ok"})

    with caplog.at_level(logging.INFO, logger=graph.__name__):
        result = wrapped({"trace_id": "trace-123"})

    assert result == {"answer": "ok"}
    assert "agent_stage_completed trace_id=trace-123 stage=sample" in caplog.text
    assert "duration_ms=" in caplog.text


def test_run_agent_adds_trace_and_logs_total(monkeypatch, caplog) -> None:
    captured = {}

    class FakeGraph:
        def invoke(self, state):
            captured.update(state)
            return {**state, "answer": "ok", "escalated": False}

    monkeypatch.setattr(graph, "_graph", FakeGraph())

    with caplog.at_level(logging.INFO, logger=graph.__name__):
        result = graph.run_agent("Question", student={"id": "student-1"})

    assert result["answer"] == "ok"
    assert len(captured["trace_id"]) == 32
    assert captured["student_id"] == "student-1"
    assert "agent_request_completed trace_id=" in caplog.text
    assert "escalated=False" in caplog.text


def _candidates(n: int) -> list[dict]:
    return [{"text": f"chunk {i}", "id": str(i)} for i in range(n)]


def test_grade_falls_back_to_top_candidates_when_grader_fails(monkeypatch, caplog) -> None:
    """chat_json returning None (grader outage) must NOT zero out every
    chunk — that would escalate an answerable question to a human. It keeps
    the top candidates by retrieval rank instead, like the naive baseline."""
    monkeypatch.setattr(graph.llm, "chat_json", lambda messages, model=None: None)

    with caplog.at_level(logging.WARNING, logger=graph.__name__):
        result = graph.grade(
            {"question": "q", "candidates": _candidates(4)}
        )

    assert [c["id"] for c in result["relevant"]] == ["0", "1", "2", "3"]
    assert "falling back" in caplog.text


def test_grade_fallback_is_capped_at_final_top_k(monkeypatch) -> None:
    monkeypatch.setattr(graph.llm, "chat_json", lambda messages, model=None: None)

    result = graph.grade(
        {"question": "q", "candidates": _candidates(20)}
    )

    assert len(result["relevant"]) == graph.get_settings().final_top_k


def test_grade_still_filters_normally_when_scores_parse(monkeypatch) -> None:
    monkeypatch.setattr(
        graph.llm, "chat_json", lambda messages, model=None: [0.9, 0.0, 0.7, "junk"]
    )

    result = graph.grade(
        {"question": "q", "candidates": _candidates(4)}
    )

    assert [c["id"] for c in result["relevant"]] == ["0", "2"]
    assert result["relevant"][0]["grade_score"] == 0.9
