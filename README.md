# Multi-Tenant Ingestion Pipeline

A TypeScript/PostgreSQL ingestion service for storefront orders, email events,
and ad spend across multiple tenants.

The implementation focuses on the pipeline failure modes called out in the
assessment:

- safe reruns and overlapping exports
- interrupted batch recovery
- schema drift
- late-arriving records
- missing source detection
- tenant isolation enforced by PostgreSQL
- raw → staging → queryable models
- configuration-driven tenant onboarding

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