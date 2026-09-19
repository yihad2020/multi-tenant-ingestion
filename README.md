# Multi-Tenant Ingestion Pipeline

A TypeScript/PostgreSQL ingestion service for storefront orders, email events,
and ad spend across multiple tenants.

This project was built for a time-boxed data ingestion assessment. The
implementation focuses on correctness under ordinary pipeline failure modes
rather than breadth.

The main behaviors demonstrated are:

- safe reruns
- overlapping exports
- interrupted batch recovery
- schema drift
- late-arriving records
- missing source detection
- PostgreSQL-enforced tenant isolation
- raw → staging → queryable modeling
- configuration-driven tenant onboarding

---

## Architecture

```text
fixtures/manifest.json
        |
        v
expected_batches
        |
        v
ingestion runner
        |
        +---- SHA-256 file identity
        +---- source validation
        +---- transactional batch ingestion
        |
        v
raw_records (JSONB)
        |
        v
staging views
        |
        v
daily queryable marts
```

The ingestion service separates three concerns:

1. **Expected delivery**
   - what source files should exist
   - loaded from `fixtures/manifest.json`

2. **Ingestion execution**
   - what files were attempted
   - whether they completed, failed, or were interrupted
   - tracked in `ingestion_runs`

3. **Business records**
   - individual source records
   - stored tenant-scoped in `raw_records`
   - protected from duplicate insertion

This distinction makes missing files, failed processing, exact file replay,
and overlapping exports observable as separate conditions.

---

## Technology

- TypeScript
- Node.js
- PostgreSQL 17
- Docker / Docker Compose
- `pg`
- `csv-parse`
- `zod`
- `tsx`

No ORM is used. PostgreSQL constraints, transactions, and Row-Level Security
are intentionally visible in the implementation.

---

# Installation / Clean Checkout

## Requirements

Install:

- Node.js
- npm
- Docker Desktop or Docker Engine with Docker Compose

The PostgreSQL container is exposed on host port:

```text
5433
```

Port `5433` is used so the project does not conflict with a local PostgreSQL
instance commonly running on `5432`.

---

## 1. Clone the repository

```bash
git clone https://github.com/yihad2020/multi-tenant-ingestion.git
cd multi-tenant-ingestion
```

---

## 2. Install dependencies

```bash
npm install
```

---

## 3. Create the environment file

Copy the provided example:

```bash
cp .env.example .env
```

The default development configuration is:

```env
DATABASE_URL=postgres://pipeline:pipeline@127.0.0.1:5433/pipeline
FIXTURES_DIR=./fixtures
```

---

## 4. Start PostgreSQL

```bash
docker compose up -d
```

Verify that the database is healthy:

```bash
docker compose ps
```

Expected state:

```text
postgres ... Up ... (healthy)
```

---

## 5. Run database migrations

```bash
npm run migrate
```

On a fresh database:

```text
Applied 001_core.sql
Applied 002_models.sql
```

Migrations are tracked in `schema_migrations`.

Running the command again is safe:

```bash
npm run migrate
```

Expected:

```text
Skipping 001_core.sql
Skipping 002_models.sql
```

---

## 6. Synchronize tenant/source configuration

```bash
npm run sync
```

Expected:

```text
Synced 2 tenants and 30 expected batches.
```

The tenant configuration is discovered from the fixture manifest rather than
hard-coded into the ingestion logic.

---

## 7. Run ingestion

```bash
npm run ingest
```

A clean ingestion of the supplied fixtures should finish with:

```text
============================================================
INGESTION SUMMARY
============================================================
Files completed: 29
Files skipped:   0
Files missing:   1
Rows seen:       4498
Rows inserted:   4484
Rows skipped:    14
```

The difference between rows seen and rows inserted is intentional.

Northwind orders batch 3 contains an overlapping export:

```text
seen=146
inserted=132
skipped=14
```

Those 14 records had already appeared in an earlier export and are not
double-counted.

The one missing file is also intentional:

```text
lumen/ad_spend/batch_03.csv
```

It is declared in the manifest but is not present in the supplied fixture
directory.

The pipeline reports it as missing instead of fabricating data or marking the
batch successful.

---

# Available Commands

## Typecheck

```bash
npm run typecheck
```

Runs:

```text
tsc --noEmit
```

---

## Run migrations

```bash
npm run migrate
```

Applies database migrations that have not already been recorded.

