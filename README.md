# OHIF Cornerstone Viewer

A personal DICOM medical imaging viewer built with:
- **Cornerstone3D** — WebGL image rendering & annotation tools
- **React + Vite** — Frontend
- **Django + DRF** — Backend API & auth
- **Orthanc** — DICOM server with DICOMweb support
- **PostgreSQL** — Database
- **Redis + Celery** — Async task queue
- **Nginx** — Reverse proxy
- **Docker Compose** — Local orchestration

---

## Quick Start

### 1. Clone & configure

```bash
git clone <your-repo>
cd ohif-project
cp .env.example .env
# Edit .env with your secrets
```

### 2. Start all services

```bash
docker compose up --build
```

### 3. Run Django migrations

```bash
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

### 4. Open in browser

| Service       | URL                        |
|---------------|----------------------------|
| Viewer app    | http://localhost           |
| Django admin  | http://localhost/admin     |
| Orthanc UI    | http://localhost/orthanc   |
| DICOMweb root | http://localhost/orthanc/dicom-web |

---

## Project Structure

```
ohif-project/
├── backend/                   # Django project
│   ├── config/                # Settings, URLs, Celery, WSGI
│   ├── apps/
│   │   ├── users/             # Auth, user model, JWT
│   │   ├── studies/           # Study metadata + Orthanc proxy
│   │   └── annotations/       # Cornerstone annotation storage
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/                  # React + Vite
│   ├── src/
│   │   ├── api/               # Axios client, auth/studies/annotations
│   │   ├── components/
│   │   │   ├── Viewer/        # CornerstoneViewport, ViewerLayout
│   │   │   ├── StudyList/     # Study + series browser
│   │   │   └── Toolbar/       # Tool switcher, layout picker
│   │   ├── hooks/             # useCornerstoneInit, useImageIds
│   │   ├── pages/             # LoginPage, ViewerPage
│   │   └── store/             # Zustand: auth, viewer state
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

---

## API Endpoints

### Auth (`/api/auth/`)
| Method | Endpoint             | Description           |
|--------|---------------------|-----------------------|
| POST   | `register/`         | Create account        |
| POST   | `login/`            | Get JWT tokens        |
| POST   | `token/refresh/`    | Refresh access token  |
| GET    | `me/`               | Current user info     |
| POST   | `change-password/`  | Update password       |

### Studies (`/api/studies/`)
| Method | Endpoint               | Description                   |
|--------|------------------------|-------------------------------|
| GET    | `/`                    | List studies from local DB    |
| GET    | `orthanc/all/`         | List studies from Orthanc     |
| GET    | `orthanc/<id>/`        | Study detail from Orthanc     |
| GET    | `orthanc/<id>/series/` | Series list from Orthanc      |
| POST   | `orthanc/sync/`        | Sync Orthanc → local DB       |

### Annotations (`/api/annotations/`)
| Method | Endpoint  | Description                        |
|--------|-----------|------------------------------------|
| GET    | `/`       | List annotations (filter by study) |
| POST   | `/`       | Create annotation                  |
| PATCH  | `/<id>/`  | Update annotation                  |
| DELETE | `/<id>/`  | Delete annotation                  |

---

## Uploading DICOM Files to Orthanc

```bash
# Upload a DICOM file directly via Orthanc REST API
curl -u admin:orthanc -X POST http://localhost/orthanc/instances \
  --data-binary @/path/to/your.dcm

# Or use the Orthanc web UI
open http://localhost/orthanc
```

---

## Available Viewer Tools

| Tool          | Mouse Button     | Keyboard shortcut |
|---------------|------------------|-------------------|
| Window/Level  | Left click+drag  | W                 |
| Pan           | Middle click     | P                 |
| Zoom          | Right click+drag | Z                 |
| Scroll Stack  | Mouse wheel      | —                 |
| Length        | Left click       | L                 |
| Angle         | Left click       | A                 |
| Ellipse ROI   | Left click       | E                 |
| Rectangle ROI | Left click       | R                 |
| Arrow         | Left click       | —                 |

---

## Development Tips

```bash
# Watch Django logs
docker compose logs -f backend

# Watch Orthanc logs
docker compose logs -f orthanc

# Run Django shell (Docker)
docker compose exec backend uv run python manage.py shell

# Run Django shell (local)
cd backend && uv run python manage.py shell
```

### Local dev without Docker

Install uv: https://docs.astral.sh/uv/getting-started/installation/

```powershell
# Windows — one-time setup
.\setup.ps1

# Start Django locally
cd backend
uv run python manage.py runserver

# Add a new Python dependency
uv add <package-name>
# This updates pyproject.toml and uv.lock automatically

# Install new npm packages
cd frontend
npm install <pkg>
```

---

## Environment Variables

| Variable                          | Description                    |
|-----------------------------------|--------------------------------|
| `DJANGO_SECRET_KEY`               | Django secret key              |
| `DJANGO_DEBUG`                    | `True` for dev, `False` for prod |
| `DATABASE_URL`                    | Postgres connection string     |
| `REDIS_URL`                       | Redis connection string        |
| `ORTHANC_URL`                     | Internal Orthanc URL           |
| `ORTHANC_USERNAME`                | Orthanc admin username         |
| `ORTHANC_PASSWORD`                | Orthanc admin password         |
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` | JWT access token TTL          |
| `JWT_REFRESH_TOKEN_LIFETIME_DAYS`  | JWT refresh token TTL         |
