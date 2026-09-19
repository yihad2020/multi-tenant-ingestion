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

I will implement raw → staging → queryable models, but deliberately keep
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

Individual records will also have tenant-scoped natural keys. This handles
overlapping exports where a new physical file contains records already seen
in an earlier file.

A failed or interrupted run is retryable. Record ingestion will happen inside
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