# QueueFlux Continuous Testing

**Continuous Testing (CT) does not run on branch pushes.** It runs on PRs targeting main/deploy, daily, and by manual dispatch. CI owns unit tests, coverage, frontend tests/lint/build, CLI tests, and scenario-schema validation; CT owns system-level API integration.

CT runs daily at 02:23 UTC and can be started manually. It packages the backend while skipping the CI-owned unit tests, starts the API against a disposable PostgreSQL service, and exercises the system end to end.

CT checks:
- Spring Boot startup, Actuator health and database connectivity.
- Synchronous simulation API response and result fields.
- Multi-replication comparison API and distinct seeds.
- Asynchronous simulation submission, persisted status/result, and idempotency-key reuse.
- Unknown run ID returns HTTP 404.

CT is a separate system-level regression gate and should be required for PRs to main/deploy alongside CI and Code Security. It does not duplicate CI unit tests, coverage, lint/build, CLI or schema checks.

The integration script is `.github/scripts/continuous-testing-api.mjs` and uses only Node.js built-in modules.
