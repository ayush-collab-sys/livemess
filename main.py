from __future__ import annotations

import asyncio
import json
import math
import os
import threading
from datetime import date as Date, datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")
STORE_PATH = PROJECT_ROOT / "data" / "store.json"
STORE_LOCK = asyncio.Lock()
INDIA_TIME_ZONE = ZoneInfo("Asia/Kolkata")

app = FastAPI(title="MessMind API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


class ServiceRecordIn(BaseModel):
    campus: Literal["North Campus Mess", "South Campus Mess"]
    date: Date
    meal: Literal["Breakfast", "Lunch", "Dinner", "Snacks"]
    cuisine: str = Field(default="", max_length=160)
    forecast: float = Field(ge=0, le=1_000_000)
    attendance: float = Field(ge=0, le=1_000_000)
    prepared: float = Field(ge=0, le=1_000_000)
    leftover: float = Field(ge=0, le=1_000_000)
    source: str = Field(min_length=1, max_length=60)

    @model_validator(mode="after")
    def validate_quantities(self):
        if self.leftover > self.prepared:
            raise ValueError("leftover food cannot be greater than food prepared")
        return self


class FeedbackIn(BaseModel):
    rating: Literal["Excellent", "Good", "Average", "Poor"]
    dish: str = Field(min_length=1, max_length=100)
    comment: str = Field(default="", max_length=160)
    campus: Literal["North Campus Mess", "South Campus Mess"] = "North Campus Mess"
    meal: Literal["Breakfast", "Lunch", "Dinner", "Snacks"] = "Lunch"
    menu_snapshot: str = Field(default="", max_length=500)
    date: Date = Field(default_factory=lambda: datetime.now(INDIA_TIME_ZONE).date())


class MenuEntryIn(BaseModel):
    campus: Literal["North Campus Mess", "South Campus Mess"]
    date: Date
    meal: Literal["Breakfast", "Lunch", "Dinner", "Snacks"]
    veg: str = Field(min_length=1, max_length=100)
    non_veg: str = Field(default="", max_length=100)


class WasteRecordIn(BaseModel):
    campus: Literal["North Campus Mess", "South Campus Mess"]
    date: Date
    meal: Literal["Breakfast", "Lunch", "Dinner", "Snacks"]
    dish: str = Field(min_length=1, max_length=100)
    prepared_kg: float = Field(ge=0, le=1_000_000)
    served_kg: float = Field(ge=0, le=1_000_000)
    leftover_kg: float = Field(ge=0, le=1_000_000)
    avoidable_kg: float = Field(ge=0, le=1_000_000)
    reason: Literal["overproduction", "plate_return", "spoilage", "preparation", "other"]
    source: str = Field(min_length=1, max_length=60)

    @model_validator(mode="after")
    def validate_waste_quantities(self):
        if self.served_kg + self.leftover_kg > self.prepared_kg + 0.001:
            raise ValueError("served plus leftover food cannot exceed prepared food")
        if self.avoidable_kg > self.leftover_kg + 0.001:
            raise ValueError("avoidable waste cannot exceed leftover food")
        return self


class PostgresStore:
    """PostgreSQL adapter; the connection string is kept in server-side env."""

    def __init__(self) -> None:
        self._schema_ready = False
        self._schema_lock = threading.Lock()

    def connect(self):
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise HTTPException(status_code=503, detail="Set DATABASE_URL to enable PostgreSQL.")
        try:
            import psycopg
            from psycopg.rows import dict_row
            conn = psycopg.connect(database_url, connect_timeout=4, row_factory=dict_row)
            if not self._schema_ready:
                with self._schema_lock:
                    if not self._schema_ready:
                        with conn.transaction():
                            table_exists = conn.execute("SELECT to_regclass('service_records') AS table_name").fetchone()["table_name"]
                            if table_exists:
                                conn.execute("ALTER TABLE service_records ADD COLUMN IF NOT EXISTS cuisine TEXT NOT NULL DEFAULT ''")
                                conn.execute("UPDATE service_records SET cuisine = CASE meal WHEN 'Breakfast' THEN 'Poha and seasonal breakfast (demo)' WHEN 'Lunch' THEN 'Dal, rice and daily special (demo)' WHEN 'Dinner' THEN 'Paneer or vegetable curry (demo)' ELSE 'Tea and savory snack (demo)' END WHERE is_synthetic AND cuisine = ''")
                                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS service_records_real_unique_idx ON service_records (campus, service_date, meal) WHERE is_synthetic = FALSE")
                            feedback_exists = conn.execute("SELECT to_regclass('feedback') AS table_name").fetchone()["table_name"]
                            if feedback_exists:
                                conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS meal TEXT NOT NULL DEFAULT 'Lunch'")
                                conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS menu_snapshot TEXT NOT NULL DEFAULT ''")
                            conn.execute("""
                                CREATE TABLE IF NOT EXISTS menus (
                                    id TEXT PRIMARY KEY,
                                    campus TEXT NOT NULL CHECK (campus IN ('North Campus Mess', 'South Campus Mess')),
                                    menu_date DATE NOT NULL,
                                    meal TEXT NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Dinner', 'Snacks')),
                                    veg TEXT NOT NULL,
                                    non_veg TEXT NOT NULL DEFAULT '',
                                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                    UNIQUE (campus, menu_date, meal)
                                )
                            """)
                            conn.execute("""
                                CREATE TABLE IF NOT EXISTS waste_records (
                                    id TEXT PRIMARY KEY,
                                    campus TEXT NOT NULL CHECK (campus IN ('North Campus Mess', 'South Campus Mess')),
                                    waste_date DATE NOT NULL,
                                    meal TEXT NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Dinner', 'Snacks')),
                                    dish TEXT NOT NULL,
                                    prepared_kg DOUBLE PRECISION NOT NULL CHECK (prepared_kg >= 0),
                                    served_kg DOUBLE PRECISION NOT NULL CHECK (served_kg >= 0),
                                    leftover_kg DOUBLE PRECISION NOT NULL CHECK (leftover_kg >= 0),
                                    avoidable_kg DOUBLE PRECISION NOT NULL CHECK (avoidable_kg >= 0),
                                    reason TEXT NOT NULL,
                                    source TEXT NOT NULL,
                                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                                )
                            """)
                        self._schema_ready = True
            return conn
        except ImportError as exc:
            raise HTTPException(status_code=503, detail="Install psycopg to use PostgreSQL.") from exc
        except Exception as exc:
            raise HTTPException(status_code=503, detail="PostgreSQL is unavailable; check the local service and DATABASE_URL.") from exc

    def ping(self) -> bool:
        with self.connect() as conn:
            conn.execute("SELECT 1")
        return True

    def list_daily(self, kind: str, day: Date, campus: str | None = None) -> list[dict]:
        if kind == "serviceRecords":
            query = "SELECT id, campus, service_date AS date, meal, cuisine, forecast, attendance, prepared, leftover, source, created_at AS \"createdAt\", is_synthetic FROM service_records WHERE service_date = %s"
            values: list = [day]
            if campus:
                query += " AND campus = %s"
                values.append(campus)
            query += " ORDER BY created_at DESC LIMIT 100"
        else:
            query = "SELECT id, rating, dish, comment, campus, meal, menu_snapshot AS \"menuSnapshot\", service_date AS date, created_at AS \"createdAt\" FROM feedback WHERE service_date = %s ORDER BY created_at DESC LIMIT 100"
            values = [day]
        with self.connect() as conn:
            return [self._serialize(row) for row in conn.execute(query, values).fetchall()]

    def list_service_history(self, limit: int = 5000) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, campus, service_date AS date, meal, cuisine, forecast, attendance, prepared, leftover, source, created_at AS \"createdAt\", is_synthetic FROM service_records ORDER BY service_date DESC LIMIT %s",
                (limit,),
            ).fetchall()
        return [self._serialize(row) for row in rows]

    def list_feedback_history(self, limit: int = 5000) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, rating, dish, comment, campus, meal, menu_snapshot AS \"menuSnapshot\", service_date AS date, created_at AS \"createdAt\" FROM feedback ORDER BY service_date DESC, created_at DESC LIMIT %s",
                (limit,),
            ).fetchall()
        return [self._serialize(row) for row in rows]

    def get_menu(self, campus: str, menu_date: Date, meal: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT id, campus, menu_date AS date, meal, veg, non_veg AS \"nonVeg\", created_at AS \"createdAt\" FROM menus WHERE campus = %s AND menu_date = %s AND meal = %s",
                (campus, menu_date, meal),
            ).fetchone()
        return self._serialize(row) if row else None

    def save_menu(self, payload: dict) -> dict:
        with self.connect() as conn:
            row = conn.execute(
                "INSERT INTO menus (id, campus, menu_date, meal, veg, non_veg) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (campus, menu_date, meal) DO UPDATE SET veg = EXCLUDED.veg, non_veg = EXCLUDED.non_veg RETURNING id, campus, menu_date AS date, meal, veg, non_veg AS \"nonVeg\", created_at AS \"createdAt\"",
                (str(uuid4()), payload["campus"], Date.fromisoformat(payload["date"]), payload["meal"], payload["veg"], payload.get("non_veg", "")),
            ).fetchone()
        return self._serialize(row)

    def list_waste_history(self, limit: int = 5000) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, campus, waste_date AS date, meal, dish, prepared_kg AS \"preparedKg\", served_kg AS \"servedKg\", leftover_kg AS \"leftoverKg\", avoidable_kg AS \"avoidableKg\", reason, source, created_at AS \"createdAt\" FROM waste_records ORDER BY waste_date DESC, created_at DESC LIMIT %s",
                (limit,),
            ).fetchall()
        return [self._serialize(row) for row in rows]

    def add_waste(self, payload: dict) -> dict:
        with self.connect() as conn:
            row = conn.execute(
                "INSERT INTO waste_records (id, campus, waste_date, meal, dish, prepared_kg, served_kg, leftover_kg, avoidable_kg, reason, source) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, campus, waste_date AS date, meal, dish, prepared_kg AS \"preparedKg\", served_kg AS \"servedKg\", leftover_kg AS \"leftoverKg\", avoidable_kg AS \"avoidableKg\", reason, source, created_at AS \"createdAt\"",
                (str(uuid4()), payload["campus"], Date.fromisoformat(payload["date"]), payload["meal"], payload["dish"], payload["prepared_kg"], payload["served_kg"], payload["leftover_kg"], payload["avoidable_kg"], payload["reason"], payload["source"]),
            ).fetchone()
        return self._serialize(row)

    def add(self, kind: str, payload: dict) -> dict:
        with self.connect() as conn:
            if kind == "serviceRecords":
                duplicate = conn.execute(
                    "SELECT id FROM service_records WHERE campus = %s AND service_date = %s AND meal = %s AND is_synthetic = FALSE LIMIT 1",
                    (payload["campus"], Date.fromisoformat(payload["date"]), payload["meal"]),
                ).fetchone()
                if duplicate:
                    raise HTTPException(status_code=409, detail="A verified service record already exists for this campus, date and meal.")
                row = conn.execute(
                    "INSERT INTO service_records (id, campus, service_date, meal, cuisine, forecast, attendance, prepared, leftover, source, is_synthetic) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE) RETURNING id, campus, service_date AS date, meal, cuisine, forecast, attendance, prepared, leftover, source, created_at AS \"createdAt\", is_synthetic",
                    (str(uuid4()), payload["campus"], Date.fromisoformat(payload["date"]), payload["meal"], payload.get("cuisine", ""), payload["forecast"], payload["attendance"], payload["prepared"], payload["leftover"], payload["source"]),
                ).fetchone()
            else:
                row = conn.execute(
                    "INSERT INTO feedback (id, rating, dish, comment, campus, meal, menu_snapshot, service_date) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, rating, dish, comment, campus, meal, menu_snapshot AS \"menuSnapshot\", service_date AS date, created_at AS \"createdAt\"",
                    (str(uuid4()), payload["rating"], payload["dish"], payload.get("comment", ""), payload["campus"], payload.get("meal", "Lunch"), payload.get("menu_snapshot", ""), Date.fromisoformat(payload["date"])),
                ).fetchone()
        return self._serialize(row)

    @staticmethod
    def _serialize(row: dict) -> dict:
        result = dict(row)
        for key, value in result.items():
            if isinstance(value, (Date, datetime)):
                result[key] = value.isoformat()
        return result


