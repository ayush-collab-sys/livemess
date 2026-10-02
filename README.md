# MessMind AI dashboard

An editable dashboard built with HTML, CSS, and JavaScript, backed by FastAPI with PostgreSQL, Firestore, or local JSON storage.

## Run the dashboard with PostgreSQL

1. Install Python 3.10 or later.
2. From this folder, create and activate a virtual environment: `python -m venv .venv`, then `.venv\Scripts\Activate.ps1` on Windows or `source .venv/bin/activate` on macOS/Linux.
3. Install dependencies: `python -m pip install -r requirements.txt`.
4. Install PostgreSQL and create a database: `createdb -U postgres messmind`.
5. Load the schema and demo rows: `psql -U postgres -d messmind -v ON_ERROR_STOP=1 -f database/init.sql`.
6. Copy `.env.example` to `.env` and replace `CHANGE_ME` with the local PostgreSQL password.
7. Start FastAPI and the dashboard: `python -m uvicorn backend.main:app --reload`.
8. Open [http://127.0.0.1:8000](http://127.0.0.1:8000). API documentation is at `/docs`.

To use Firestore instead, set `MESSMIND_STORAGE=firestore`, configure Firebase Admin credentials on the server, and create a Firestore database. The browser never receives service-account credentials. Set `MESSMIND_STORAGE=json` for local JSON storage.

## API

- `GET /api/health` reports the active storage provider.
- `GET /api/service-records?date=YYYY-MM-DD&campus=North%20Campus%20Mess` reads one day's records. The date defaults to today in IST; campus is optional.
- `POST /api/service-records` saves an attendance and kitchen record.
- `GET /api/feedback` reads today's feedback in IST.
- `POST /api/feedback` saves a feedback entry.
- `GET /api/analytics/waste?days=7&campus=North%20Campus%20Mess` summarizes prepared and leftover food for the selected period.
- `GET /api/analytics/attendance?days=14&campus=North%20Campus%20Mess` returns the daily attendance, forecast, meal and cuisine timeline.

The service-record and feedback forms require the backend and save through these endpoints. If it is offline, the interface refuses the submission and tells you to start the API; it does not claim that the data was saved. Attendance and waste timelines use saved service records, with clearly labeled synthetic data as a fallback; several insight and recommendation cards remain sample data. The Demand Simulator computes its historical baseline in the API.

Menu records can now be managed through `GET /api/menu` and `POST /api/menu` using campus, date, meal, vegetarian dish and optional non-vegetarian dish. The feedback form reads this menu context and stores the selected menu snapshot. `GET /api/analytics/menu-feedback` joins feedback to same-day service attendance and leftover records.

Waste is recorded at dish level through `POST /api/waste-records`: prepared kg, served kg, leftover kg, avoidable kg, waste reason and data source. `GET /api/analytics/waste-detail` groups those measured records by dish and reason so the manager can focus on avoidable waste. The page calculator remains a quick preview; use **Record dish-level waste** for saved operational data.


The Demand Simulator now requests `/api/model/forecast` and builds its baseline from saved service records dated before the selected IST service date. It uses a recency-weighted median, preferring the same campus, meal, and weekday, then backing off to campus-and-meal history, then all services. It reports a trained baseline only after at least 8 past attendance records and 3 matching records; a walk-forward mean absolute error (MAE) is shown when it can be calculated. The existing occupancy, popularity, no-show, exam, holiday, event, and weather controls remain scenario adjustments; they are assumptions, not model features learned from records. With no history, no attendance prediction is invented; a manually entered baseline is marked limited/manual. The model is computed from records on request and does not save a separate model file.

## PostgreSQL demo setup

Install PostgreSQL for Windows, create a database named `messmind`, then run `psql -d messmind -v ON_ERROR_STOP=1 -f database/init.sql`. The SQL creates the service and feedback tables and inserts 180 days of reproducible synthetic attendance across both campuses and four meal periods. Existing synthetic entries are visibly labeled as demo values and are excluded from forecasts once real records exist. Copy the PostgreSQL values from `.env.example` into `.env`, set `MESSMIND_STORAGE=postgres`, then start the API. The API adds the cuisine column for existing service tables on first connection and writes new verified service records as non-synthetic. Use the Data Collection form to enter verified date, campus, meal, dishes, forecast, attendance, preparation and leftovers; the attendance and waste timelines then use those saved entries.

Synthetic rows are used only while there are no real attendance rows. The UI labels forecasts and cuisine trends from those records “Demo data”; once actual rows exist for the selected period, synthetic rows are excluded from the forecast and trend. Do not use demo estimates for kitchen production. No genuine mess attendance or cuisine dataset was supplied for this project, so real operating figures must be entered or imported from a verified source before operational use. Breakfast is 07:00–10:00, lunch 12:00–14:30, snacks 16:00–18:00, and dinner 19:00–21:30 IST. Outside a serving window, the dashboard selects the next meal and its weekday menu.

This is a local development backend with no login or access control. Do not expose it to the public internet or store sensitive personal data. Before deployment, add authentication, least-privilege access, a production review, and an appropriate data-retention policy.
