# QueueFlux Continuous Testing

**Continuous Testing (CT) does not run on pull requests or pushes.** CI owns PR merge-gating checks: unit tests, coverage, frontend tests/lint/build, CLI tests, and scenario-schema validation.

CT runs daily at 02:23 UTC and can be started manually. It packages the backend while skipping the CI-owned unit tests, starts the API against a disposable PostgreSQL service, and exercises the system end to end.

CT checks:
- Spring Boot startup, Actuator health and database connectivity.
- Synchronous simulation API response and result fields.
- Multi-replication comparison API and distinct seeds.
- Asynchronous simulation submission, persisted status/result, and idempotency-key reuse.
- Unknown run ID returns HTTP 404.

CT is an extended scheduled/manual regression suite, **not a required PR status check**. Do not add its job to branch-protection required checks because it does not run on PRs. Keep CI and Code Security as PR merge gates.

The integration script is `.github/scripts/continuous-testing-api.mjs` and uses only Node.js built-in modules.
