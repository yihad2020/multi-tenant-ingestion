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