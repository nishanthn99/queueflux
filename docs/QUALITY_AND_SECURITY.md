# Quality, coverage and security

QueueFlux uses a layered code-quality pipeline.

## Continuous validation

The `CI` workflow runs on pull requests targeting `main` and pushes to `main`.

| Area | Tool | Command / output |
|---|---|---|
| Backend tests | Maven Surefire / JUnit | `mvn -B -ntp clean verify` |
| Backend coverage | JaCoCo 0.8.16 | XML and HTML under each module's `target/site/jacoco/` |
| Frontend tests | Vitest 5 | `npm test` |
| Frontend coverage | Vitest V8 provider | `web/coverage/lcov.info` and HTML report |
| Frontend quality | ESLint + TypeScript + Vite | `npm run lint`, `npm run build` |

Coverage reports are uploaded as GitHub Actions artifacts for 14 days. Coverage is reported, but no arbitrary percentage threshold is enforced yet. The current test suite is a starting baseline: the Java suite is small, and most React UI/API behaviours still need dedicated tests. Expand tests before introducing a global minimum.

Local commands:

```bash
mvn -B -ntp clean verify
cd web
npm install
npm run test:coverage
npm run lint
npm run build
```

## SonarQube Cloud

The SonarQube Cloud workflow uses SonarScanner for Maven, imports JaCoCo XML, and imports frontend LCOV coverage. The root Maven project enables `sonar.maven.scanAll` so non-JVM files under the root project can be included in the scan.

To enable analysis:

1. Sign in to [SonarQube Cloud](https://sonarcloud.io/) with GitHub.
2. Import the public `nishanthn99/queueflux` repository and create the QueueFlux project. Confirm that it qualifies for SonarQube Cloud's open-source offering.
3. Generate a project analysis token.
4. In GitHub **Settings → Secrets and variables → Actions**:
   - Add repository secret `SONAR_TOKEN`.
   - Add repository variable `SONAR_ORGANIZATION` with the organization key.
   - Add repository variable `SONAR_PROJECT_KEY` with the exact project key shown by SonarQube Cloud.

The workflow now enables analysis automatically when those three settings are present. Set the optional repository variable `SONAR_ENABLED=false` only when you deliberately want to disable SonarQube. A readiness job always runs and explains exactly why analysis is not running when configuration is missing or disabled.

**Fork pull requests are intentionally not sent to SonarQube Cloud.** GitHub does not provide repository secrets to fork-originated `pull_request` runs, so the Sonar token is unavailable. Sonar analysis runs on pushes to `main` and on pull requests from branches in this repository when configured. Do not switch this workflow to `pull_request_target` and execute pull-request code with the Sonar token; that would expose repository secrets to untrusted code.

The analysis waits for the quality-gate result and fails if the configured gate fails. Never commit a token or place it in workflow YAML or repository variables.

## GitHub CodeQL

The **Code Security** workflow analyzes:

- `java-kotlin` using Java autobuild.
- `javascript-typescript` using interpreted-language extraction.
- The `security-extended` query suite.

CodeQL now runs on fork pull requests as well as same-repository pull requests. On same-repository PRs and pushes to `main`, results are uploaded to **Security → Code scanning** and can appear as PR annotations. On fork PRs, analysis still runs with the fork's read-only token, but Code Scanning/database upload is disabled; the SARIF files are uploaded as short-lived workflow artifacts for maintainers to inspect. GitHub Actions must be approved by a maintainer first when the repository's fork-workflow approval policy requires it.

## Semgrep Community SAST

The same security workflow runs Semgrep Community Edition with its public `auto` ruleset. The CLI is pinned to 1.183.0. Semgrep scans both same-repository and fork PRs. On same-repository PRs, SARIF results are uploaded to GitHub Code Scanning. On fork PRs, the SARIF output is attached as a workflow artifact because the fork token cannot write security events.

Semgrep runs in enforcement mode: a rule match fails the security job. Review findings and false positives before deciding whether particular rules should block merging.

## Recommended required checks for main

After each workflow has completed at least once, configure the `main` ruleset to require:

- Backend tests and JaCoCo coverage
- Frontend tests, lint, build and coverage
- CodeQL analysis for Java/Kotlin
- CodeQL analysis for JavaScript/TypeScript
- Semgrep Community SAST

Add SonarQube Cloud analysis as a required check only after the Sonar project, secret and variables are configured and a successful run has completed. Fork PRs cannot run the Sonar analysis job; keep the Sonar readiness job informational rather than required.

## Security notes

The workflows use least-privilege permissions, disable persisted checkout credentials, and pin third-party actions to full commit SHAs. Fork PR workflows use GitHub's read-only token and do not receive repository secrets. No credentials are stored in the repository.
