# Artifact publishing and free hosting

This guide separates two responsibilities:

- An **artifact repository** stores versioned Maven JARs and POMs for reuse by other projects.
- An **application host** runs the Spring Boot API and serves the React frontend to users.

QueueFlux is configured to use GitHub Packages by default for public Maven artifacts. The Maven publishing workflow also supports a JFrog Artifactory Maven repository when you provide your own endpoint and credentials.

## Publish QueueFlux Maven artifacts

The root POM defines GitHub Packages as the default Maven deployment repository:

`https://maven.pkg.github.com/nishanthn99/queueflux`

The release workflow publishes the parent POM and Maven modules:

- `io.queueflux:queueflux-parent`
- `io.queueflux:queue-model`
- `io.queueflux:simulation-engine`
- `io.queueflux:simulation-profiles`
- `io.queueflux:server`

### GitHub Packages (recommended zero-subscription option)

1. Create a GitHub Release from a tag such as `v0.1.0`. The workflow validates the version and updates the Maven reactor POMs for that release build, then publishes with `mvn deploy -DskipTests`. CI validates the code before the release is created.
2. Alternatively, run **Actions → Publish Maven artifacts → Run workflow**, supply a version such as `0.1.0`, and choose `github`.
3. The workflow uses the short-lived `GITHUB_TOKEN` with `packages: write`; no personal access token is required.
4. The published package versions appear under the repository's **Packages** section.

GitHub Packages usage is free for public packages. Keep the package public if you want to use that free public-package model.

To consume a module from another Maven project, add the repository:

```xml
<repositories>
  <repository>
    <id>queueflux-github</id>
    <url>https://maven.pkg.github.com/nishanthn99/queueflux</url>
  </repository>
</repositories>
```

Then add the dependency, for example:

```xml
<dependency>
  <groupId>io.queueflux</groupId>
  <artifactId>simulation-engine</artifactId>
  <version>0.1.0</version>
</dependency>
```

The parent POM is part of the published reactor and must be resolvable when Maven reads a module POM. If your consuming Maven client prompts for GitHub Packages credentials, create a narrowly scoped read token and place it in your local `~/.m2/settings.xml`; never commit that token. For a public repository/package, check GitHub's current anonymous-download support before deciding whether consumer credentials are needed.

### Optional JFrog Artifactory

JFrog Artifactory OSS is available as a self-managed Maven repository. A hosted JFrog cloud subscription is not the same as the self-managed OSS edition. Running OSS yourself still requires a machine, storage, database/runtime resources, maintenance and public network exposure if CI must publish remotely.

To publish to an Artifactory Maven-local repository:

1. Install JFrog Artifactory OSS on a server or development machine and create a Maven local repository, for example `maven-local`.
2. Configure the CI repository variables:
   - `MAVEN_REGISTRY` = `jfrog`
   - `JFROG_MAVEN_REPO_URL` = the full deployment endpoint, for example `https://artifacts.example.com/artifactory/maven-local`
3. Configure GitHub Actions repository secrets:
   - `JFROG_USERNAME`
   - `JFROG_PASSWORD` (prefer an access/identity token instead of an account password).
4. Publish a GitHub Release or run the **Publish Maven artifacts** workflow manually and choose `jfrog`.

The workflow uses Maven's alternate deployment repository setting with server ID `jfrog`. Do not store credentials in the POM, workflow YAML, or repository variables.

## Host the application for free (hobby/demo deployment)

A practical zero-subscription combination for a low-traffic demo is:

| Component | Provider | Role |
|---|---|---|
| React + Vite frontend | Cloudflare Pages | Static web hosting/CDN |
| Spring Boot API | Render Free Web Service | Docker-hosted Java API |
| PostgreSQL | Neon Free | Managed PostgreSQL database |

Free-tier allowances and eligibility can change. This setup is suitable for a demo/hobby app, not an uptime guarantee or production workload.

### 1. Create the Neon PostgreSQL database

1. Create a Neon account and a project on the Free plan.
2. Create or select the QueueFlux database and copy the pooled connection host, database, username and password.
3. Build the JDBC URL in this form:

```text
jdbc:postgresql://<neon-host>/<database>?sslmode=require
```

Use the exact hostname, database name, username and password supplied by Neon. Keep the connection details private. The free plan currently lists 1 GB storage and 100 compute-hours per project/month; compute scales to zero after inactivity.

### 2. Deploy the API on Render

The repository includes `render.yaml` with a Docker web service definition pointing to `backend/server/Dockerfile`, a health check at `/actuator/health`, and free-plan JVM memory settings.

1. Sign in to Render and choose **New → Blueprint**.
2. Connect `nishanthn99/queueflux` and select the branch containing the merged deployment configuration (normally `main`).
3. During initial Blueprint setup, provide:
   - `DB_URL`: the Neon JDBC URL above.
   - `DB_USERNAME`: Neon database username.
   - `DB_PASSWORD`: Neon password.
   - `APP_CORS_ALLOWED_ORIGINS`: your future Cloudflare Pages production origin, e.g. `https://queueflux.pages.dev`.
4. Deploy the `queueflux-api` service. Note the generated API URL, such as `https://queueflux-api.onrender.com`.
5. Verify `https://<your-render-host>/actuator/health` returns a healthy response.

The Render free service has 512 MB RAM and spins down after 15 minutes without inbound traffic. The first request after idle can take around a minute while it starts. Its local filesystem is ephemeral, so PostgreSQL must remain external; do not store run data on the container filesystem. The JVM options in `render.yaml` constrain memory, but actual startup and simulation load must be tested on the free instance.

### 3. Deploy the frontend on Cloudflare Pages

1. In Cloudflare, open **Workers & Pages → Create → Pages → Connect to Git**.
2. Select `nishanthn99/queueflux` and the branch deployed above.
3. Configure:
   - Root directory: `web`
   - Build command: `npm install && npm run build`
   - Build output directory: `dist`
   - Environment variable `VITE_API_URL`: the Render API URL from step 2, e.g. `https://queueflux-api.onrender.com`
4. Deploy and copy the production Pages URL.
5. In Render, set `APP_CORS_ALLOWED_ORIGINS` to the exact Pages origin (including `https://`, without a trailing slash) and redeploy the API if you did not already set it.
6. Test a simulation from the deployed frontend.

If you chose the Cloudflare Pages project name `queueflux`, the production origin is usually `https://queueflux.pages.dev`; always use the actual URL displayed in the dashboard.

### 4. Cost and reliability safeguards

- Cloudflare Pages Free currently allows up to 500 builds/month and 20,000 files per site.
- Render Free web services have idle spin-down, ephemeral filesystems and monthly usage limits. A free Render Postgres database expires after 30 days, which is why this guide uses Neon instead.
- Neon Free currently includes 1 GB storage and 100 compute-hours per project/month, plus a 5 GB/month public network transfer allowance.
- Keep provider billing pages and usage alerts enabled. Avoid upgrading resources or enabling paid add-ons. If a provider requires a payment method, set a restrictive budget/alert before deploying.
- If a free quota is exceeded, the provider may suspend, throttle or bill according to its current terms. Do not promise $0 under unlimited traffic.
- Render cold starts and Neon scale-to-zero can make the first request slow. This is an expected free-tier trade-off.

For a stable always-on public service, expect to need paid compute and a managed database plan.

## Deployment limitations

The repository contains the configuration and instructions, but the actual provider resources are not created automatically by GitHub Actions. The owner must authorize Cloudflare, Render and Neon, create the accounts/resources, set secrets and environment variables, and verify the first live deployment. No provider API keys or database credentials should be committed to Git.
