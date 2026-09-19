-- =========================================================
-- APPLICATION ROLE
-- =========================================================

-- The service connects locally using the database owner so it can run
-- migrations. Application queries then SET ROLE to this limited role.
--
-- This lets Row-Level Security actually enforce tenant boundaries.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = 'pipeline_app'
    ) THEN
        CREATE ROLE pipeline_app NOLOGIN;
    END IF;
END
$$;


-- =========================================================
-- TENANTS
-- =========================================================

CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,

    display_name TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
);


-- =========================================================
-- EXPECTED SOURCE BATCHES
-- =========================================================

-- Populated from fixtures/manifest.json.
--
-- This table describes what SHOULD have arrived. Comparing this table
-- with ingestion_runs lets the status command detect missing sources.

CREATE TABLE IF NOT EXISTS expected_batches (
    tenant_id TEXT NOT NULL
        REFERENCES tenants(id),

    source TEXT NOT NULL
        CHECK (
            source IN (
                'orders',
                'email_events',
                'ad_spend'
            )
        ),

    batch_number INTEGER NOT NULL,

    source_path TEXT NOT NULL,

    covers_from DATE NOT NULL,

    covers_to DATE NOT NULL,

    PRIMARY KEY (
        tenant_id,
        source,
        batch_number
    )
);


-- =========================================================
-- INGESTION RUNS
-- =========================================================

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    tenant_id TEXT NOT NULL
        REFERENCES tenants(id),

    source TEXT NOT NULL
        CHECK (
            source IN (
                'orders',
                'email_events',
                'ad_spend'
            )
        ),

    batch_number INTEGER NOT NULL,

    source_path TEXT NOT NULL,

    -- SHA-256 of the physical file.
    --
    -- This handles exact file redelivery independently from
    -- record-level duplicate handling.
    file_hash TEXT NOT NULL,

    status TEXT NOT NULL
        CHECK (
            status IN (
                'running',
                'completed',
                'failed'
            )
        ),

    attempt_count INTEGER NOT NULL
        DEFAULT 1,

    rows_seen INTEGER NOT NULL
        DEFAULT 0,

    rows_inserted INTEGER NOT NULL
        DEFAULT 0,

    rows_skipped INTEGER NOT NULL
        DEFAULT 0,

    started_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    finished_at TIMESTAMPTZ,

    error_message TEXT,

    -- The same physical file for the same tenant/source represents
    -- the same ingestion unit.
    UNIQUE (
        tenant_id,
        source,
        file_hash
    )
);


-- =========================================================
-- RAW RECORDS
-- =========================================================

-- One generic raw table intentionally preserves source payloads.
--
-- Source-specific normalization happens later in staging.
--
-- record_key contains the natural identity supplied by the source:
--
-- orders       -> order_id
-- email_events -> event_id
-- ad_spend     -> date + campaign_id + platform
--
-- Including tenant_id in the unique key prevents identifiers shared
-- by different tenants from colliding.

CREATE TABLE IF NOT EXISTS raw_records (
    id BIGSERIAL PRIMARY KEY,

    tenant_id TEXT NOT NULL
        REFERENCES tenants(id),

    source TEXT NOT NULL
        CHECK (
            source IN (
                'orders',
                'email_events',
                'ad_spend'
            )
        ),

    record_key TEXT NOT NULL,

    payload JSONB NOT NULL,

    source_path TEXT NOT NULL,

    ingestion_run_id UUID NOT NULL
        REFERENCES ingestion_runs(id),

    ingested_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    UNIQUE (
        tenant_id,
        source,
        record_key
    )
);


CREATE INDEX IF NOT EXISTS
    idx_raw_records_tenant_source
ON raw_records (
    tenant_id,
    source
);


CREATE INDEX IF NOT EXISTS
    idx_ingestion_runs_tenant_source
ON ingestion_runs (
    tenant_id,
    source
);


-- =========================================================
-- TENANT ISOLATION
-- =========================================================

ALTER TABLE expected_batches
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE ingestion_runs
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE raw_records
    ENABLE ROW LEVEL SECURITY;


ALTER TABLE expected_batches
    FORCE ROW LEVEL SECURITY;

ALTER TABLE ingestion_runs
    FORCE ROW LEVEL SECURITY;

ALTER TABLE raw_records
    FORCE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS
    expected_batches_tenant_policy
ON expected_batches;

CREATE POLICY
    expected_batches_tenant_policy
ON expected_batches
USING (
    tenant_id =
    current_setting(
        'app.tenant_id',
        true
    )
)
WITH CHECK (
    tenant_id =
    current_setting(
        'app.tenant_id',
        true
    )
);


DROP POLICY IF EXISTS
    ingestion_runs_tenant_policy
ON ingestion_runs;

CREATE POLICY
    ingestion_runs_tenant_policy
ON ingestion_runs
USING (
    tenant_id =
    current_setting(
        'app.tenant_id',
        true
    )
)
WITH CHECK (
    tenant_id =
    current_setting(
        'app.tenant_id',
        true
    )
);


DROP POLICY IF EXISTS
    raw_records_tenant_policy
ON raw_records;

CREATE POLICY
    raw_records_tenant_policy
ON raw_records
USING (
    tenant_id =
    current_setting(
        'app.tenant_id',
        true
    )
)
WITH CHECK (
    tenant_id =
    current_setting(
        'app.tenant_id',
        true
    )
);


-- =========================================================
-- APPLICATION PERMISSIONS
-- =========================================================

GRANT SELECT
ON tenants
TO pipeline_app;

GRANT
    SELECT,
    INSERT,
    UPDATE,
    DELETE
ON
    expected_batches,
    ingestion_runs,
    raw_records
TO pipeline_app;

GRANT USAGE, SELECT
ON SEQUENCE raw_records_id_seq
TO pipeline_app;