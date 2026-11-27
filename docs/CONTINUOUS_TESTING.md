# QueueFlux Continuous Testing

CT runs on PRs targeting main/deploy, daily at 02:23 UTC and by manual dispatch (not on branch pushes). CI owns unit tests, coverage, frontend tests/lint/build, CLI tests, schema validation and Docker build smoke checks; CT owns system-level API integration.

CT packages the backend with tests skipped, starts the API against a disposable PostgreSQL service, and exercises:
- Spring Boot health and PostgreSQL connectivity
- Synchronous simulation API response and result fields
- Multi-replication comparison API and distinct seeds
- Async simulation submission, persisted completion/result and idempotency-key reuse
- Unknown run ID returns HTTP 404

CT is a separate integration gate and should be required for PRs to main/deploy alongside CI and Code Security. It does not repeat CI unit tests, coverage, lint/build, CLI/schema checks, or Docker image validation.

The integration script is `.github/scripts/continuous-testing-api.mjs` and uses Node.js built-ins only.
