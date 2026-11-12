# QueueFlux

**Deterministic what-if experiments for asynchronous workloads.**

QueueFlux is an open-source, discrete-event simulation platform for studying how background-job queues behave under workload pressure. Configure arrival patterns, service times, worker capacity, priorities, rate limits, retries, failures, and planned worker outages. Run reproducible experiments in virtual time and inspect throughput, waiting time, tail latency, backlog, retries, dead-letter outcomes, and utilization.

> **Project status:** Active early development (0.1.0-SNAPSHOT). QueueFlux now provides a multi-queue simulation baseline, asynchronous PostgreSQL-backed runs, SSE progress, and replicated stochastic comparisons. It is an experimentation model, not a production queue or an exact broker emulator.

## Highlights

- **Virtual-time engine:** advances from event to event; it does not sleep or execute simulated jobs on real threads.
- **Reproducibility:** deterministic event ordering and named random streams derived from the scenario seed.
- **Queue policies:** FIFO or workload-priority scheduling, bounded waiting queues, and per-queue token-bucket rate limiting.
- **Failure experiments:** configurable per-attempt failure probability, exponential backoff with deterministic jitter, exhausted-job dead-letter outcomes, and planned worker-capacity outages.
- **Multiple queues:** independent queue/worker-pool pairs in one scenario.
- **Experiment runs:** synchronous API, durable asynchronous runs, PostgreSQL persistence, run-status polling, and Server-Sent Events progress.
- **Stochastic comparisons:** run multiple seeded replications and compare mean and standard deviation for key metrics.
- **Web workspace:** React + TypeScript UI with a form for common inputs and an advanced JSON scenario editor.

## Architecture

```text
React + TypeScript
       |
       | REST / JSON, SSE progress
       v
Spring Boot API ------ PostgreSQL (run records and JSON payloads)
       |
       +---- synchronous simulation
       |
       +---- bounded async executor
                    |
                    v
             SimulationEngine
                    |
       +------------+-------------+
       |            |             |
   VirtualClock  EventScheduler  Seeded RNG
       |            |             |
       +------ QueueRuntime ------+
                    |
            Metrics + Event Trace
```

The Maven backend is split into four modules:

| Module | Responsibility |
|---|---|
| queue-model | Immutable scenario, workload, retry, rate-limit, and outage definitions |
| simulation-engine | Pure Java discrete-event engine, virtual clock, deterministic random streams, event scheduler, metrics |
| simulation-profiles | Generic worker-queue profile and explicitly limited BullMQ-inspired profile |
| server | Spring Boot REST/SSE endpoints, asynchronous run coordinator, PostgreSQL persistence |

The frontend lives in web/. Detailed design and semantics are in [the whole-project guide](docs/PROJECT_GUIDE.md).

## Run with Docker Compose

Requirements: Docker Engine or Docker Desktop with Compose v2.

```bash
git clone https://github.com/nishanthn99/queueflux.git
cd queueflux
docker compose up --build
```

Open the UI at http://localhost:3000. The API listens on http://localhost:8080, and PostgreSQL is available on port 5432.

The Compose setup creates a named volume, queueflux-postgres, for run persistence. Stopping containers does not delete this volume:

```bash
docker compose down          # stop/remove containers; keep database volume
docker compose up -d         # start again with saved runs
docker compose down -v       # destructive: also removes persisted PostgreSQL data
```

Default database credentials are for local development only. Override them before exposing the stack to a network.

## Run locally without Docker

Requirements: Java 21+, Maven 3.9+, Node.js 22+, npm 10+, PostgreSQL 17+.

1. Create a PostgreSQL database named queueflux and a user/password matching your environment.
2. Set DB_URL, DB_USERNAME, and DB_PASSWORD.
3. Start the API:

   ```bash
   mvn -pl backend/server -am spring-boot:run
   ```

4. Start the UI in a separate terminal:

   ```bash
   cd web
   npm install
   npm run dev
   ```

The Vite UI runs on port 5173. The API CORS configuration permits localhost development origins.

## First experiment

The full example is examples/constant-load/scenario.json. For a quick API call, submit it to the synchronous endpoint:

```bash
curl -sS http://localhost:8080/api/v1/simulations/run \
  -H 'Content-Type: application/json' \
  --data-binary @examples/constant-load/scenario.json
```

For longer experiments, use the asynchronous endpoint:

```bash
curl -sS http://localhost:8080/api/v1/simulations/runs \
  -H 'Content-Type: application/json' \
  --data-binary @examples/constant-load/scenario.json
```

The response contains a run ID and status/events URLs. See docs/API.md for the full API.

## Documentation

- [Whole-project guide](docs/PROJECT_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Scenario JSON format](docs/SCENARIO_FORMAT.md)
- [Simulation event model and determinism](docs/SIMULATION_MODEL.md)
- [Metrics and interpretation](docs/METRICS.md)
- [REST and SSE API](docs/API.md)
- [BullMQ-inspired profile: scope and differences](docs/BULLMQ_PROFILE.md)
- [Operations, persistence, backup and safety](docs/OPERATIONS.md)
- [Roadmap and implementation status](docs/ROADMAP.md)
- [Architecture decisions](docs/decisions/)

## Development and tests

```bash
mvn -B test
cd web && npm install && npm run build
```

GitHub Actions runs Maven verification with JaCoCo coverage, frontend tests with Vitest/V8 coverage, linting and production builds. Separate workflows run CodeQL (Java and TypeScript), Semgrep Community SAST, optional SonarQube Cloud analysis, and versioned Maven artifact publishing. See [quality and security](docs/QUALITY_AND_SECURITY.md) and [artifact publishing and free hosting](docs/ARTIFACTS_AND_FREE_HOSTING.md).

## Publish Maven artifacts

Create a GitHub Release (for example `v0.1.0`) to publish the Maven modules to GitHub Packages, or run the **Publish Maven artifacts** workflow manually. See [artifact publishing and free hosting](docs/ARTIFACTS_AND_FREE_HOSTING.md) for GitHub Packages, optional JFrog Artifactory, and consumer setup.

## Host QueueFlux for free

The repository includes a Render Blueprint for the Spring Boot API. Deploy the Vite frontend to Cloudflare Pages and use Neon for a free PostgreSQL project. Follow [the deployment guide](docs/ARTIFACTS_AND_FREE_HOSTING.md); provider accounts and secrets must be configured by the repository owner.

## Current boundaries

QueueFlux is a simulation platform. It does not connect to Redis, run BullMQ jobs, run user-supplied code, or guarantee that model results match a real production broker. Worker outages reduce capacity for new dispatches; jobs already running are allowed to complete. PostgreSQL stores run records and JSON snapshots, while the engine remains in-memory and stateless between runs.

See the roadmap for implemented features and intentionally deferred work.

## Community

Join the [QueueFlux Discord community](https://discord.gg/RGRM8g75T) to discuss development, ask questions, share ideas, and coordinate contributions.

## Contributing and license

Read CONTRIBUTING.md before opening a pull request. QueueFlux is distributed under the Apache License 2.0 (LICENSE).
