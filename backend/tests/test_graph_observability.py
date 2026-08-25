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