---

## Synchronize configuration

```bash
npm run sync
```

Synchronizes:

- tenants
- expected source batches

from:

```text
fixtures/manifest.json
```

---

## Run ingestion

```bash
npm run ingest
```

Processes all available expected fixture files.

The command is safe to rerun.

After the initial ingestion, running it again should produce:

```text
============================================================
INGESTION SUMMARY
============================================================
Files completed: 0
Files skipped:   29
Files missing:   1
Rows seen:       0
Rows inserted:   0
Rows skipped:    0
```

Completed files are recognized by SHA-256 file identity.

---

## Check pipeline/source status

```bash
npm run status
```

The status command distinguishes:

- `MISSING` — expected source file is physically absent
- `PENDING` — file exists but has not been ingested
- `FAILED` — processing was attempted and failed
- `RUNNING` — processing is active or was interrupted before cleanup
- completed batches

With the supplied fixtures, the expected result is:

```text
============================================================
SOURCE STATUS
============================================================
MISSING tenant=lumen source=ad_spend batch=3 window=2026-01-18..2026-01-23 path=lumen/ad_spend/batch_03.csv

------------------------------------------------------------
Expected batches: 30
Completed:        29
Missing:          1
Pending:          0
Failed:           0
Running:          0

Pipeline status: ATTENTION REQUIRED
```

This command intentionally returns a non-zero exit status when attention is
required.

That behavior makes the command suitable for use by a scheduler or monitoring
system without requiring log-text parsing.

---

## Query Northwind

```bash
npm run report -- northwind
```

Returns tenant-scoped daily:

- orders
- gross revenue
- email events
- ad spend

---

## Query Lumen

```bash
npm run report -- lumen
```

The exact same reporting implementation is used for both tenants.

There is no separate Northwind/Lumen reporting code path.

---

## Verify interrupted-run recovery

```bash
npm run verify:replay
```

This command deliberately injects a failure approximately one third of the way
through an ingestion batch.

The verification demonstrates:

1. the batch begins processing
2. an artificial interruption occurs
3. PostgreSQL rolls back the transaction
4. zero partial records are committed
5. the ingestion run remains `running`
6. the next normal ingestion recognizes the run as retryable
7. the second attempt completes
8. the final dataset returns to the expected record count

Key output:

```text
Simulating interruption after 46 rows...
Expected interruption: Simulated interruption after 46 rows
Rows committed after interruption: 0

Run before retry:
{ status: 'running', attempt_count: 1 }
```

After retry:

```text
Run after retry:
{ status: 'completed', attempt_count: 2, rows_inserted: 137 }

Final raw record count: 4484

Replay verification PASSED.
```

---

## Verify tenant isolation

```bash
npm run verify:tenant
```

This verification executes application queries under tenant-scoped PostgreSQL
Row-Level Security.

Expected:

```text
Verifying tenant isolation...

Northwind context: {
  visibleTenants: [ 'northwind' ],
  lumenRawRows: '0',
  lumenMartRows: '0'
}

Lumen context: [ 'lumen' ]

Cross-tenant write: BLOCKED

Tenant isolation verification PASSED.
```

The verification demonstrates that a Northwind application context cannot:

- read Lumen raw records
- read Lumen mart records
- write records using Lumen's tenant identity

Tenant isolation therefore does not depend only on TypeScript query filters.

---

# Replay and Idempotency

Replay is handled at two separate levels.

## File-level idempotency

Every source file receives a SHA-256 hash.

A successful ingestion run is uniquely identified using:

```text
tenant_id
source
file_hash
```

If the exact same physical file is delivered again after successfully
completing, it is skipped.

This handles:

```text
same file
same contents
same tenant
same source
```

---

## Record-level idempotency

File hashing alone is not sufficient.

A different export may contain some records that were already delivered in an
earlier file.

Records therefore also use tenant-scoped natural identities.

Examples:

### Orders

```text
order_id
```

### Email events

```text
event_id
```

### Ad spend

```text
date + campaign_id + platform
```

The database uniqueness rule includes the tenant:

```text
tenant_id + source + record_key
```

This allows different tenants to legitimately use the same external
identifier without colliding.

For example:

```text
northwind / cmp_100
lumen     / cmp_100
```

are independent records.

---

# Batch Atomicity

Each source batch is written inside one PostgreSQL transaction.

Conceptually:

