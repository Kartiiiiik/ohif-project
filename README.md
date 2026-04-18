# OHIFviewer

A personal self-hosted DICOM medical imaging viewer. Built for radiologists and developers who want full control over their imaging stack, without relying on cloud services.

> **Stack:** Cornerstone3D + React + Django + Orthanc + PostgreSQL + Redis + Docker

---

## Screenshots

<!-- Add your screenshots here -->
| Study List | Viewer |
|------------|--------|
| <img width="1568" height="744" alt="image" src="https://github.com/user-attachments/assets/c4cde557-20d1-4f0d-b96c-51b6570fa09f" /> | <img width="1919" height="917" alt="image" src="https://github.com/user-attachments/assets/9312fcb5-94a6-40ff-9eba-b662f8fc048f" /> |

---

## Features

- Browse and search DICOM studies and series from a local Orthanc PACS
- View medical images in-browser using WebGL-accelerated Cornerstone3D rendering
- Switch between Stack, MPR, and Fusion view modes
- Multi-viewport layouts: 1x1, 1x2, 2x2
- Annotation tools: Length, Angle, Ellipse ROI, Rectangle ROI, Arrow
- Window/Level, Pan, Zoom, and scroll controls
- Save and load annotations via a REST API backend
- JWT-based authentication with user accounts
- Sync studies from Orthanc into a local PostgreSQL database
- Async background tasks via Celery and Redis
- Everything runs locally via Docker Compose

---

## Architecture

```
ohif-project/
├── backend/                   # Django REST API
│   ├── config/                # Settings, URLs, Celery config, WSGI
│   ├── apps/
│   │   ├── users/             # Auth, user model, JWT
│   │   ├── studies/           # Study metadata + Orthanc proxy
│   │   └── annotations/       # Cornerstone annotation storage
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/                  # React + Vite app
│   ├── src/
│   │   ├── api/               # Axios client, auth/studies/annotations
│   │   ├── components/
│   │   │   ├── Viewer/        # CornerstoneViewport, ViewerLayout
│   │   │   ├── StudyList/     # Study + series browser
│   │   │   └── Toolbar/       # Tool switcher, layout picker
│   │   ├── hooks/             # useCornerstoneInit, useImageIds
│   │   ├── pages/             # LoginPage, ViewerPage
│   │   └── store/             # Zustand: auth and viewer state
│   ├── package.json
│   └── Dockerfile
│
├── orthanc/
│   └── orthanc.json           # Orthanc config + DICOMweb plugin
│
├── nginx/
│   └── nginx.conf             # Reverse proxy routing
│
├── docker-compose.yml
├── .env.example
└── README.md
```

### How the services connect

```
Browser
  └── Nginx (port 80)
        ├── /           -> Frontend (React, port 5173)
        ├── /api        -> Backend (Django, port 8000)
        └── /orthanc    -> Orthanc PACS (port 8042)

Backend
  ├── PostgreSQL (port 5432)  — stores users, studies, annotations
  └── Redis (port 6379)       — Celery task queue

Celery Worker
  └── Connects to Redis + PostgreSQL for background jobs
```

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

### 1. Clone and configure

```bash
git clone <your-repo>
cd ohif-project
cp .env.example .env
```

Open `.env` and fill in your secrets (see [Environment Variables](#environment-variables) below).

### 2. Start everything

```bash
docker compose up --build
```

### 3. Run database setup

```bash
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

### 4. Open in browser

| Service | URL |
|---------|-----|
| Viewer app | http://localhost |
| Django admin | http://localhost/admin |
| Orthanc UI | http://localhost/orthanc |
| DICOMweb root | http://localhost/orthanc/dicom-web |

---

## Uploading DICOM Files

```bash
# Upload a DICOM file via Orthanc REST API
curl -u admin:orthanc -X POST http://localhost/orthanc/instances \
  --data-binary @/path/to/your.dcm
```

Or use the Orthanc web UI at http://localhost/orthanc, then click "Upload" and drag your `.dcm` files in.

After uploading, hit the **Sync** button in the viewer (top right) to pull the new studies into the local database.

---

## Viewer Tools

| Tool | Mouse Button | Keyboard |
|------|-------------|----------|
| Window/Level | Left click + drag | W |
| Pan | Middle click | P |
| Zoom | Right click + drag | Z |
| Scroll stack | Mouse wheel | - |
| Length | Left click | L |
| Angle | Left click | A |
| Ellipse ROI | Left click | E |
| Rectangle ROI | Left click | R |
| Arrow | Left click | - |

---

## API Reference

### Auth `/api/auth/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `register/` | Create account |
| POST | `login/` | Get JWT tokens |
| POST | `token/refresh/` | Refresh access token |
| GET | `me/` | Current user info |
| POST | `change-password/` | Update password |

### Studies `/api/studies/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List studies from local DB |
| GET | `orthanc/all/` | List studies from Orthanc |
| GET | `orthanc/<id>/` | Study detail from Orthanc |
| GET | `orthanc/<id>/series/` | Series list from Orthanc |
| POST | `orthanc/sync/` | Sync Orthanc to local DB |

### Annotations `/api/annotations/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List annotations (filter by study) |
| POST | `/` | Create annotation |
| PATCH | `/<id>/` | Update annotation |
| DELETE | `/<id>/` | Delete annotation |

---

## Environment Variables

Copy `.env.example` to `.env` and set the following:

| Variable | Description |
|----------|-------------|
| `DJANGO_SECRET_KEY` | Django secret key (keep this private) |
| `DJANGO_DEBUG` | `True` for dev, `False` for production |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `ORTHANC_URL` | Internal Orthanc URL (e.g. `http://orthanc:8042`) |
| `ORTHANC_USERNAME` | Orthanc admin username |
| `ORTHANC_PASSWORD` | Orthanc admin password |
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` | Access token expiry |
| `JWT_REFRESH_TOKEN_LIFETIME_DAYS` | Refresh token expiry |

---

## Development

### Useful commands

```bash
# Watch backend logs
docker compose logs -f backend

# Watch Orthanc logs
docker compose logs -f orthanc

# Open Django shell
docker compose exec backend python manage.py shell
```

### Local dev without Docker

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) first.

```powershell
# Windows: one-time setup
.\setup.ps1

# Start Django
cd backend
uv run python manage.py runserver

# Add a Python dependency
uv add <package-name>

# Install a frontend package
cd frontend
npm install <package-name>
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Image rendering | Cornerstone3D (WebGL) |
| Frontend | React, Vite, Zustand |
| Backend API | Django, Django REST Framework |
| Auth | JWT (SimpleJWT) |
| DICOM server | Orthanc with DICOMweb plugin |
| Database | PostgreSQL 16 |
| Task queue | Celery + Redis |
| Reverse proxy | Nginx |
| Containers | Docker Compose |
| Python packaging | uv |

---

## License

MIT