POSTGRES_STORE = PostgresStore()


class CloudStore:
    """Lazy Firebase Admin / Firestore adapter. Credentials stay server-side."""

    def __init__(self) -> None:
        self.client = None
        self.firestore = None

    def get_client(self):
        if self.client is not None:
            return self.client
        try:
            import firebase_admin
            from firebase_admin import firestore

            if not firebase_admin._apps:
                project_id = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
                options = {"projectId": project_id} if project_id else None
                firebase_admin.initialize_app(options=options)
            self.firestore = firestore
            self.client = firestore.client()
            return self.client
        except ImportError as exc:
            raise HTTPException(status_code=503, detail="Install firebase-admin to use Firestore.") from exc
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Firebase credentials or Firestore setup are unavailable.") from exc

    @staticmethod
    def campus_key(campus: str) -> str:
        return "north" if campus == "North Campus Mess" else "south"

    def day_collection(self, kind: str, campus: str, day: Date):
        return (self.get_client().collection("campuses").document(self.campus_key(campus))
                .collection("days").document(day.isoformat()).collection(kind))

    @staticmethod
    def serializable(document) -> dict:
        result = document.to_dict() or {}
        result.setdefault("id", document.id)
        created = result.get("createdAt")
        if isinstance(created, datetime):
            result["createdAt"] = created.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        return result

    def list_daily(self, kind: str, day: Date, campus: str | None) -> list[dict]:
        campuses = [campus] if campus else ["North Campus Mess", "South Campus Mess"]
        results = []
        for campus_name in campuses:
            query = self.day_collection(kind, campus_name, day).order_by(
                "createdAt", direction=self.firestore.Query.DESCENDING
            ).limit(100)
            results.extend(self.serializable(doc) for doc in query.stream())
        return sorted(results, key=lambda item: item.get("createdAt", ""), reverse=True)[:100]

    def list_service_history(self, limit: int = 5000) -> list[dict]:
        query = self.get_client().collection_group("serviceRecords").limit(limit)
        return [self.serializable(doc) for doc in query.stream()]

    def list_feedback_history(self, limit: int = 5000) -> list[dict]:
        query = self.get_client().collection_group("feedback").limit(limit)
        return [self.serializable(doc) for doc in query.stream()]

    def add(self, kind: str, payload: dict) -> dict:
        record_id = str(uuid4())
        payload = {**payload, "id": record_id, "createdAt": self.firestore.SERVER_TIMESTAMP}
        day = Date.fromisoformat(payload["date"])
        collection = self.day_collection(kind, payload["campus"], day)
        document = collection.document(record_id)
        document.set(payload)
        stored = document.get()
        return self.serializable(stored)


