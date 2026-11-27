# Quality, coverage and security

The workflows are designed to avoid repeating the same validation stage.

## Continuous Integration — pull-request quality gate

The `Continuous Integration` workflow runs on PRs to `main` and `deploy`, and pushes to either protected branch.

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

### Fork pull-request handling

CodeQL and Semgrep run on fork-originated pull requests without repository secrets. On fork PRs, their SARIF outputs are uploaded as short-lived workflow artifacts for maintainer review; they are not uploaded to GitHub Code Scanning because the fork workflow token cannot perform that privileged write. Same-repository PRs and trusted branch pushes continue to publish Code Scanning results.

All `github/codeql-action` components (`init`, `analyze`, and `upload-sarif`) are pinned to the same immutable v4.39.3 commit. Dependabot groups the CodeQL action family so these components are proposed together rather than creating incompatible partial upgrades.

## SonarCloud Code Analysis — GitHub App

SonarCloud analysis is performed by the **SonarCloud GitHub App**, which reports the `SonarCloud Code Analysis` check on pull requests and evaluates the configured Quality Gate. This is separate from GitHub Actions and does not require a repository workflow, `SONAR_TOKEN`, `SONAR_ORGANIZATION` or `SONAR_PROJECT_KEY` secrets/variables. Keep the SonarCloud project bound to this GitHub repository and manage project/Quality Gate settings in SonarCloud.

## Maven artifact publishing

The Publish Maven artifacts workflow validates POM/version configuration on PRs without publishing. Actual publishing only runs on a published GitHub Release or manual dispatch, and deploys to GitHub Packages or optional JFrog. Tests are skipped at publish time because CI already validated them.

## Required PR checks

Require the Continuous Integration, PostgreSQL-backed API integration (CT), and Code Security checks. The `SonarCloud Code Analysis` GitHub App check can also be required now that it is reporting a successful Quality Gate on PR #68; confirm it appears consistently on all target PRs before making it a mandatory ruleset check.
