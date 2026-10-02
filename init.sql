-- Synthetic demonstration records only. Replace them with verified mess logs
-- before using predictions for operational planning.
CREATE TABLE IF NOT EXISTS service_records (
    id TEXT PRIMARY KEY,
    campus TEXT NOT NULL CHECK (campus IN ('North Campus Mess', 'South Campus Mess')),
    service_date DATE NOT NULL,
    meal TEXT NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Dinner', 'Snacks')),
    cuisine TEXT NOT NULL DEFAULT '',
    forecast DOUBLE PRECISION NOT NULL CHECK (forecast >= 0),
    attendance DOUBLE PRECISION NOT NULL CHECK (attendance >= 0),
    prepared DOUBLE PRECISION NOT NULL CHECK (prepared >= 0),
    leftover DOUBLE PRECISION NOT NULL CHECK (leftover >= 0),
    source TEXT NOT NULL,
    is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE service_records ADD COLUMN IF NOT EXISTS cuisine TEXT NOT NULL DEFAULT '';


CREATE INDEX IF NOT EXISTS service_records_history_idx
    ON service_records (service_date DESC, campus, meal);

CREATE UNIQUE INDEX IF NOT EXISTS service_records_real_unique_idx
    ON service_records (campus, service_date, meal)
    WHERE is_synthetic = FALSE;

CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    rating TEXT NOT NULL CHECK (rating IN ('Excellent', 'Good', 'Average', 'Poor')),
    dish TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    campus TEXT NOT NULL CHECK (campus IN ('North Campus Mess', 'South Campus Mess')),
    meal TEXT NOT NULL DEFAULT 'Lunch' CHECK (meal IN ('Breakfast', 'Lunch', 'Dinner', 'Snacks')),
    menu_snapshot TEXT NOT NULL DEFAULT '',
    service_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS meal TEXT NOT NULL DEFAULT 'Lunch';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS menu_snapshot TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS menus (
    id TEXT PRIMARY KEY,
    campus TEXT NOT NULL CHECK (campus IN ('North Campus Mess', 'South Campus Mess')),
    menu_date DATE NOT NULL,
    meal TEXT NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Dinner', 'Snacks')),
    veg TEXT NOT NULL,
    non_veg TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campus, menu_date, meal)
);

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
    reason TEXT NOT NULL CHECK (reason IN ('overproduction', 'plate_return', 'spoilage', 'preparation', 'other')),
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS waste_records_history_idx
    ON waste_records (waste_date DESC, campus, meal, dish);

-- Seed 180 days across both campuses and four meal periods. Stable formulas
-- make the generated labels reproducible; is_synthetic keeps them out of the
-- real-data model as soon as any real service record is saved.
WITH days AS (
    SELECT d::date AS service_date,
           (d::date - CURRENT_DATE)::int AS day_offset
    FROM generate_series(CURRENT_DATE - 180, CURRENT_DATE - 1, INTERVAL '1 day') AS d
),
campuses AS (
    SELECT * FROM (VALUES
        ('North Campus Mess', 0),
        ('South Campus Mess', 1)
    ) AS c(campus, campus_offset)
),
meals AS (
    SELECT * FROM (VALUES
        ('Breakfast', 0, 310, 260),
        ('Lunch', 1, 470, 380),
        ('Dinner', 2, 390, 330),
        ('Snacks', 3, 125, 115)
    ) AS m(meal, meal_offset, north_base, south_base)
),
generated AS (
    SELECT d.service_date, c.campus, m.meal,
           GREATEST(0,
             (CASE WHEN c.campus_offset = 0 THEN m.north_base ELSE m.south_base END)
             + CASE EXTRACT(ISODOW FROM d.service_date)::int
                   WHEN 6 THEN 14 WHEN 7 THEN 24 ELSE 0 END
             + MOD(ABS(d.day_offset) * 7 + c.campus_offset * 13 + m.meal_offset * 17, 43) - 21
           )::double precision AS attendance,
           d.day_offset, c.campus_offset, m.meal_offset
    FROM days d CROSS JOIN campuses c CROSS JOIN meals m
)
INSERT INTO service_records
    (id, campus, service_date, meal, cuisine, forecast, attendance, prepared, leftover, source, is_synthetic)
SELECT MD5(campus || service_date::text || meal), campus, service_date, meal,
       CASE meal
           WHEN 'Breakfast' THEN 'Poha and seasonal breakfast (demo)'
           WHEN 'Lunch' THEN 'Dal, rice and daily special (demo)'
           WHEN 'Dinner' THEN 'Paneer or vegetable curry (demo)'
           ELSE 'Tea and savory snack (demo)'
       END,
       GREATEST(0, attendance + MOD(ABS(day_offset) * 11 + campus_offset * 5 + meal_offset * 3, 31) - 15),
       attendance,
       ROUND((attendance * 0.39 + MOD(ABS(day_offset) * 3 + meal_offset, 13))::numeric, 1)::double precision,
       ROUND((2 + MOD(ABS(day_offset) * 5 + campus_offset * 7 + meal_offset * 11, 81) / 10.0)::numeric, 1)::double precision,
       'Synthetic demo data (not real attendance)', TRUE
FROM generated
ON CONFLICT (id) DO NOTHING;

UPDATE service_records
SET cuisine = CASE meal
    WHEN 'Breakfast' THEN 'Poha and seasonal breakfast (demo)'
    WHEN 'Lunch' THEN 'Dal, rice and daily special (demo)'
    WHEN 'Dinner' THEN 'Paneer or vegetable curry (demo)'
    ELSE 'Tea and savory snack (demo)'
END
WHERE is_synthetic AND cuisine = '';