CLOUD_STORE = CloudStore()


def load_service_history() -> list[dict]:
    if uses_postgres():
        return POSTGRES_STORE.list_service_history()
    if uses_firestore():
        return CLOUD_STORE.list_service_history()
    store = read_store()
    return store["serviceRecords"][-5000:]


def load_feedback_history() -> list[dict]:
    if uses_postgres():
        return POSTGRES_STORE.list_feedback_history()
    if uses_firestore():
        return CLOUD_STORE.list_feedback_history()
    return read_store()["feedback"][-5000:]


def load_waste_history() -> list[dict]:
    if uses_postgres():
        return POSTGRES_STORE.list_waste_history()
    if uses_firestore():
        return []
    return read_store()["wasteRecords"][-5000:]


def historical_forecast(records: list[dict], campus: str, meal: str, service_date: Date) -> dict:
    """Fit a robust, recency-weighted historical baseline from verified attendance."""
    real_records = [record for record in records if not record.get("is_synthetic", False)]
    using_synthetic = not real_records and any(record.get("is_synthetic", False) for record in records)
    if real_records:
        records = real_records
    elif using_synthetic:
        records = [record for record in records if record.get("is_synthetic", False)]
    clean = []
    for record in records:
        try:
            day = Date.fromisoformat(str(record["date"]))
            count = float(record["attendance"])
            if day < service_date and math.isfinite(count) and count >= 0:
                clean.append({**record, "_day": day, "_count": count})
        except (KeyError, TypeError, ValueError):
            continue

    def fit(rows: list[dict], target_date: Date):
        matches = [r for r in rows if r.get("campus") == campus and r.get("meal") == meal
                   and r["_day"].weekday() == target_date.weekday()]
        level = "same campus, meal and weekday"
        if len(matches) < 3:
            matches = [r for r in rows if r.get("campus") == campus and r.get("meal") == meal]
            level = "same campus and meal"
        if len(matches) < 3:
            matches = rows
            level = "all campus services (fallback)"
        if not matches:
            return None, [], level

        # Recency and segment weighted median is robust to unusual one-off counts.
        weighted = []
        for row in matches:
            age = max(0, (target_date - row["_day"]).days)
            weight = 0.5 ** (age / 42)
            if row.get("campus") == campus and row.get("meal") == meal:
                weight *= 2
            if row["_day"].weekday() == target_date.weekday():
                weight *= 2
            weighted.append((row["_count"], weight))
        weighted.sort(key=lambda pair: pair[0])
        half_weight = sum(weight for _, weight in weighted) / 2
        seen_weight = 0.0
        for value, weight in weighted:
            seen_weight += weight
            if seen_weight >= half_weight:
                return round(value), matches, level
        return round(weighted[-1][0]), matches, level

    baseline, target, level = fit(clean, service_date)
    if baseline is None:
        return {"status": "no_history", "trainingRecords": len(clean), "matchedRecords": 0,
                "baseline": None, "mae": None, "validationSamples": 0,
                "method": "No past attendance records are available."}

    # Walk-forward validation estimates the typical absolute attendance error.
    errors = []
    validation_records = [row for row in clean if row.get("campus") == campus and row.get("meal") == meal]
    ordered = sorted(validation_records, key=lambda row: row["_day"])[-100:]
    for observed in ordered:
        prior = [row for row in clean if row["_day"] < observed["_day"]]
        prediction, _, _ = fit(prior, observed["_day"])
        if prediction is not None:
            errors.append(abs(prediction - observed["_count"]))
    mae = round(sum(errors) / len(errors), 1) if errors else None

    enough_history = len(clean) >= 8 and len(target) >= 3
    status = "demo_trained" if using_synthetic and enough_history else (
        "trained" if enough_history else "limited_history"
    )
    return {"status": status, "trainingRecords": len(clean), "matchedRecords": len(target),
            "baseline": baseline, "mae": mae, "validationSamples": len(errors),
            "dataType": "synthetic demo" if using_synthetic else "historical attendance",
            "method": f"Recency-weighted median from {level}."}


