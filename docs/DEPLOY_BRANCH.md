# QueueFlux deployment branch

The `deploy` branch is the production deployment source for the Render Blueprint. Keep deployment configuration isolated from ordinary development on `main`.

## Promotion workflow

1. Develop and validate changes on feature branches.
2. Merge reviewed changes into `main`.
3. A CODEOWNER creates or reviews the promotion PR from `main` into `deploy`.
4. Run the required Continuous Integration, Continuous Testing and Code Security checks against the promotion PR.
5. A CODEOWNER reviews the complete diff and performs the final merge into `deploy`.
6. Render deploys both API and frontend from `deploy` when Auto-Deploy is enabled.

Do not push directly to `deploy`. Do not enable auto-merge for promotion PRs.

## Deploy branch ruleset

The repository has a separate active ruleset targeting exactly `deploy`. Verify it in **Settings → Rules → Rulesets → Deploy branch protection**.

The ruleset should enforce:

- Pull requests before merging, with at least one independent approval.
- Required Code Owner review.
- Dismiss stale reviews after new pushes and require approval of the latest reviewable push.
- Resolve review conversations and require branches to be up to date.
- Require the exact checks listed below.
- Block branch deletion and force pushes.
- Restrict updates/merges to the CODEOWNERS users or team only. Do not include general contributors or bypass actors.
- Keep auto-merge disabled for `deploy`.

**Important:** Code Owner review alone does not restrict who can click Merge. The ruleset must also have an update restriction/allowed-actors rule limiting the deploy branch to CODEOWNERS. Check that this restriction is present and active before treating the policy as enforced.

### Observed settings that still need correction

The active `Deploy branch protection` ruleset currently lists the legacy required contexts `CI`, `Continuous Testing`, and `Code Security`. These no longer match the consolidated job-level checks. Replace them with the eight exact checks listed above.

The current ruleset also has no update-restriction rule. It requires Code Owner review, but that alone does not prevent a non-CODEOWNER from clicking Merge after an approval. Add the CODEOWNERS-only update restriction/allowed-actors rule in Settings and leave bypass actors empty. Also enable latest-push approval and conversation resolution.

The active `main` ruleset currently has no required status-check contexts configured; configure the current CI, CT and Code Security checks there too. These changes must be applied in GitHub Settings and are not applied by this documentation PR.

## Required promotion checks

Use the current job/check names reported by GitHub:

- `Backend tests and JaCoCo coverage`
- `Validate example scenarios against JSON Schema`
- `CLI tests`
- `Frontend tests, lint, build and coverage`
- `PostgreSQL-backed API integration tests`
- `CodeQL analysis (java-kotlin, autobuild)`
- `CodeQL analysis (javascript-typescript, none)`
- `Semgrep Community SAST`

The SonarCloud GitHub App separately reports `SonarCloud Code Analysis` and its Quality Gate. Add it as a required check only if GitHub consistently reports it on all promotion PRs.

## Render Blueprint

The root `render.yaml` configures both `queueflux-api` and `queueflux-web` to deploy from `deploy`.

- Connect the repository in Render using `deploy` as the Blueprint/source branch.
- Enable Auto-Deploy for both services (On Commit or equivalent).
- Do not commit credentials; use provider-managed environment variables.
- Verify API health at `/actuator/health` after deployment.
- Set frontend `VITE_API_URL` and backend `APP_CORS_ALLOWED_ORIGINS` to the actual production URLs.

## GitHub Actions permissions

In **Settings → Actions → General → Workflow permissions**:

- Default to read-only repository contents and packages permissions.
- Avoid broad write permissions for all workflows.
- Enable **Allow GitHub Actions to create and approve pull requests** only when needed by Release Please; do not enable workflow-generated approvals.
- Any future deployment workflow should use environment-scoped secrets, least-privilege permissions and required deployment-environment approval before production credentials are exposed.
