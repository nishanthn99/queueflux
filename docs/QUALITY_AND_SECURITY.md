# Quality, coverage and security

The workflows are designed to avoid repeating the same validation stage.

## CI — pull-request quality gate

The `CI` workflow runs on PRs to `main` and `deploy`, and pushes to either protected branch.

| Area | Tool | Command / output |
|---|---|---|
| Backend tests | Maven Surefire / JUnit | `mvn -B -ntp clean verify` |
| Backend coverage | JaCoCo | XML/HTML under module `target/site/jacoco/` |
| API image | Docker build | Build image and verify it runs as UID/GID 10001 |
| Scenario schema | AJV CLI | Validate examples against schema v1 |
| CLI tests | Node test runner | `npm ci` + `npm test` in `cli` |
| Frontend tests | Vitest | `npm run test:coverage` |
| Frontend coverage | Vitest V8 | `web/coverage/` |
| Frontend quality | ESLint + TypeScript + Vite | `npm run lint`, `npm run build` |

CI uploads coverage, Maven test reports, backend JARs and frontend build output as artifacts for 14 days. Build Artifacts was removed because it duplicated Maven verify and frontend build; Docker validation and artifact uploads were consolidated into CI.

## Continuous Testing — system integration regression

CT runs on PRs to `main`/`deploy`, daily at 02:23 UTC and manual dispatch (not on pushes). It builds the backend without running/compiling the CI-owned tests, starts the API against a disposable PostgreSQL service, then exercises the assembled application:

- Actuator health and database connectivity
- Synchronous simulation API and key result fields
- Multi-replication comparison API and distinct seeds
- Async run submission, completion, persisted result and idempotency-key reuse
- Unknown run ID returns HTTP 404

CT is system/API integration testing; it does not duplicate unit tests, coverage, lint/build, CLI or schema validation. See [CONTINUOUS_TESTING.md](CONTINUOUS_TESTING.md).

## Code Security

Code Security runs on PRs/pushes to main/deploy and weekly. It performs:

- CodeQL security-extended analysis for Java and JavaScript/TypeScript.
- Semgrep Community scan using the auto ruleset.
- SARIF upload to GitHub code scanning (when permitted).

## SonarQube Cloud

The optional SonarQube Cloud workflow runs on PRs/pushes to main/deploy, weekly and manual dispatch. A configuration-status job explains when it is disabled. The actual analysis is skipped until `SONAR_ENABLED=true` and the token/project settings are present.

To enable:

1. Import `nishanthn99/queueflux` into SonarQube Cloud and create the project.
2. Generate an analysis token.
3. In GitHub Settings → Secrets and variables → Actions, set secret `SONAR_TOKEN` and variables `SONAR_ENABLED=true`, `SONAR_ORGANIZATION`, and `SONAR_PROJECT_KEY`.
4. Run the workflow and verify the quality gate.

Sonar currently runs its own tests/coverage generation because its scanner requires analysis coverage inputs; it is a dedicated analysis workflow, not a replacement for CI.

## Maven artifact publishing

The Publish Maven artifacts workflow validates POM/version configuration on PRs without publishing. Actual publishing only runs on a published GitHub Release or manual dispatch, and deploys to GitHub Packages or optional JFrog. Tests are skipped at publish time because CI already validated them.

## Required PR checks

Require CI, the PostgreSQL-backed API integration test job, and Code Security. Add Sonar only after it is enabled and reliable.