def waste_summary(records: list[dict], end_date: Date, days: int, campus: str | None) -> dict:
    real_records = [record for record in records if not record.get("is_synthetic", False)]
    using_synthetic = not real_records and any(record.get("is_synthetic", False) for record in records)
    source_records = real_records if real_records else (
        [record for record in records if record.get("is_synthetic", False)] if using_synthetic else records
    )
    start_date = end_date.fromordinal(end_date.toordinal() - days + 1)
    rows = []
    for record in source_records:
        try:
            service_day = Date.fromisoformat(str(record["date"]))
            prepared = float(record["prepared"])
            leftover = float(record["leftover"])
            if (start_date <= service_day <= end_date and prepared >= 0 and leftover >= 0
                    and math.isfinite(prepared) and math.isfinite(leftover)
                    and (campus is None or record.get("campus") == campus)):
                row = {
                    "date": service_day.isoformat(), "campus": record.get("campus", ""),
                    "meal": record.get("meal", ""), "preparedKg": prepared,
                    "leftoverKg": leftover,
                    "wastePercent": round(leftover / prepared * 100, 1) if prepared > 0 else None,
                    "source": record.get("source", ""),
                }
                rows.append(row)
        except (KeyError, TypeError, ValueError):
            continue

    prepared_total = sum(row["preparedKg"] for row in rows)
    leftover_total = sum(row["leftoverKg"] for row in rows)
    rows.sort(key=lambda row: (row["date"], row["campus"], row["meal"]), reverse=True)
    return {
        "status": "ready" if rows else "no_records",
        "dataType": "synthetic demo" if using_synthetic and rows else "actual records" if rows else "no data",
        "campus": campus,
        "fromDate": start_date.isoformat(),
        "throughDate": end_date.isoformat(),
        "serviceCount": len(rows),
        "preparedKg": round(prepared_total, 1),
        "leftoverKg": round(leftover_total, 1),
        "wastePercent": round(leftover_total / prepared_total * 100, 1) if prepared_total > 0 else None,
        "services": rows[:100],
    }


def uses_firestore() -> bool:
    return os.getenv("MESSMIND_STORAGE", "json").lower() == "firestore"


def uses_postgres() -> bool:
    return os.getenv("MESSMIND_STORAGE", "json").lower() in {"postgres", "postgresql"}


def read_store() -> dict:
    if not STORE_PATH.exists():
        return {"serviceRecords": [], "feedback": [], "menus": [], "wasteRecords": []}
    try:
        store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail="Local data store could not be read.") from exc
    store.setdefault("serviceRecords", [])
    store.setdefault("feedback", [])
    store.setdefault("menus", [])
    store.setdefault("wasteRecords", [])
    return store


