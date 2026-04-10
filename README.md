# Comparative Environmental Monitoring of Moss-Based Cooling Using Dual ESP32 System

Production-ready full-stack IoT monitoring dashboard that stores, visualizes, and compares environmental readings from two ESP32 nodes:

- Node 1: moss
- Node 2: non_moss

## Project Structure

- `backend/` FastAPI + SQLAlchemy + MSSQL API
- `frontend/` static HTML/CSS/JavaScript dashboard (Chart.js)

## Backend Quick Start

1. Go to backend folder.
2. Create and activate virtual environment.
3. Install dependencies.
4. Configure environment variables.
5. Apply SQL schema.
6. Run API.

```bash
cd backend
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env with your MSSQL credentials

# Run SQL script in SQL Server Management Studio or sqlcmd:
# backend/schema.sql

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

API docs:

- Swagger UI: http://127.0.0.1:8000/docs
- ReDoc: http://127.0.0.1:8000/redoc

## Frontend Quick Start

Serve `frontend/` as static files (recommended) or open files directly in browser.

Example (Python static server):

```bash
cd frontend
python -m http.server 5500
```

Then open:

- http://127.0.0.1:5500/index.html

## API Endpoints

- `POST /api/data/moss`
- `POST /api/data/non-moss`
- `GET /api/data/latest`
- `GET /api/data/history?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /api/data/compare`

## Deployment Notes (Ubuntu VPS)

### Backend (Gunicorn + Uvicorn workers)

```bash
cd /opt/iot-monitor/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker \
  -w 3 \
  -b 0.0.0.0:8000
```

Use `systemd` for process supervision.

### Frontend (Nginx)

- Copy `frontend/` files to `/var/www/iot-monitor/`
- Configure Nginx server block to serve static files
- Reverse proxy `/api/` to backend service if desired

## Example JSON Payloads

### Moss

```json
{
  "node": "moss",
  "outdoorTemp": 33.5,
  "outdoorHumidity": 64.2,
  "mossSurfaceTemp": 25.4,
  "nearMossTemp": 27.1,
  "nearMossHumidity": 73.5,
  "wallTemp": 29.8,
  "timestamp": "2026-04-09T10:30:00"
}
```

### Non-Moss

```json
{
  "node": "non_moss",
  "nonMossSurfaceTemp": 31.9,
  "nearNonMossTemp": 30.1,
  "nearNonMossHumidity": 61.4,
  "wallTemp": 32.0,
  "timestamp": "2026-04-09T10:30:00"
}
```
