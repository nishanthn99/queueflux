# Quality, coverage and security

QueueFlux has separate workflows with non-overlapping responsibilities.

## CI — pull-request quality gate

The `CI` workflow runs on PRs targeting `main` and pushes to `main` (and configured validation branches).

| Area | Tool | Command / output |
|---|---|---|
| Backend tests | Maven Surefire / JUnit | `mvn -B -ntp clean verify` |
| Backend coverage | JaCoCo 0.8.16 | XML/HTML under each module's `target/site/jacoco/` |
| Scenario schema | AJV CLI | Validate example JSON against schema v1 |
| CLI tests | Node test runner | `npm test` in `cli` |
| Frontend tests | Vitest 5 | `npm run test:coverage` |
| Frontend coverage | Vitest V8 | `web/coverage/lcov.info` and HTML |
| Frontend quality | ESLint + TypeScript + Vite | `npm run lint`, `npm run build` |

Coverage artifacts are uploaded for 14 days. Coverage is reported but no arbitrary percentage threshold is enforced yet.

Local commands:

```bash
mvn -B -ntp clean verify
cd cli && npm test
cd ../web
npm install
npm run test:coverage
npm run lint
npm run build
```

## Continuous Testing — scheduled end-to-end validation

CT runs on PRs targeting main/deploy, daily and through manual dispatch (not on branch pushes). It checks the assembled system against a real PostgreSQL service in a disposable GitHub Actions environment.

It builds the backend artifact without rerunning unit tests, starts the API, then tests:
- Health and database connectivity
- Synchronous simulation endpoint
- Replicated comparison endpoint
- Async simulation persistence, completion and idempotency
- Unknown run ID handling (404)

These are API/system integration checks, not CI unit tests, lint/build, CLI or schema checks. See [CONTINUOUS_TESTING.md](CONTINUOUS_TESTING.md).

## Code Security

The **Code Security** workflow analyzes:

- `java-kotlin` using Java autobuild.
- `javascript-typescript` using interpreted-language extraction.
- CodeQL `security-extended` query suite.

It also runs Semgrep Community Edition with the `auto` ruleset. The Semgrep CLI is pinned and SARIF results are uploaded to GitHub code scanning where permissions allow.

## SonarQube Cloud

The optional SonarQube Cloud workflow uses SonarScanner for Maven, imports JaCoCo XML and frontend LCOV coverage. It is skipped until `SONAR_ENABLED=true` and required project variables/token are configured.

To enable:

1. Import `nishanthn99/queueflux` into SonarQube Cloud and create the project.
2. Generate an analysis token.
3. In GitHub Settings → Secrets and variables → Actions, set secret `SONAR_TOKEN` and variables `SONAR_ENABLED=true`, `SONAR_ORGANIZATION`, and `SONAR_PROJECT_KEY`.
4. Run the workflow and verify the quality gate.

Never commit the token.

## PR required checks

Require CI jobs, the unique **PostgreSQL-backed API integration tests** CT job, and Code Security jobs as listed in [BRANCH_PROTECTION.md](BRANCH_PROTECTION.md). Add Sonar analysis only after it is enabled and reliably reports a result.
