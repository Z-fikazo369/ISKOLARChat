r"""Interactively reset the Supabase Auth password for a super-admin account.

Run from the backend directory:
    .\.venv\Scripts\python.exe scripts\reset_superadmin_password.py

The password is read with getpass, so it is not echoed or stored in shell
history. The Supabase service-role key is loaded through the existing backend
configuration and is never printed.
"""

from getpass import getpass
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.supabase_client import get_supabase  # noqa: E402


def choose_superadmin(profiles: list[dict]) -> dict:
    if not profiles:
        raise RuntimeError("No profile with the superadmin role was found.")
    if len(profiles) == 1:
        return profiles[0]

    print("Multiple super-admin profiles were found:")
    for profile in profiles:
        print(f"  - {profile.get('email') or profile['id']}")

    email = input("Email to reset: ").strip().lower()
    for profile in profiles:
        if (profile.get("email") or "").lower() == email:
            return profile
    raise RuntimeError("That email is not a super-admin profile.")


def read_new_password() -> str:
    password = getpass("New password (minimum 8 characters): ")
    if len(password) < 8:
        raise RuntimeError("Password must be at least 8 characters.")
    if password != getpass("Confirm new password: "):
        raise RuntimeError("Passwords do not match.")
    return password


def main() -> None:
    supabase = get_supabase()
    result = (
        supabase.table("profiles")
        .select("id,email,role")
        .eq("role", "superadmin")
        .execute()
    )
    profile = choose_superadmin(result.data or [])
    email = profile.get("email") or profile["id"]

    confirm = input(f"Reset the password for {email}? [y/N]: ").strip().lower()
    if confirm not in {"y", "yes"}:
        print("Password reset cancelled.")
        return

    password = read_new_password()
    supabase.auth.admin.update_user_by_id(profile["id"], {"password": password})
    print(f"Password updated successfully for {email}.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nPassword reset cancelled.")
        raise SystemExit(1)
    except Exception as exc:
        print(f"Password reset failed: {exc}")
        raise SystemExit(1)