def write_store(store: dict) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = STORE_PATH.with_suffix(f".{os.getpid()}.tmp")
    temp_path.write_text(json.dumps(store, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temp_path, STORE_PATH)


@app.get("/api/health")
async def health() -> dict:
    if uses_postgres():
        try:
            await run_in_threadpool(POSTGRES_STORE.ping)
            database_status = "connected"
        except HTTPException:
            database_status = "unavailable"
        return {
            "status": "ok" if database_status == "connected" else "degraded",
            "storage": "postgres",
            "database": database_status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    return {
        "status": "ok",
        "storage": "firestore" if uses_firestore() else "local-json",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/menu")
async def get_menu(
    campus: str = Query(pattern="^(North Campus Mess|South Campus Mess)$"),
    meal: str = Query(pattern="^(Breakfast|Lunch|Dinner|Snacks)$"),
    menu_date: Date = Query(alias="date"),
) -> dict:
    if uses_postgres():
        menu = await run_in_threadpool(POSTGRES_STORE.get_menu, campus, menu_date, meal)
        return {"menu": menu}
    if uses_firestore():
        return {"menu": None}
    menus = read_store().get("menus", [])
    menu = next((item for item in menus if item.get("campus") == campus and item.get("date") == menu_date.isoformat() and item.get("meal") == meal), None)
    return {"menu": menu}


@app.get("/api/dashboard")
async def dashboard_summary(
    campus: str = Query(default="North Campus Mess", pattern="^(North Campus Mess|South Campus Mess)$"),
    meal: str = Query(default="Lunch", pattern="^(Breakfast|Lunch|Dinner|Snacks)$"),
) -> dict:
    today = datetime.now(INDIA_TIME_ZONE).date()
    history = await run_in_threadpool(load_service_history)
    real = [row for row in history if not row.get("is_synthetic", False) and row.get("campus") == campus]
    current = next((row for row in real if row.get("date") == today.isoformat() and row.get("meal") == meal), None)
    recent = [row for row in real if row.get("date", "") >= today.fromordinal(today.toordinal() - 6).isoformat()]
    source = "verified records" if real else "no verified records"
    if not current:
        return {"status": "no_verified_service", "dataType": source, "campus": campus, "meal": meal}
    forecast = float(current.get("forecast", 0) or 0)
    attendance = float(current.get("attendance", 0) or 0)
    prepared = sum(float(row.get("prepared", 0) or 0) for row in recent)
    leftover = sum(float(row.get("leftover", 0) or 0) for row in recent)
    return {
        "status": "ready", "dataType": source, "campus": campus, "meal": meal,
        "expectedDiners": round(forecast), "checkedIn": round(attendance),
        "forecastErrorPercent": round(abs(forecast - attendance) / forecast * 100, 1) if forecast else None,
        "foodSavedKg": round(max(0, prepared - leftover), 1), "leftoverKg": round(leftover, 1),
        "serviceDate": current.get("date"), "recordedAt": current.get("createdAt"),
    }


@app.post("/api/menu", status_code=201)
async def save_menu(payload: MenuEntryIn) -> dict:
    menu = payload.model_dump(mode="json")
    if uses_postgres():
        saved = await run_in_threadpool(POSTGRES_STORE.save_menu, menu)
        return {"menu": saved}
    if uses_firestore():
        raise HTTPException(status_code=503, detail="Menu editing is not configured for Firestore yet.")
    menu.update(id=str(uuid4()), createdAt=datetime.now(timezone.utc).isoformat(), nonVeg=menu.pop("non_veg", ""))
    async with STORE_LOCK:
        store = read_store()
        store.setdefault("menus", [])
        store["menus"] = [item for item in store["menus"] if not (item.get("campus") == menu["campus"] and item.get("date") == menu["date"] and item.get("meal") == menu["meal"])]
        store["menus"].insert(0, menu)
        write_store(store)
    return {"menu": menu}


@app.get("/api/waste-records")
async def list_waste_records(
    days: int = Query(default=30, ge=1, le=180),
    campus: str | None = Query(default=None, pattern="^(North Campus Mess|South Campus Mess)$"),
) -> dict:
    through_date = datetime.now(INDIA_TIME_ZONE).date()
    from_date = through_date.fromordinal(through_date.toordinal() - days + 1)
    records = []
    for record in load_waste_history():
        try:
            record_date = Date.fromisoformat(str(record["date"]))
        except (KeyError, TypeError, ValueError):
            continue
        if from_date <= record_date <= through_date and (campus is None or record.get("campus") == campus):
            records.append(record)
    return {"fromDate": from_date.isoformat(), "throughDate": through_date.isoformat(), "records": records[:500]}


@app.post("/api/waste-records", status_code=201)
async def create_waste_record(payload: WasteRecordIn) -> dict:
    record = payload.model_dump(mode="json")
    if uses_postgres():
        saved = await run_in_threadpool(POSTGRES_STORE.add_waste, record)
        return {"record": saved}
    if uses_firestore():
        raise HTTPException(status_code=503, detail="Waste records are not configured for Firestore yet.")
    record.update(id=str(uuid4()), createdAt=datetime.now(timezone.utc).isoformat())
    record["preparedKg"] = record.pop("prepared_kg")
    record["servedKg"] = record.pop("served_kg")
    record["leftoverKg"] = record.pop("leftover_kg")
    record["avoidableKg"] = record.pop("avoidable_kg")
    async with STORE_LOCK:
        store = read_store()
        store["wasteRecords"].insert(0, record)
        store["wasteRecords"] = store["wasteRecords"][:5000]
        write_store(store)
    return {"record": record}


@app.get("/api/analytics/waste-detail")
async def waste_detail_analytics(
    days: int = Query(default=30, ge=1, le=180),
    campus: str | None = Query(default=None, pattern="^(North Campus Mess|South Campus Mess)$"),
) -> dict:
    through_date = datetime.now(INDIA_TIME_ZONE).date()
    from_date = through_date.fromordinal(through_date.toordinal() - days + 1)
    records = []
    for record in load_waste_history():
        try:
            record_date = Date.fromisoformat(str(record["date"]))
        except (KeyError, TypeError, ValueError):
            continue
        if from_date <= record_date <= through_date and (campus is None or record.get("campus") == campus):
            records.append(record)
    prepared = sum(float(row.get("preparedKg", 0) or 0) for row in records)
    served = sum(float(row.get("servedKg", 0) or 0) for row in records)
    leftover = sum(float(row.get("leftoverKg", 0) or 0) for row in records)
    avoidable = sum(float(row.get("avoidableKg", 0) or 0) for row in records)
    by_reason: dict[str, float] = {}
    by_dish: dict[str, dict[str, float]] = {}
    for row in records:
        reason = row.get("reason", "other")
        by_reason[reason] = by_reason.get(reason, 0) + float(row.get("leftoverKg", 0) or 0)
        dish = row.get("dish", "Unknown")
        summary = by_dish.setdefault(dish, {"leftoverKg": 0, "avoidableKg": 0, "records": 0})
        summary["leftoverKg"] += float(row.get("leftoverKg", 0) or 0)
        summary["avoidableKg"] += float(row.get("avoidableKg", 0) or 0)
        summary["records"] += 1
    return {
        "fromDate": from_date.isoformat(), "throughDate": through_date.isoformat(), "serviceCount": len(records),
        "preparedKg": round(prepared, 1), "servedKg": round(served, 1), "leftoverKg": round(leftover, 1),
        "avoidableKg": round(avoidable, 1), "wastePercent": round(leftover / prepared * 100, 1) if prepared else None,
        "avoidablePercent": round(avoidable / prepared * 100, 1) if prepared else None,
        "byReason": [{"reason": key, "leftoverKg": round(value, 1)} for key, value in sorted(by_reason.items(), key=lambda pair: pair[1], reverse=True)],
        "byDish": [{"dish": key, **{metric: round(value, 1) if metric != "records" else value for metric, value in value.items()}} for key, value in sorted(by_dish.items(), key=lambda pair: pair[1]["avoidableKg"], reverse=True)],
    }


@app.get("/api/waste-recommendation")
async def waste_recommendation(
    campus: str = Query(default="North Campus Mess", pattern="^(North Campus Mess|South Campus Mess)$"),
    meal: str = Query(default="Lunch", pattern="^(Breakfast|Lunch|Dinner|Snacks)$"),
) -> dict:
    """Turn measured dish waste into a cautious batch-control recommendation."""
    records = [row for row in load_waste_history() if row.get("campus") == campus and row.get("meal") == meal]
    if not records:
        return {"status": "no_measured_waste", "message": "Save at least three measured dish records before using batch recommendations."}
    by_dish: dict[str, list[dict]] = {}
    for row in records[:500]:
        by_dish.setdefault(row.get("dish", "Unknown"), []).append(row)
    ranked = []
    for dish, items in by_dish.items():
        prepared = sum(float(item.get("preparedKg", 0) or 0) for item in items)
        leftover = sum(float(item.get("leftoverKg", 0) or 0) for item in items)
        avoidable = sum(float(item.get("avoidableKg", 0) or 0) for item in items)
        ranked.append({"dish": dish, "records": len(items), "preparedKg": prepared, "leftoverKg": leftover, "avoidableKg": avoidable, "wastePercent": leftover / prepared * 100 if prepared else 0})
    ranked.sort(key=lambda row: (row["avoidableKg"], row["wastePercent"]), reverse=True)
    top = ranked[0]
    if top["records"] < 3:
        return {"status": "insufficient_history", "dish": top["dish"], "records": top["records"], "message": "Collect three comparable services before changing a batch quantity."}
    reduction = min(20, max(5, round(top["avoidableKg"] / max(top["preparedKg"], 1) * 100)))
    initial_batch = round(max(0, top["preparedKg"] / top["records"] * (1 - reduction / 100)), 1)
    reserve = round(max(0, top["preparedKg"] / top["records"] * 0.1), 1)
    return {
        "status": "ready", "campus": campus, "meal": meal, "dish": top["dish"], "records": top["records"],
        "measuredWastePercent": round(top["wastePercent"], 1), "avoidableKg": round(top["avoidableKg"] / top["records"], 1),
        "reductionPercent": reduction, "initialBatchKg": initial_batch, "reserveBatchKg": reserve,
        "nextAction": f"Prepare {initial_batch} kg initially and hold {reserve} kg as a reserve batch. Release reserve only when check-ins rise.",
        "evidence": f"{top['dish']} produced {round(top['avoidableKg'] / top['records'], 1)} kg avoidable waste per comparable {meal.lower()} service on average.",
    }


@app.get("/api/analytics/cost-management")
async def cost_management(
    days: int = Query(default=30, ge=7, le=180),
    campus: str = Query(default="North Campus Mess", pattern="^(North Campus Mess|South Campus Mess)$"),
    cost_per_kg: float = Query(default=120, ge=0, le=10000),
) -> dict:
    """Estimate the budget recovered by reducing avoidable measured waste.

    This is a decision-support estimate: it only counts measured avoidable waste,
    keeps non-avoidable leftovers visible, and never treats savings as cash until
    a manager approves the plan.
    """
    through_date = datetime.now(INDIA_TIME_ZONE).date()
    from_date = through_date.fromordinal(through_date.toordinal() - days + 1)
    records = []
    for record in load_waste_history():
        try:
            record_date = Date.fromisoformat(str(record["date"]))
        except (KeyError, TypeError, ValueError):
            continue
        if from_date <= record_date <= through_date and record.get("campus") == campus:
            records.append(record)

    prepared = sum(float(row.get("preparedKg", 0) or 0) for row in records)
    leftover = sum(float(row.get("leftoverKg", 0) or 0) for row in records)
    avoidable = sum(float(row.get("avoidableKg", 0) or 0) for row in records)
    measured_value = avoidable * cost_per_kg
    daily_avoidable = avoidable / days if days else 0
    monthly_avoidable = daily_avoidable * 30
    monthly_savings = monthly_avoidable * cost_per_kg
    allocations = [
        ("Fresh ingredients", 0.40, "Improve quality where diners notice it most"),
        ("Kitchen efficiency", 0.25, "Fund weighing, holding and portion-control improvements"),
        ("Student experience", 0.20, "Support menu trials and dining feedback actions"),
        ("Sustainability", 0.15, "Support composting, redistribution and waste prevention"),
    ]
    reinvestment = [
        {"name": name, "share": round(share * 100), "monthlyAmount": round(monthly_savings * share), "purpose": purpose}
        for name, share, purpose in allocations
    ]
    return {
        "status": "ready" if records else "no_measured_waste",
        "campus": campus,
        "fromDate": from_date.isoformat(),
        "throughDate": through_date.isoformat(),
        "serviceCount": len(records),
        "preparedKg": round(prepared, 1),
        "leftoverKg": round(leftover, 1),
        "avoidableKg": round(avoidable, 1),
        "costPerKg": round(cost_per_kg, 2),
        "measuredValue": round(measured_value),
        "monthlyAvoidableKg": round(monthly_avoidable, 1),
        "projectedMonthlySavings": round(monthly_savings),
        "currency": "INR",
        "reinvestment": reinvestment,
        "recommendation": (
            "Use the recovered budget first on the highest-waste dish and the equipment or process change that prevents it."
            if records else
            "Save measured dish-level waste records to unlock a cost and reinvestment plan."
        ),
    }


@app.get("/api/model/forecast")
async def model_forecast(
    campus: str = Query(pattern="^(North Campus Mess|South Campus Mess)$"),
    meal: str = Query(pattern="^(Breakfast|Lunch|Dinner|Snacks)$"),
    service_date: Date = Query(alias="date"),
) -> dict:
    history = await run_in_threadpool(load_service_history)
    return historical_forecast(history, campus, meal, service_date)


@app.get("/api/analytics/waste")
async def get_waste_analysis(
    days: int = Query(default=7, ge=1, le=90),
    campus: str | None = Query(default=None, pattern="^(North Campus Mess|South Campus Mess)$"),
) -> dict:
    history = await run_in_threadpool(load_service_history)
    end_date = datetime.now(INDIA_TIME_ZONE).date()
    return waste_summary(history, end_date, days, campus)


@app.get("/api/analytics/attendance")
async def get_attendance_timeline(
    days: int = Query(default=14, ge=1, le=90),
    campus: str | None = Query(default=None, pattern="^(North Campus Mess|South Campus Mess)$"),
) -> dict:
    history = await run_in_threadpool(load_service_history)
    end_date = datetime.now(INDIA_TIME_ZONE).date()
    start_date = end_date.fromordinal(end_date.toordinal() - days + 1)
    rows = []
    for record in history:
        try:
            service_day = Date.fromisoformat(str(record["date"]))
            attendance, forecast = float(record["attendance"]), float(record["forecast"])
            if (start_date <= service_day <= end_date and math.isfinite(attendance)
                    and math.isfinite(forecast) and attendance >= 0 and forecast >= 0
                    and (campus is None or record.get("campus") == campus)):
                rows.append({
                    "date": service_day.isoformat(), "campus": record.get("campus", ""),
                    "meal": record.get("meal", ""), "cuisine": record.get("cuisine", ""),
                    "forecast": forecast, "attendance": attendance,
                    "isSynthetic": bool(record.get("is_synthetic", False)),
                })
        except (KeyError, TypeError, ValueError):
            continue
    rows.sort(key=lambda row: (row["date"], row["meal"]), reverse=True)
    actual_rows = [row for row in rows if not row["isSynthetic"]]
    if actual_rows:
        rows = actual_rows
    return {
        "status": "ready" if rows else "no_records",
        "dataType": "actual records" if actual_rows else "synthetic demo" if rows else "no data",
        "campus": campus, "fromDate": start_date.isoformat(), "throughDate": end_date.isoformat(),
        "serviceCount": len(rows), "services": rows[:500],
    }


@app.get("/api/service-records")
async def list_service_records(
    service_date: Date | None = Query(default=None, alias="date"),
    campus: str | None = Query(default=None, pattern="^(North Campus Mess|South Campus Mess)$"),
    days: int | None = Query(default=None, ge=1, le=90),
) -> dict:
    if days is not None:
        history = await run_in_threadpool(load_service_history)
        through_date = datetime.now(INDIA_TIME_ZONE).date()
        from_date = through_date.fromordinal(through_date.toordinal() - days + 1)
        records = []
        for record in history:
            try:
                record_date = Date.fromisoformat(str(record["date"]))
            except (KeyError, TypeError, ValueError):
                continue
            if from_date <= record_date <= through_date and (campus is None or record.get("campus") == campus):
                records.append(record)
        records.sort(key=lambda record: (str(record.get("date", "")), str(record.get("createdAt", ""))), reverse=True)
        return {"records": records[:500]}
    service_date = service_date or datetime.now(INDIA_TIME_ZONE).date()
    if uses_postgres():
        records = await run_in_threadpool(POSTGRES_STORE.list_daily, "serviceRecords", service_date, campus)
        return {"records": records}
    if uses_firestore():
        records = await run_in_threadpool(CLOUD_STORE.list_daily, "serviceRecords", service_date, campus)
        return {"records": records}
    async with STORE_LOCK:
        records = read_store()["serviceRecords"]
    if campus:
        records = [record for record in records if record.get("campus") == campus]
    records = [record for record in records if record.get("date") == service_date.isoformat()]
    return {"records": records[:100]}


@app.post("/api/service-records", status_code=201)
async def create_service_record(payload: ServiceRecordIn) -> dict:
    record = payload.model_dump(mode="json")
    if uses_postgres():
        saved = await run_in_threadpool(POSTGRES_STORE.add, "serviceRecords", record)
        return {"record": saved}
    if uses_firestore():
        saved = await run_in_threadpool(CLOUD_STORE.add, "serviceRecords", record)
        return {"record": saved}
    record.update(id=str(uuid4()), createdAt=datetime.now(timezone.utc).isoformat())
    async with STORE_LOCK:
        store = read_store()
        store["serviceRecords"].insert(0, record)
        store["serviceRecords"] = store["serviceRecords"][:5000]
        write_store(store)
    return {"record": record}


@app.get("/api/feedback")
async def list_feedback() -> dict:
    service_date = datetime.now(INDIA_TIME_ZONE).date()
    if uses_postgres():
        feedback = await run_in_threadpool(POSTGRES_STORE.list_daily, "feedback", service_date)
        return {"feedback": feedback}
    if uses_firestore():
        feedback = await run_in_threadpool(CLOUD_STORE.list_daily, "feedback", service_date, None)
        return {"feedback": feedback}
    async with STORE_LOCK:
        feedback = read_store()["feedback"]
    feedback = [item for item in feedback if item.get("date") == service_date.isoformat()]
    return {"feedback": feedback[:100]}


@app.get("/api/analytics/menu-feedback")
async def menu_feedback_analytics(
    days: int = Query(default=30, ge=1, le=180),
    campus: str | None = Query(default=None, pattern="^(North Campus Mess|South Campus Mess)$"),
) -> dict:
    """Connect menu ratings to the same date, meal, attendance and waste record."""
    through_date = datetime.now(INDIA_TIME_ZONE).date()
    from_date = through_date.fromordinal(through_date.toordinal() - days + 1)
    feedback = [item for item in load_feedback_history() if from_date <= Date.fromisoformat(str(item["date"])) <= through_date]
    services = [item for item in load_service_history() if from_date <= Date.fromisoformat(str(item["date"])) <= through_date]
    if campus:
        feedback = [item for item in feedback if item.get("campus") == campus]
        services = [item for item in services if item.get("campus") == campus]
    service_by_key = {(row.get("campus"), row.get("date"), row.get("meal")): row for row in services}
    rating_points = {"Poor": 1, "Average": 2, "Good": 3, "Excellent": 4}
    groups: dict[tuple, dict] = {}
    for item in feedback:
        key = (item.get("campus"), item.get("date"), item.get("meal", "Lunch"), item.get("dish", ""))
        group = groups.setdefault(key, {"campus": key[0], "date": key[1], "meal": key[2], "dish": key[3], "ratings": [], "comments": [], "menuSnapshot": item.get("menuSnapshot", "")})
        if item.get("rating") in rating_points:
            group["ratings"].append(rating_points[item["rating"]])
        if item.get("comment"):
            group["comments"].append(item["comment"])
    rows = []
    for group in groups.values():
        service = service_by_key.get((group["campus"], group["date"], group["meal"]), {})
        prepared = float(service.get("prepared", 0) or 0)
        leftover = float(service.get("leftover", 0) or 0)
        rows.append({
            "campus": group["campus"], "date": group["date"], "meal": group["meal"], "dish": group["dish"],
            "menuSnapshot": group["menuSnapshot"], "responses": len(group["ratings"]),
            "averageRating": round(sum(group["ratings"]) / len(group["ratings"]), 2) if group["ratings"] else None,
            "attendance": service.get("attendance"), "preparedKg": prepared or None, "leftoverKg": leftover or None,
            "wastePercent": round(leftover / prepared * 100, 1) if prepared > 0 else None,
            "comments": group["comments"][-5:],
        })
    rows.sort(key=lambda row: (row["date"], row["meal"], row["dish"]), reverse=True)
    return {"fromDate": from_date.isoformat(), "throughDate": through_date.isoformat(), "rows": rows[:500]}


@app.post("/api/feedback", status_code=201)
async def create_feedback(payload: FeedbackIn) -> dict:
    feedback = payload.model_dump()
    feedback["date"] = feedback["date"].isoformat()
    if uses_postgres():
        saved = await run_in_threadpool(POSTGRES_STORE.add, "feedback", feedback)
        return {"feedback": saved}
    if uses_firestore():
        saved = await run_in_threadpool(CLOUD_STORE.add, "feedback", feedback)
        return {"feedback": saved}
    feedback.update(id=str(uuid4()), createdAt=datetime.now(timezone.utc).isoformat())
    async with STORE_LOCK:
        store = read_store()
        store["feedback"].insert(0, feedback)
        store["feedback"] = store["feedback"][:5000]
        write_store(store)
    return {"feedback": feedback}


@app.get("/")
async def dashboard() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "index.html")


@app.get("/{asset_path:path}")
async def static_asset(asset_path: str) -> FileResponse:
    allowed_assets = {"script.js", "style.css", "realistic-theme.css"}
    if asset_path not in allowed_assets:
        raise HTTPException(status_code=404, detail="Asset not found.")
    return FileResponse(PROJECT_ROOT / asset_path)
