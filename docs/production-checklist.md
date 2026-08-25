# Production deployment checklist

Use separate staging Supabase and Qdrant resources first. Do not run load tests
against production AI accounts or production student data.

## Required before launch

1. Apply every SQL migration through `0011_production_security_hardening.sql`,
   then rerun the Supabase Security and Performance Advisors.
   Pause admin-application reviews during rollout: migration 0011 and the new
   backend/frontend review endpoint must be deployed together.
2. In Auth password settings, enable leaked-password protection (Supabase Pro or
   higher), set a strong minimum password policy, and require email confirmation.
3. Enable CAPTCHA for public auth flows and integrate the provider's frontend
   challenge/token first; enabling only the Dashboard switch will break auth.
4. Configure custom SMTP with a university-controlled sender domain. Supabase's
   default mail service is not intended for production delivery.
5. For university-only registration, configure a Supabase **Before User Created**
   hook that allows approved institutional email domains. A frontend check alone
   is bypassable.
6. Protect Supabase organization owners and application superadmins with MFA.
   Keep at least two organization owners for recovery.
7. Enable database SSL enforcement, suitable network restrictions, backups, and
   Point-in-Time Recovery according to the university's RPO/RTO.
8. Approve privacy and retention rules for chats, uploads, admin applications,
   logs, vectors, and every third-party AI provider before using real data.

## Application environment

Frontend:

```dotenv
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_API_URL=https://api.example.edu
VITE_COMPARE_VIEW_ENABLED=false
```

Backend production environment variables:

```dotenv
APP_ENV=production
CORS_ORIGINS=https://chat.example.edu
RATE_LIMIT_BACKEND=supabase
COMPARE_ENDPOINT_ENABLED=false
API_DOCS_ENABLED=false
DOCUMENT_WORKER_ENABLED=true
```

- Use exact HTTPS CORS origins; never use `*` with credentialed requests.
- Keep service-role and provider keys only in the platform secret manager.
- Keep both comparison flags disabled except during a controlled authenticated
  demo. The endpoint makes multiple paid calls and returns retrieved text.
- Run behind TLS with trusted proxy/host configuration, request-size limits,
  suitable timeouts, and structured logs. Never deploy Uvicorn with `--reload`.

## Storage and data

- Confirm the `documents` bucket is private, PDF-only, and limited to 25 MiB.
- Upload only material authorized for Cohere, the LLM provider, Moondream, and
  Qdrant processing.
- Test restore procedures for Supabase and Qdrant.
- Establish deletion schedules for chat history and admin applications.

## Release checks

```powershell
npm.cmd ci
npm.cmd audit --omit=dev
npm.cmd run build

cd backend
python -m pip install -r requirements-dev.txt
python -m pip_audit -r requirements.txt
python -m pytest
python -m pip check
```

Keep RAGAS evaluation dependencies out of production. Its current release has
an unresolved SSRF advisory in an evaluation-only multimodal URL helper; never
pass untrusted URLs to that helper.

Finally test in staging: signup/confirmation, OAuth callback, every role, admin
review, PDF lifecycle, HITL, multi-instance limits, readiness, key rotation,
and backup restore.
