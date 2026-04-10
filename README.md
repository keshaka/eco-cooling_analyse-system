# Comparative Environmental Monitoring of Moss-Based Cooling

IoT monitoring project that collects, stores, and compares environmental readings from two ESP32 nodes:

- `moss`
- `non_moss`

## Project Structure

- `backend/` FastAPI + SQLAlchemy + MSSQL API
- `frontend/` static dashboard (HTML, CSS, JavaScript)
- `sketch/` ESP32 Arduino sketches

## Run Backend

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Create .env and set MSSQL credentials
# Run schema: backend/schema.sql

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

API docs:

- Swagger: http://127.0.0.1:8000/docs
- ReDoc: http://127.0.0.1:8000/redoc

## Run Frontend

```bash
cd frontend
python -m http.server 5500
```

Open: http://127.0.0.1:5500/index.html

## Main API Endpoints

- `POST /api/data/moss`
- `POST /api/data/non-moss`
- `GET /api/data/latest`
- `GET /api/data/history?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `GET /api/data/compare`
