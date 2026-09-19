-- =========================================================
-- STAGING: ORDERS
-- =========================================================

CREATE OR REPLACE VIEW stg_orders
WITH (security_invoker = true)
AS
SELECT
    tenant_id,

    record_key AS order_id,

    (payload->>'created_at')::TIMESTAMPTZ
        AS created_at,

    (
        (payload->>'created_at')::TIMESTAMPTZ
        AT TIME ZONE 'UTC'
    )::DATE AS order_date,

    LOWER(
        TRIM(payload->>'channel')
    ) AS channel,

    (payload->>'gross')::NUMERIC(18, 2)
        AS gross,

    UPPER(
        TRIM(payload->>'currency')
    ) AS currency,

    LOWER(
        TRIM(payload->>'customer_email')
    ) AS customer_email,

    source_path,

    ingested_at

FROM raw_records

WHERE source = 'orders';


-- =========================================================
-- STAGING: EMAIL EVENTS
-- =========================================================

CREATE OR REPLACE VIEW stg_email_events
WITH (security_invoker = true)
AS
SELECT
    tenant_id,

    record_key AS event_id,

    LOWER(
        TRIM(payload->>'type')
    ) AS event_type,

    LOWER(
        TRIM(payload->>'email')
    ) AS email,

    payload->>'campaign_id'
        AS campaign_id,

    (payload->>'occurred_at')::TIMESTAMPTZ
        AS occurred_at,

    (
        (payload->>'occurred_at')::TIMESTAMPTZ
        AT TIME ZONE 'UTC'
    )::DATE AS event_date,

    source_path,

    ingested_at

FROM raw_records

WHERE source = 'email_events';


-- =========================================================
-- STAGING: AD SPEND
-- =========================================================

CREATE OR REPLACE VIEW stg_ad_spend
WITH (security_invoker = true)
AS
SELECT
    tenant_id,

    (payload->>'date')::DATE
        AS spend_date,

    payload->>'campaign_id'
        AS campaign_id,

    LOWER(
        TRIM(payload->>'platform')
    ) AS platform,

    COALESCE(
        payload->>'cost_usd',
        payload->>'spend'
    )::NUMERIC(18, 2)
        AS spend_usd,

    CASE
        WHEN payload ? 'cost_usd'
            THEN 'v2'
        WHEN payload ? 'spend'
            THEN 'v1'
        ELSE 'unknown'
    END AS source_schema_version,

    source_path,

    ingested_at

FROM raw_records

WHERE source = 'ad_spend';


-- =========================================================
-- QUERYABLE MART: DAILY ORDERS
-- =========================================================

CREATE OR REPLACE VIEW mart_daily_orders
WITH (security_invoker = true)
AS
SELECT
    tenant_id,
    order_date,
    currency,

    COUNT(*)::INTEGER
        AS orders,

    SUM(gross)::NUMERIC(18, 2)
        AS gross_revenue

FROM stg_orders

GROUP BY
    tenant_id,
    order_date,
    currency;


-- =========================================================
-- QUERYABLE MART: DAILY EMAIL EVENTS
-- =========================================================

CREATE OR REPLACE VIEW mart_daily_email_events
WITH (security_invoker = true)
AS
SELECT
    tenant_id,
    event_date,
    event_type,

    COUNT(*)::INTEGER
        AS events

FROM stg_email_events

GROUP BY
    tenant_id,
    event_date,
    event_type;


-- =========================================================
-- QUERYABLE MART: DAILY AD SPEND
-- =========================================================

CREATE OR REPLACE VIEW mart_daily_ad_spend
WITH (security_invoker = true)
AS
SELECT
    tenant_id,
    spend_date,
    platform,

    SUM(spend_usd)::NUMERIC(18, 2)
        AS spend_usd

FROM stg_ad_spend

GROUP BY
    tenant_id,
    spend_date,
    platform;


-- =========================================================
-- APPLICATION PERMISSIONS
-- =========================================================

GRANT SELECT
ON
    stg_orders,
    stg_email_events,
    stg_ad_spend,
    mart_daily_orders,
    mart_daily_email_events,
    mart_daily_ad_spend
TO pipeline_app;