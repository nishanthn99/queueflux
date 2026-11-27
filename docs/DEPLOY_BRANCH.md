# QueueFlux deployment branch and Render promotion

## Branch responsibilities

QueueFlux uses two distinct branches for development and deployment:

- `main` is the development/integration branch and the source of truth for the root `render.yaml`. Configure the Render Blueprint to read its definition from `main`.
- `deploy` is the protected application-code branch used by the Render API and frontend services. Each service in `render.yaml` explicitly sets `branch: deploy`.

The Render Blueprint branch and a service's `branch` field are different settings. The first selects the Git revision from which Render reads `render.yaml`; the service-level field selects the branch Render builds for that service. This repository intentionally uses `main` for infrastructure configuration and `deploy` for application code.

A merge into `main` therefore does **not** deploy the changed application code by itself. The code must also be promoted to `deploy`.

## Promotion workflow

1. Develop and test changes on feature branches.
2. Merge reviewed feature PRs into `main` after the required CI, integration, and security checks pass.
3. Open a promotion PR with `main` as the head and `deploy` as the base.
4. Review the full promotion diff. The `deploy` branch has its own deployment/workflow commits and can diverge from `main`; do not assume the PR is a trivial fast-forward.
5. Resolve any conflicts in the promotion PR, preserving the current application code and the deploy-specific workflow triggers. Do not force-reset or delete/recreate the protected `deploy` branch to make the comparison look clean.
6. Require the checks below and an independent CODEOWNER review, then merge the promotion PR.
7. Confirm that both Render services have deployed the promoted commit and verify the API health endpoint and a real frontend-to-API simulation.

Do not push directly to `deploy`. Do not enable auto-merge for production promotion PRs. If the promotion branch is behind or divergent, reconcile it through a reviewed PR before expecting the latest `main` code to be hosted.

## GitHub ruleset audit

The repository has active rulesets for both `main` and `deploy`. The settings below were read from GitHub while this guide was refreshed; they are not changed by this code PR.

### Deploy branch

The active `Deploy branch protection` ruleset targets exactly `refs/heads/deploy`. It currently has:

- Pull requests required, one approval, stale approvals dismissed, and CODEOWNER review required.
- Required status contexts still set to the old `CI`, `Continuous Testing`, and `Code Security` names.
- Latest-push approval disabled and review-thread resolution not required.
- No update-restriction rule; a CODEOWNER review requirement is not the same as an explicit restriction on who may update the branch.
- No bypass actors configured.

Replace the old status contexts with the current job checks listed below. Enable latest-push approval and review-thread resolution. Configure and verify an appropriate update restriction for the protected branch, and keep bypass actors empty.

### Main branch

The active `queueflux-main-protection` ruleset currently requires a pull request, one approval, CODEOWNER review, and dismissal of stale approvals. It has no required status-check contexts configured. Latest-push approval and review-thread resolution are also disabled. Configure the current checks below and enable those review safeguards.

The repository-wide `.github/CODEOWNERS` file names `@nishanthn99`, `@jeevith777`, and `@Smriddhi-jain`. Keep the rulesets aligned with that ownership file. These settings must be changed in **Settings → Rules → Rulesets**; this PR only documents the observed state.

### Required checks

Select the exact check-run names GitHub reports for the current workflows:

- `Backend tests and JaCoCo coverage`
- `Validate example scenarios against JSON Schema`
- `CLI tests`
- `Frontend tests, lint, build and coverage`
- `PostgreSQL-backed API integration tests`
- `CodeQL analysis (java-kotlin, autobuild)`
- `CodeQL analysis (javascript-typescript, none)`
- `Semgrep Community SAST`

SonarCloud reports separately through the `SonarCloud Code Analysis` GitHub App check and Quality Gate. Add it as a required check only if it is consistently present on all relevant PRs.

## Render Blueprint configuration

### Blueprint and branch selection

1. Connect `nishanthn99/queueflux` to Render as a Blueprint and select `main` as the Blueprint branch.
2. Use the root `render.yaml`.
3. Confirm that both `queueflux-api` and `queueflux-web` show `deploy` as their service source branch.
4. Keep Auto-Deploy enabled for the two services after the Blueprint configuration has been reviewed and applied.

A merge to GitHub does not necessarily apply a changed Blueprint to already-created Render resources. Sync the Blueprint after this PR is merged, review the proposed service branch changes, and approve the sync in Render. Verify the API and frontend service settings afterward. The existing services may continue to display the old branch until this sync is applied.

### API service

The API uses the root Docker build context and `backend/server/Dockerfile`. The Dockerfile builds the Maven reactor with Java 21, then runs the executable JAR as the unprivileged `10001:10001` user. The service health check is `/actuator/health`.

The Blueprint maps Render Postgres properties to `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, and `DB_PASSWORD`. These match the fallbacks in `backend/server/src/main/resources/application.yml`; an explicit `DB_URL` can override the composed JDBC URL. Spring uses Render's injected `PORT` with `8080` as the local fallback.

`APP_CORS_ALLOWED_ORIGINS` must contain the exact public frontend origin. The Blueprint's default is `https://queueflux-web.onrender.com`; update it if the service URL or custom domain changes. Do not put passwords or tokens in the YAML file.

### Frontend service

The static site installs the locked dependencies with `npm ci`, runs `npm run build` from `web/`, and publishes `web/dist`. Its `VITE_API_URL` must point at the public API URL. Verify a simulation from the hosted UI after both services deploy.

### Database and compatibility

The Blueprint selects PostgreSQL 18 in Singapore. Docker Compose and the PostgreSQL-backed Continuous Testing workflow use the same major version so local and automated integration tests exercise the deployed database major version.

The configured Render Free Postgres plan is temporary and expires after 30 days. It is suitable only for a short-lived demo; export or migrate required run data before expiry. Do not treat a free database as durable production storage. Render Postgres major-version changes are immutable for an existing database and may require a replacement/migration, so review any version change as a data migration rather than a harmless YAML edit.

## GitHub Actions permissions

In **Settings → Actions → General → Workflow permissions**:

- Default to read-only repository contents and packages permissions.
- Avoid broad write permissions for all workflows.
- Enable **Allow GitHub Actions to create and approve pull requests** only when required by Release Please; do not enable workflow-generated approvals.
- Any future production deployment workflow should use environment-scoped secrets, least-privilege permissions, and required deployment-environment approval before production credentials are exposed.
