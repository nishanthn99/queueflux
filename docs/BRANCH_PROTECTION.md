# Protecting the main branch

QueueFlux changes should reach `main` through pull requests. A GitHub repository ruleset/branch protection rule must be enabled in repository settings for GitHub to reject direct pushes.

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

Require these **CI and Code Security** jobs (select the exact job names shown by GitHub):

- Backend tests and JaCoCo coverage
- Validate example scenarios against JSON Schema
- CLI tests
- Frontend tests, lint, build and coverage
- CodeQL analysis (java-kotlin, autobuild)
- CodeQL analysis (javascript-typescript, none)
- Semgrep Community SAST

Do not require Continuous Testing: CT is a scheduled/manual end-to-end suite and does not run on pull requests. Do not require SonarCloud until its project and repository secret/variables are configured and analysis is enabled.

## Pull-request workflow

1. Create a short-lived feature branch from current `main`.
2. Commit to that branch and open a PR targeting `main`.
3. Wait for required CI and Code Security checks to pass.
4. Obtain an independent approval, resolve review conversations and update the branch if required.
5. Merge using the repository's allowed merge strategy.

## Workflow security

CI, Code Security and CT use read-only repository permissions where applicable, disable persisted checkout credentials, and pin third-party actions to full commit SHAs. Dependabot checks GitHub Actions, npm and Maven dependencies weekly.

See [Continuous Testing](CONTINUOUS_TESTING.md) for the separate scheduled integration suite and [Quality and Security](QUALITY_AND_SECURITY.md) for details.
