from types import SimpleNamespace

from fastapi import Request, Response

from app import main
from app.config import invalid_security_settings, missing_required_settings


def _request_with_state(**state_values) -> Request:
    fake_app = SimpleNamespace(state=SimpleNamespace(**state_values))
    return Request({"type": "http", "app": fake_app})


def test_liveness_stays_backward_compatible():
    assert main.health() == {"status": "ok"}


def test_readiness_returns_ready_when_all_checks_pass(monkeypatch):
    worker = SimpleNamespace(done=lambda: False)
    request = _request_with_state(
        configuration_ready=True,
        dependencies_ready=True,
        document_worker_task=worker,
    )
    response = Response()
    monkeypatch.setattr(
        main,
        "get_settings",
        lambda: SimpleNamespace(document_worker_enabled=True),
    )

    result = main.readiness(request, response)

    assert response.status_code == 200
    assert result["status"] == "ready"
    assert all(result["checks"].values())


def test_readiness_returns_503_when_dependency_startup_failed(monkeypatch):
    request = _request_with_state(
        configuration_ready=True,
        dependencies_ready=False,
        document_worker_task=None,
    )
    response = Response()
    monkeypatch.setattr(
        main,
        "get_settings",
        lambda: SimpleNamespace(document_worker_enabled=False),
    )

    result = main.readiness(request, response)

    assert response.status_code == 503
    assert result["status"] == "not_ready"
    assert result["checks"]["dependencies"] is False


def test_missing_settings_reports_names_without_secret_values():
    settings = SimpleNamespace(
        supabase_url="",
        supabase_service_role_key="secret-value",
        qdrant_url="https://qdrant.example",
        cohere_api_key="",
        llm_api_key="llm-secret",
    )

    missing = missing_required_settings(settings)

    assert missing == ["SUPABASE_URL", "COHERE_API_KEY"]
    assert "secret-value" not in str(missing)


def test_security_settings_reject_wildcard_cors():
    settings = SimpleNamespace(
        cors_origins=["*"],
        environment="production",
        rate_limit_backend="supabase",
    )

    invalid = invalid_security_settings(settings)

    assert any("CORS_ORIGINS" in item for item in invalid)


def test_compare_route_is_disabled_by_default():
    assert not any(
        getattr(route, "path", None) == "/api/compare" for route in main.app.routes
    )
