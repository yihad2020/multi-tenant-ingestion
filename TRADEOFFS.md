# Tradeoffs and Decisions

## Time-box

This assessment is intentionally limited to approximately eight hours.
I prioritized pipeline correctness around replay/idempotency and tenant
isolation over breadth.

## Priorities

I chose to implement deeply:

1. safe replay and record-level idempotency
2. tenant-aware ingestion with isolation enforced in the data model
3. explicit schema-drift handling
4. late-arriving record behavior
5. missing-source detection

I implemented raw → staging → queryable models, but deliberately keep
the modelling layer small.

I am not prioritizing an HTTP API, scheduler, queue, UI, or generalized
schema registry because none is necessary to demonstrate the pipeline
properties being evaluated.

## Fixture observations

Before implementation I inspected the fixture set and identified:

- an overlapping Northwind orders export
- late-arriving Northwind email events
- an ad-spend column rename from `spend` to `cost_usd`
- one expected Lumen ad-spend batch that is absent
- identifiers reused across tenants
- tenant-specific differences in source naming and casing

These observations shaped the architecture rather than being handled as
one-off patches.

## Manifest-driven onboarding

The manifest is treated as configuration, not as client-specific code.

Tenants are discovered from manifest entries and synchronized into the
database. Expected source batches are also synchronized from that same
configuration.

A third client therefore requires new manifest entries and fixture/source
configuration, not a new table, model, or branch on the client name.

The manifest records what *should* arrive. It is intentionally synchronized
even when the referenced physical file is missing. This distinction allows
monitoring to detect an expected source that never arrived.

## Replay strategy

Replay is handled at two independent levels.

**File idempotency**

`(tenant_id, source, file_hash)` identifies an exact file redelivery. A file
that already completed successfully is skipped.

**Record idempotency**

Individual records also use tenant-scoped natural keys. This handles
overlapping exports where a new physical file contains records already seen
in an earlier file.

A failed or interrupted run is retryable. Record ingestion happens inside
a PostgreSQL transaction, so a process failure during a batch does not leave
a partially committed batch.

A run left in `running` state by a process crash is treated as retryable on
the next execution. I deliberately did not implement distributed leases or
heartbeats because this assessment uses a single worker. In production,
concurrent workers would require an ownership/lease mechanism.

## Schema drift

The ad-spend fixture changes its spend column from `spend` to `cost_usd`
partway through the dataset.

I chose to adapt to this specific known change explicitly:

- `spend` is recognized as ad-spend schema v1
- `cost_usd` is recognized as ad-spend schema v2

The raw payload is preserved as received. Normalization happens later in
staging.

Any other column shape fails loudly rather than being silently accepted.
This prevents an unknown upstream contract change from producing plausible
but incorrect downstream data.

I deliberately did not implement a generic schema registry in the time box.
For three sources, explicit version handling is easier to understand and
safer to defend.

## Batch atomicity

Each raw batch is inserted inside one PostgreSQL transaction.

If processing fails halfway through a batch, the raw inserts roll back.
The ingestion run may remain `running` if the process itself dies, but that
state is deliberately retryable.

This gives the pipeline two layers of replay safety:

1. transaction rollback protects interrupted batches
2. tenant-scoped natural keys protect replay and overlapping exports

## Source arrival monitoring

Expected batches and actual ingestion runs are intentionally separate.

`npm run status` distinguishes:

- `MISSING`: expected source file is physically absent
- `PENDING`: source exists but has not yet been ingested
- `FAILED`: ingestion attempted and failed
- `RUNNING`: ingestion is active or was interrupted before status cleanup
- completed batches

The command returns a non-zero exit code when attention is required, so it
can be used by an external scheduler or alerting system without parsing logs.

The supplied fixture correctly reports Lumen ad-spend batch 3 as missing.

## Interrupted-run recovery

I added a reproducible fault-injection verification for batch atomicity.

