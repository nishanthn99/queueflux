# Operations Guide

## Docker Compose services

- web: React production build served by Nginx on host port 3000.
- api: Spring Boot API on host port 8080.
- db: PostgreSQL 17 on host port 5432.
- queueflux-postgres: named volume containing PostgreSQL data.

Start all services:

§§§bash
docker compose up --build
§§§

Start in the background:

§§§bash
docker compose up -d --build
docker compose ps
docker compose logs -f api
§§§

Health check:

§§§bash
curl http://localhost:8080/actuator/health
§§§

## Stop without deleting run history

§§§bash
docker compose down
§§§

This removes containers and the Compose network but keeps the named database volume. Run history should remain after the next docker compose up -d.

**Destructive command:** docker compose down -v removes the named volume and all stored run history. Do not use it unless the database contents are intentionally disposable.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| DB_URL | jdbc:postgresql://localhost:5432/queueflux | JDBC URL |
| DB_USERNAME | queueflux | Database user |
| DB_PASSWORD | queueflux-dev | Development-only password |
| SERVER_PORT | 8080 | API port |
| APP_RETENTION_RUN_TTL_DAYS | 30 | Retention period for completed/failed runs; 0 disables cleanup |
| APP_RETENTION_CLEANUP_CRON | 0 0 2 * * * | Cron schedule for retention cleanup |

Change development credentials before sharing the Compose stack beyond a trusted local machine. Do not commit secrets to the repository.

## Backup and restore

Create a logical backup:

§§§bash
docker compose exec -T db pg_dump -U queueflux -d queueflux > queueflux-backup.sql
§§§

Restore into a running database:

§§§bash
cat queueflux-backup.sql | docker compose exec -T db psql -U queueflux -d queueflux
§§§

Keep backups outside the repository and protect them like application data. A scenario or result may contain internal workload labels.

## Asynchronous run behaviour

The API uses a single-process bounded executor (2 core threads, 4 maximum threads, queue capacity 50). Run records are persisted before submission. Progress is updated during the simulation and final results are stored in JSONB.

On a single-process API restart, QUEUED and RUNNING rows are replayed deterministically from virtual time zero. This restarts the whole scenario rather than resuming from an event checkpoint. Do not run multiple API replicas: distributed leases and duplicate-run protection are not implemented.

## Operational security checklist before network deployment

- Replace default database credentials and restrict PostgreSQL network access.
- Put the API behind TLS and authentication.
- Add user/tenant authorization for run reads and SSE subscriptions.
- Add per-user quotas, request body limits, scenario validation limits and retention rules.
- Do not expose development actuator endpoints without an access policy.
- Monitor executor queue depth, database health, request latency, event counts and failed-run rates.
- Configure backups and test restores.
- Use resource limits for API and PostgreSQL containers.

## Shutdown and resource sizing

The API waits up to 20 seconds for executor tasks during graceful shutdown. Large scenarios may exceed this period. Since in-flight execution is not recoverable yet, use bounded scenario sizes and avoid shutting down while important runs are in progress.
