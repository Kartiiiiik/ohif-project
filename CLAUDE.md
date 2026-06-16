# CLAUDE.md

Behavioral guidelines and project context for this DICOM viewer codebase.

---

## Project Overview

**OHIFviewer** — a self-hosted DICOM medical imaging viewer built for radiologists and developers.

**Stack:** Cornerstone3D + React + Vite + Zustand · Django + DRF · Orthanc PACS · PostgreSQL + Redis + Celery · Nginx · Docker Compose

### Key entry points

| Layer | Path |
|-------|------|
| Frontend app | [frontend/src/](frontend/src/) |
| Viewer components | [frontend/src/components/Viewer/](frontend/src/components/Viewer/) |
| Study list / series browser | [frontend/src/components/StudyList/](frontend/src/components/StudyList/) |
| Toolbar (tools, layouts) | [frontend/src/components/Toolbar/](frontend/src/components/Toolbar/) |
| Cornerstone init hook | [frontend/src/hooks/](frontend/src/hooks/) |
| Zustand stores (auth + viewer) | [frontend/src/store/](frontend/src/store/) |
| Axios API clients | [frontend/src/api/](frontend/src/api/) |
| Django config (settings, URLs, Celery) | [backend/config/](backend/config/) |
| Auth app (JWT, user model) | [backend/apps/users/](backend/apps/users/) |
| Studies app (Orthanc proxy, sync) | [backend/apps/studies/](backend/apps/studies/) |
| Annotations app | [backend/apps/annotations/](backend/apps/annotations/) |
| Orthanc config | [orthanc/orthanc.json](orthanc/orthanc.json) |
| Nginx routing | [nginx/nginx.conf](nginx/nginx.conf) |
| DICOM auto-upload script | [upload_dicom_files.sh](upload_dicom_files.sh) |
| Compose definition | [docker-compose.yml](docker-compose.yml) |

### Service routing (via Nginx on port 80)

```
/           → React frontend (port 5173)
/api        → Django backend (port 8000)
/orthanc    → Orthanc PACS (port 8042)
```

### DICOM auto-upload flow

Files dropped in `dicom_files/` are uploaded to Orthanc by the `dicom-uploader` one-shot container at stack startup. After upload, the user hits **Sync** in the UI to pull studies into PostgreSQL.

---

## Running the project

```bash
# Start everything
docker compose up --build

# First-time DB setup
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser

# Local dev without Docker (Windows)
.\setup.ps1
cd backend && uv run python manage.py runserver
cd frontend && npm run dev
```

---

## Behavioral Guidelines

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## Domain notes

- **Cornerstone3D** manages WebGL rendering, tool state, and viewport synchronization. Initialization order matters — tools must be registered before viewports activate.
- **Orthanc** is the DICOM source of truth. The Django `studies` app proxies and caches metadata into PostgreSQL; it does not store pixel data.
- **Annotations** are stored in Django/PostgreSQL, keyed by study/series/instance UID. They are serialized from Cornerstone's annotation state on save.
- **JWT auth** uses SimpleJWT. Access tokens are short-lived; refresh tokens are stored client-side. The Axios client in `frontend/src/api/` handles silent refresh.
- **Celery** handles async background jobs (e.g. study sync). Workers connect to Redis and PostgreSQL — changes to task signatures require restarting the worker container.