The verification throws after approximately one third of a batch has been
inserted inside its PostgreSQL transaction. The transaction rolls back to
zero committed rows while the ingestion run deliberately remains `running`,
which represents a process dying before status cleanup.

The next normal ingestion treats that stale `running` run as retryable,
processes the batch again, and restores the complete dataset without
double-counting.

I did not implement worker leases or heartbeats. With multiple concurrent
workers, a production version should distinguish an actively owned run from
a stale `running` run before retrying it.

## Raw, staging, and queryable models

The pipeline keeps source payloads intact in `raw_records`.

Staging views then normalize types and source representation:

- timestamps become typed PostgreSQL timestamps/dates
- casing is normalized where appropriate
- ad-spend `spend` and `cost_usd` both become `spend_usd`

Queryable daily views aggregate the normalized staging layer.

I chose PostgreSQL views rather than materialized tables or a separate
transformation framework because the fixture volume is small and this keeps
the assessment focused on ingestion correctness. At larger scale I would
move these transformations into incremental warehouse/dbt models.


## Late-arriving records

Records are modeled using their business/event timestamp, not their file
arrival timestamp.

The Northwind email fixture contains events delivered in a later batch whose
`occurred_at` dates belong to earlier reporting days.

I chose a restatement policy: historical daily metrics are allowed to change
when valid late records arrive.

Because the marts are views over the current staging data, a newly ingested
late event automatically appears in its original historical reporting date.
No explicit backfill job is required for this implementation.

This makes current queries eventually correct, but means previously exported
or cached reports may differ from later queries. If the business required
immutable financial snapshots, I would introduce reporting cutoffs and
versioned snapshots instead.

## What I deliberately did not build

Given the assessment time-box, I deliberately did not add:

- an HTTP API
- a UI
- a workflow scheduler
- a message queue
- distributed worker coordination
- a generic schema registry
- dbt or a separate warehouse
- materialized reporting snapshots
- automatic source-specific alert delivery

These would increase breadth without materially improving the ingestion
failure modes I chose to demonstrate deeply.

The service instead exposes CLI commands that make the important behaviors
easy to run and verify locally.


## Adding a third client

A third client should be configuration work rather than application code.

If the new client uses the same three source contracts, onboarding consists
of adding its expected batches to the manifest and running the normal sync
and ingestion commands.

The tenant ID becomes part of the same database keys and Row-Level Security
boundary automatically.

If a future tenant introduces a genuinely different source contract, I would
add a new source/schema version rather than branch on the tenant name.


## What I would build with another week

With additional time I would add:

1. integration tests running against a disposable PostgreSQL instance
2. worker leases and heartbeats for safe concurrent ingestion workers
3. structured logs and metrics for ingestion latency and source freshness
4. alert delivery for missing/failed sources
5. payload hashes or source-version history for mutable records
6. incremental warehouse/dbt models for larger datasets
7. reporting cutoffs or versioned snapshots where immutable reporting is
   required
8. CI that performs a clean database setup, ingestion, and verification suite


## Hardest part

The hardest design problem was defining replay semantics without confusing
file delivery identity with business-record identity.

Hashing files solves exact redelivery but does not solve overlapping exports.
Natural record keys solve overlap but do not tell us whether a physical file
has already completed successfully.

I therefore modeled both independently and combined them with transactional
batch ingestion.

The controlled interruption verification was useful because it demonstrates
that this design works under the failure mode rather than only describing it.


## Final scope

Completed:

- ingestion for all three sources
- both supplied tenants through the same code path
- raw → staging → queryable models
- exact-file replay protection
- overlapping-export deduplication
- interrupted-batch rollback and retry
- explicit ad-spend schema-version handling
- late-arriving record restatement
- missing-source monitoring
- PostgreSQL-enforced tenant isolation

Intentionally incomplete:

- the absent Lumen ad-spend batch cannot be ingested because no source file was
  supplied
- distributed worker coordination is not implemented
- scheduling and external alert delivery are outside the submitted scope