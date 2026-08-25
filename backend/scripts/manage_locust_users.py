r"""Create and remove temporary Supabase users for realistic Locust runs.

From the repository root:

    backend\.venv\Scripts\python.exe backend\scripts\manage_locust_users.py create --count 3
    backend\.venv\Scripts\python.exe backend\scripts\manage_locust_users.py delete

The generated credentials never get printed. Only short-lived access tokens
are written to the ignored token file consumed by ``locustfile.py``.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import secrets
import sys
import time
import uuid

from supabase import create_client
from supabase.lib.client_options import SyncClientOptions


BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings  # noqa: E402
from app.services.supabase_client import get_supabase  # noqa: E402


DEFAULT_TOKEN_FILE = REPO_DIR / "locust-tokens.generated.txt"
DEFAULT_STATE_FILE = REPO_DIR / ".locust-users.generated.json"


def _delete_users(user_ids: list[str]) -> None:
    admin = get_supabase().auth.admin
    failures: list[str] = []
    for user_id in user_ids:
        try:
            admin.delete_user(user_id)
        except Exception as exc:
            failures.append(f"{user_id}: {exc}")
    if failures:
        raise RuntimeError("Could not remove every test user: " + "; ".join(failures))


def create_users(count: int, token_file: Path, state_file: Path) -> None:
    if count < 1:
        raise ValueError("--count must be at least 1")
    if state_file.exists():
        raise RuntimeError(
            f"State file already exists: {state_file}. Run the delete command first."
        )

    settings = get_settings()
    admin = get_supabase().auth.admin
    created: list[dict[str, str]] = []
    tokens: list[str] = []
    run_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"

    try:
        for index in range(1, count + 1):
            email = f"iskolarchat-loadtest-{run_id}-{index}@example.com"
            password = secrets.token_urlsafe(32)
            response = admin.create_user(
                {
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                    "user_metadata": {"full_name": f"Load Test User {index}"},
                }
            )
            user = response.user
            if user is None:
                raise RuntimeError(f"Supabase did not return the created user for {email}")

            created.append({"id": str(user.id), "email": email})
            auth_client = create_client(
                settings.supabase_url,
                settings.supabase_service_role_key,
                options=SyncClientOptions(auto_refresh_token=False, persist_session=False),
            )
            auth = auth_client.auth.sign_in_with_password(
                {"email": email, "password": password}
            )
            if auth.session is None:
                raise RuntimeError(f"Supabase did not create a session for {email}")
            tokens.append(auth.session.access_token)

        token_file.write_text("\n".join(tokens) + "\n", encoding="utf-8")
        state_file.write_text(json.dumps({"users": created}, indent=2), encoding="utf-8")
    except Exception:
        _delete_users([user["id"] for user in created])
        token_file.unlink(missing_ok=True)
        state_file.unlink(missing_ok=True)
        raise

    print(f"Created {len(created)} temporary student accounts.")
    print(f"Token file: {token_file}")
    print("Run the delete command after the load test to remove the accounts.")


def delete_users(token_file: Path, state_file: Path) -> None:
    if not state_file.exists():
        token_file.unlink(missing_ok=True)
        print("No generated Locust users were recorded.")
        return

    state = json.loads(state_file.read_text(encoding="utf-8"))
    user_ids = [user["id"] for user in state.get("users", [])]
    _delete_users(user_ids)
    token_file.unlink(missing_ok=True)
    state_file.unlink(missing_ok=True)
    print(f"Deleted {len(user_ids)} temporary student accounts and local token files.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=("create", "delete"), help="Provision or clean up test users"
    )
    parser.add_argument("--count", type=int, default=3, help="Users to create (default: 3)")
    parser.add_argument("--token-file", type=Path, default=DEFAULT_TOKEN_FILE)
    parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE_FILE)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    token_file = args.token_file.resolve()
    state_file = args.state_file.resolve()
    if args.command == "create":
        create_users(args.count, token_file, state_file)
    else:
        delete_users(token_file, state_file)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Locust user setup failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