```text
BEGIN
    insert record 1
    insert record 2
    insert record 3
    ...
COMMIT
```

If processing fails halfway through:

```text
BEGIN
    insert record 1
    insert record 2
    PROCESS DIES
```

PostgreSQL rolls back the entire unfinished transaction.

This prevents partially committed batches.

The replay verification included in the repository explicitly proves this
behavior.

---

# Source Handling

## Orders

Format:

```text
CSV
```

Expected fields include:

```text
order_id
created_at
channel
gross
currency
customer_email
```

Natural identity:

```text
order_id
```

The supplied Northwind fixture contains an intentional overlapping export.

Batch 3 demonstrates record-level deduplication:

```text
seen=146
inserted=132
skipped=14
```

---

## Email Events

Format:

```text
NDJSON
```

Expected fields include:

```text
event_id
type
email
campaign_id
occurred_at
```

Natural identity:

```text
event_id
```

Event types are normalized in staging.

---

## Ad Spend

Format:

```text
CSV
```

Natural identity:

```text
date + campaign_id + platform
```

The supplied data contains an intentional upstream schema change.

### Version 1

```text
date
campaign_id
platform
spend
```

### Version 2

```text
date
campaign_id
platform
cost_usd
```

Both known schemas are explicitly recognized.

Any unexpected column shape fails loudly instead of being silently accepted.

---

# Schema Drift

Ad-spend changes from:

```text
spend
```

to:

```text
cost_usd
```

during the fixture sequence.

The raw payload remains unchanged.

The staging layer normalizes both versions using:

```sql
COALESCE(
    payload->>'cost_usd',
    payload->>'spend'
)::NUMERIC(18, 2)
AS spend_usd
```

The queryable model therefore exposes one stable field:

```text
spend_usd
```

while preserving the original source representation in raw storage.

---

# Late-Arriving Records

Records use their business/event timestamp rather than their delivery time.

The supplied Northwind email fixtures contain **24 events** delivered in a
later batch whose `occurred_at` timestamps belong to earlier reporting dates.

The implementation uses a **restatement policy**.

A late record:

```text
arrives in a later batch
        |
        v
stored using occurred_at
        |
        v
assigned to historical event_date
        |
        v
daily mart automatically restates
```

This implementation does not freeze previously queried daily metrics.

If the business required immutable financial or operational snapshots, a
production version could introduce:

- reporting cutoffs
- versioned snapshots
- finalized reporting periods

The rationale is documented in `TRADEOFFS.md`.

---

# Raw → Staging → Queryable

## Raw layer

Table:

```text
raw_records
```

Raw source payloads are preserved as JSONB together with:

- tenant
- source
- natural record identity
- source path
- ingestion run
- ingestion timestamp

The raw layer intentionally stays close to the delivered source.

---

## Staging layer

Views:

```text
stg_orders
stg_email_events
stg_ad_spend
```

Staging handles normalization such as:

- string → timestamp conversion
- timestamp → reporting date
- casing normalization
- currency normalization
- ad-spend schema normalization

---

## Queryable layer

Views:

```text
mart_daily_orders
mart_daily_email_events
mart_daily_ad_spend
```

These provide simple tenant-scoped daily models suitable for downstream
queries.

PostgreSQL views were intentionally chosen over a separate warehouse/dbt stack
for the assessment because the fixture volume is small and the focus is
ingestion correctness.

---

# Tenant Isolation

Tenant identity is enforced in the persistence model.

Tenant-scoped tables use PostgreSQL Row-Level Security.

Application work is performed under the restricted:

```text
pipeline_app
```

role.

The current tenant is placed into the database session using:

```text
app.tenant_id
```

RLS policies compare table `tenant_id` against this context.

This means tenant isolation is enforced even if an application query attempts
to request another tenant's rows.

Queryable views use:

```sql
WITH (security_invoker = true)
```

so the caller's RLS restrictions remain effective through the view layer.

---

# Multi-Tenant Design

Both supplied tenants use the same:

- ingestion runner
- parsers
- raw table
- staging models
- queryable marts
- monitoring system
- replay implementation
- reporting code

The pipeline does not branch on client names such as:

```typescript
if (tenant === "northwind") {
  // ...
}
```

or:

```typescript
if (tenant === "lumen") {
  // ...
}
```

Tenant identity is data/configuration rather than application architecture.

---

# Adding a Third Client

