# Protecting the main branch

QueueFlux changes should reach `main` through pull requests. GitHub repository rulesets/branch protection must be enabled in settings to enforce this.

## Recommended ruleset

In GitHub, open **Settings → Rules → Rulesets** and configure:

| Setting | Value |
|---|---|
| Ruleset name | Protect main |
| Enforcement status | Active |
| Target branches | Include `main` only |
| Require a pull request before merging | Enabled |
| Required approvals | 1 (when another maintainer is available) |
| Dismiss stale approvals | Enabled |
| Require approval of most recent push | Enabled |
| Require Code Owner review | Enabled |
| Require status checks to pass | Enabled |
| Require branches to be up to date | Enabled |
| Require conversation resolution | Enabled |
| Restrict deletions | Enabled |
| Block force pushes | Enabled |
| Bypass list | Empty |

## Required PR checks

Require the following CI and Code Security jobs (select the exact job names GitHub reports):

- Backend tests and JaCoCo coverage
- Validate example scenarios against JSON Schema
- CLI tests
- Frontend tests, lint, build and coverage
- CodeQL analysis (java-kotlin, autobuild)
- CodeQL analysis (javascript-typescript, none)
- Semgrep Community SAST
- PostgreSQL-backed API integration tests (CT)

The former **Build Artifacts** workflow was removed because it repeated Maven verification and frontend builds already performed by CI. Its Docker image build/non-root smoke test and artifact uploads now run within CI.

SonarQube Cloud is optional and should only be required after it is enabled and reports a reliable status.

## Deploy branch ruleset

Use a separate active ruleset targeting exactly `deploy`. Require PRs, one independent approval, stale-review dismissal, latest-push approval, Code Owner approval, resolved conversations, up-to-date branches, deletion protection and force-push blocking.

Require the same CI, Code Security and PostgreSQL-backed CT checks above. CT runs on PRs to main/deploy, its daily schedule, and manual dispatch; it is not triggered by branch pushes.

## Pull-request workflow

1. Create a short-lived feature branch from current `main`.
2. Open a PR targeting `main`.
3. Wait for all required CI, CT and Code Security checks to pass.
4. Obtain independent approval, resolve review conversations and update the branch if required.
5. Merge using the repository's allowed merge strategy.

## Workflow security

CI, Code Security and CT use read-only repository permissions where applicable, disable persisted checkout credentials, and pin third-party actions to full commit SHAs. Dependabot checks GitHub Actions, npm and Maven dependencies weekly.

See [Continuous Testing](CONTINUOUS_TESTING.md) and [Quality and Security](QUALITY_AND_SECURITY.md).
