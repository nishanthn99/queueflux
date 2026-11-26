# QueueFlux deployment branch

The `deploy` branch is the deployment source for the Render Blueprint. Keep production deployment changes isolated from normal development on `main`.

## Branch flow

1. Develop and review changes on feature branches.
2. Merge tested changes into `main`.
3. Open a pull request from `main` into `deploy` to promote a release to deployment.
4. Wait for required checks, review the diff, and merge into `deploy`.
5. Render auto-deploys the API and frontend from `deploy` (if auto-deploy is enabled in Render).

Do not push directly to `deploy` except for emergency recovery by an administrator.

## GitHub branch protection / ruleset for `deploy`

Create a branch ruleset or branch protection rule targeting the exact branch name `deploy`:

- Require a pull request before merging.
- Require at least **1 approval** from a reviewer other than the PR author.
- Dismiss stale approvals when new commits are pushed.
- Require approval of the latest reviewable push.
- Require these status checks (select the exact names shown by GitHub after the workflows run):
  - Backend tests and JaCoCo coverage (CI)
  - Validate example scenarios against JSON Schema (CI)
  - CLI tests (CI)
  - Frontend tests, lint, build and coverage (CI)
  - Backend tests (Continuous Testing)
  - Frontend lint and production build (Continuous Testing)
  - CodeQL analysis (Java and JavaScript/TypeScript)
  - Semgrep Community SAST
- Optionally require branches to be up to date before merging.
- Block force pushes and branch deletion.
- Restrict who can push to the branch; allow maintainers/admins only. Routine changes must go through PRs.
- Do not allow bypassing rules except for documented emergencies.
- Auto-merge is optional; if enabled, only after approvals and required checks succeed.

### Permissions limitation

The GitHub connector can create/update branches and files, but it does not have repository-administration permission to create branch-protection rules or change repository Actions permissions. Apply these settings manually in **Settings → Rules → Rulesets** (recommended) or **Settings → Branches → Branch protection rules**. Existing main protection is not changed.

## Render Blueprint

The root `render.yaml` configures both `queueflux-api` and `queueflux-web` to deploy from `deploy`.

- Connect the repository in Render using the `deploy` branch as the Blueprint/source branch.
- Enable Auto-Deploy for both services (On Commit or equivalent).
- Do not commit credentials. Use provider-managed environment variables.
- Verify API health at `/actuator/health` after deployment.
- Set frontend `VITE_API_URL` and backend `APP_CORS_ALLOWED_ORIGINS` to actual production URLs.

## GitHub Actions permissions

In **Settings → Actions → General → Workflow permissions**:

- Default to **Read repository contents and packages permissions**.
- Avoid broad write permissions for all workflows.
- Enable **Allow GitHub Actions to create and approve pull requests** only if Release Please needs to open release PRs. Do not enable workflow-generated approvals.
- Any future deployment workflow should use environment-scoped secrets and least-privilege permissions, and require deployment environment approval before production credentials are exposed.