If another client uses the existing three source contracts, onboarding is
configuration work.

Add the client's expected batches to:

```text
fixtures/manifest.json
```

Then run:

```bash
npm run sync
npm run ingest
```

The new tenant automatically uses the existing:

- database schema
- uniqueness constraints
- RLS policies
- ingestion logic
- staging models
- marts

No client-specific tables or models are required.

If a future client introduces a genuinely different upstream contract, the
preferred extension is a new source/schema version rather than branching on
the tenant name.

---

# Missing Source Detection

Expected source delivery and successful ingestion are intentionally modeled
separately.

The manifest says what **should** exist.

The filesystem says what **actually arrived**.

`ingestion_runs` says what was **actually processed**.

This allows the service to distinguish:

```text
expected but missing
exists but pending
processing failed
currently/stale running
successfully completed
```

The supplied fixtures demonstrate this with:

```text
lumen/ad_spend/batch_03.csv
```

which is expected but physically absent.

---

# Project Structure

```text
multi-tenant-ingestion/
├── fixtures/
│   ├── manifest.json
│   ├── README.md
│   ├── lumen/
│   │   ├── orders/
│   │   ├── email_events/
│   │   └── ad_spend/
│   └── northwind/
│       ├── orders/
│       ├── email_events/
│       └── ad_spend/
│
├── src/
│   ├── config/
│   │   ├── manifest.ts
│   │   └── sync.ts
│   │
│   ├── db/
│   │   ├── client.ts
│   │   ├── migrate.ts
│   │   └── migrations/
│   │       ├── 001_core.sql
│   │       └── 002_models.sql
│   │
│   ├── ingestion/
│   │   ├── files.ts
│   │   ├── parsers.ts
│   │   ├── raw-store.ts
│   │   ├── run-store.ts
│   │   └── runner.ts
│   │
│   ├── modeling/
│   │   └── report.ts
│   │
│   ├── monitoring/
│   │   └── source-status.ts
│   │
│   ├── verification/
│   │   ├── replay.ts
│   │   └── tenant-isolation.ts
│   │
│   └── cli.ts
│
├── .env.example
├── docker-compose.yml
├── package.json
├── README.md
├── TRADEOFFS.md
└── tsconfig.json
```

---

# Reproducible Verification

A useful full verification sequence from a clean database is:

```bash
docker compose down -v
docker compose up -d

npm run migrate
npm run sync
npm run ingest

npm run typecheck
npm run verify:tenant
npm run verify:replay

npm run report -- northwind
npm run report -- lumen

npm run status
```

Expected important results:

```text
Expected batches: 30
Available/completed: 29
Missing: 1
```

Initial ingestion:

```text
Rows seen:     4498
Rows inserted: 4484
Rows skipped:  14
```

Replay verification:

```text
Rows committed after interruption: 0
Final raw record count: 4484
Replay verification PASSED.
```

Tenant isolation verification:

```text
Cross-tenant write: BLOCKED
Tenant isolation verification PASSED.
```

---

# Intentional Limitations

The implementation deliberately does not include:

- HTTP API
- frontend/UI
- scheduler
- message queue
- distributed worker coordination
- generic schema registry
- external alert delivery
- dedicated warehouse
- dbt project
- immutable reporting snapshots

These were intentionally excluded from the assessment time box so that the
pipeline failure modes could be implemented and demonstrated more deeply.

A production version would likely add:

- worker leases / heartbeats
- structured metrics and logs
- automated alert delivery
- CI against disposable PostgreSQL
- incremental warehouse models
- mutable-record version history where required
- reporting cutoffs / snapshots where historical immutability is required

See `TRADEOFFS.md` for the complete reasoning.

---

# Known Fixture Limitation

The following expected source file is absent from the supplied fixture set:

```text
lumen/ad_spend/batch_03.csv
```

The service intentionally does not attempt to reconstruct or fabricate this
data.

Instead:

```bash
npm run status
```

reports the source as:

```text
MISSING
```

This is expected behavior for the submitted dataset.

---

# Design Decisions

See:

```text
TRADEOFFS.md
```

for detailed discussion of:

- implementation priorities
- replay strategy
- file vs record idempotency
- schema drift
- batch atomicity
- interrupted-run recovery
- late-arriving data
- source monitoring
- tenant onboarding
- deliberately omitted functionality
- production follow-up work
- the hardest design decision
- final implementation scope
