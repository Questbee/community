# Questbee Community Edition

[![CI](https://github.com/Questbee/community/actions/workflows/ci.yml/badge.svg)](https://github.com/Questbee/community/actions/workflows/ci.yml)

Questbee is a self-hosted, offline-first field data collection platform. Build forms in the browser, collect data on Android with no internet required, and sync automatically when connectivity is restored — all on your own infrastructure.

**No external cloud. No per-submission fees. Full data sovereignty.**

---

## Features

**Form builder**
- Drag-and-drop form builder with 20+ field types
- Conditional logic (show/hide fields based on answers)
- Published/draft versioning — publish when ready, never interrupt live data collection
- Import and export form schemas as JSON

**Field types**
Text, textarea, number, email, phone, date, time, datetime, single choice, multiple choice, note, divider, group, repeat, calculated, hidden, photo, audio, signature (finger-drawn), file attachment, GPS point, GPS trace, route tracking, barcode

**Mobile app (Android)**
- Works fully offline — submissions queue locally until sync
- Automatic background sync when connected
- Media uploads (photos, audio, signatures, files) retried until confirmed
- Paired to a server with a QR code — no account needed on the device

**Data management**
- Submissions dashboard with search and filtering
- Export to CSV, GeoJSON, GPX, or a full ZIP package (data + media)
- Media files served securely through the API

**Platform**
- Multi-tenant — one instance serves multiple organizations
- Role-based access: admin, manager, field worker
- Headless API for programmatic form discovery and submission
- Webhooks on new submissions
- API key management

---

## Quickstart

**Requirements:** Docker and Docker Compose.

```bash
git clone https://github.com/Questbee/community.git
cd community
./questbee install
```

The setup wizard checks Docker, prompts for your admin email and password, generates strong random secrets, writes your `.env`, and starts all containers automatically.

> **Windows:** run `questbee install` from Command Prompt, or double-click `questbee.bat`.

Once ready, open the dashboard:

| Service | URL |
|---|---|
| Web dashboard | http://localhost:3000 |
| API (Swagger docs) | http://localhost:8000/docs |

Log in with the credentials you entered during setup. **Change the password on first login.**

### Day-to-day commands

```
./questbee start      # start the server
./questbee stop       # stop the server
./questbee restart    # restart after editing .env
./questbee logs       # stream live logs
./questbee status     # check container health
./questbee update     # pull latest version and restart
./questbee hostname   # print all URLs (useful for mobile pairing)
./questbee help       # show all commands
```

Full reference: [docs/cli-reference](https://questbee.io/docs/cli-reference.html)

---

## Configuration

All configuration is through environment variables. See [`.env.example`](.env.example) for the full reference.

| Variable | Required | Description |
|---|---|---|
| `DB_PASSWORD` | Yes | PostgreSQL password |
| `SECRET_KEY` | Yes | JWT signing secret (32+ random chars) |
| `ADMIN_EMAIL` | No | First admin account email (default: `admin@yourorg.com`) |
| `ADMIN_PASSWORD` | No | First admin account password (default: `changeme`) |
| `ALLOWED_ORIGINS` | No | CORS origins for the dashboard (default: `http://localhost:3000`) |
| `NEXT_PUBLIC_API_URL` | No | API URL as seen from the browser (default: `http://localhost:8000/api/v1`) |

---

## Production deployment

Use the production compose override to remove direct port exposure and sit behind a reverse proxy (Caddy, nginx, Traefik):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Key production checklist:
- Set strong `DB_PASSWORD` and `SECRET_KEY`
- Set `ALLOWED_ORIGINS` to your dashboard domain
- Set `NEXT_PUBLIC_API_URL` to your public API URL
- Put a TLS-terminating reverse proxy in front of both services
- Mount a persistent volume for media files (`/data/media`)

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web dashboard │     │   Mobile app    │     │  Headless API   │
│   (Next.js 14)  │     │  (Expo/Android) │     │  (REST clients) │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                        │
         └───────────────────────┼────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │      FastAPI backend     │
                    │  Python 3.11 / asyncpg  │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │      PostgreSQL 15       │
                    └─────────────────────────┘
```

- **API** — FastAPI with async SQLAlchemy, Alembic migrations, JWT auth
- **Web** — Next.js 14 App Router, Tailwind CSS
- **Mobile** — Expo (React Native), SQLite offline store, background sync
- **Storage** — Media files on local disk (Docker volume), paths recorded in PostgreSQL

---

## Mobile app

The Android app is free to download — no account required on the device.

**[Download APK → github.com/Questbee/app/releases](https://github.com/Questbee/app/releases)**

To pair the app with your server: log into the web dashboard, go to **Settings → Mobile Pairing**, and click **Generate QR Code**. Open the app, tap **Scan QR Code**, and point the camera at the code. The app connects and downloads your forms automatically.

Mobile app source code is commercial and available with paid plans.

---

## Development

### API

```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# start a local postgres, then:
alembic upgrade head
uvicorn app.main:app --reload
```

### Web

```bash
cd web
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1 npm run dev
```

### Tests

```bash
cd api
pytest
```

---

## License

The server platform (this repository) is MIT licensed. See [LICENSE](LICENSE).

The mobile app binary is free to use but its source is not included here.
