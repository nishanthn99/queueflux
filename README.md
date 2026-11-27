# QueueFlux

**Deterministic what-if experiments for asynchronous workloads.**

QueueFlux is an open-source, discrete-event simulation platform for studying how background-job queues behave under different workload and worker conditions.

It lets you model arrival patterns, service times, worker capacity, priorities, rate limits, failures, retries, backoff, dead-letter outcomes, and planned worker outages. Experiments run in virtual time and produce reproducible metrics such as throughput, queue wait time, tail latency, backlog, retries, dead letters, and worker utilization.

> **Project status:** Early development (0.x). QueueFlux is an experimentation and analysis platform, not a production queue broker, job runner, load generator, or exact emulator of a specific queue technology.

## Why QueueFlux?

Testing queue behaviour directly in production or against a real broker can be expensive, disruptive, and difficult to reproduce.

QueueFlux provides a controlled environment for **what-if experimentation**:

- What happens when arrival rate exceeds worker capacity?
- How does slower or more variable service time affect P95/P99 latency?
- What happens when workers experience planned outages?
- How do retries and exponential backoff affect backlog?
- How does a rate limit change throughput?
- How sensitive are results to different random realizations?
- How do two workload configurations compare under repeated seeded experiments?

The goal is to make these questions measurable and repeatable without requiring a production workload.

## Key Features

- **Discrete-event simulation:** the engine advances virtual time from event to event instead of sleeping or executing simulated jobs on real worker threads.
- **Deterministic execution:** event ordering and named random streams are derived from the scenario seed so equivalent runs can be reproduced.
- **Multiple arrival models:** constant and Poisson arrivals.
- **Service-time models:** constant, exponential, and log-normal distributions.
- **Queue policies:** FIFO and workload-level priority scheduling.
- **Bounded queues:** configurable waiting-depth admission limits.
- **Rate limiting:** per-queue global token-bucket job-start limits.
- **Failure and retry modelling:** configurable failure probability, bounded retries, exponential backoff, maximum backoff, and deterministic retry jitter.
- **Dead-letter outcomes:** exhausted attempts and retry re-admission overflow are represented explicitly.
- **Worker outages:** planned outages reduce capacity for new dispatches while already-running jobs continue.
- **Multiple queues and worker pools:** independent queue/worker-pool pairs can be modelled in one scenario.
- **Metrics:** throughput, queue wait, end-to-end latency, P95/P99 latency, backlog, worker utilization, failures, retries, dead letters, rejections, and end-of-run states.
- **Bounded event trace:** trace collection is separate from the simulation's metric calculations.
- **Synchronous and asynchronous APIs:** run experiments directly or persist longer-running experiments in PostgreSQL.
- **Progress streaming:** asynchronous runs expose status and Server-Sent Events progress.
- **Seeded replications:** run multiple stochastic replications and compare mean and standard deviation for key metrics.
- **Web workspace:** React + TypeScript UI for configuring and running experiments.
- **CLI:** `qf validate` and `qf run` commands for scenario-as-code workflows.
- **Docker Compose:** local development with the API, frontend, and PostgreSQL.

## Architecture

```text
React + TypeScript
       |
       | REST / JSON, SSE progress
       v
Spring Boot API ------ PostgreSQL
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

The backend is organised as Maven modules:

| Module | Responsibility |
|---|---|
| `queue-model` | Immutable scenario, workload, retry, rate-limit, and outage definitions |
| `simulation-engine` | Pure Java discrete-event engine, virtual clock, deterministic random streams, event scheduler, and metrics |
| `simulation-profiles` | Generic worker-queue profile and explicitly limited BullMQ-inspired profile |
| `server` | Spring Boot REST/SSE API, asynchronous run coordination, and PostgreSQL persistence |

The frontend is under `web/`, and the command-line client is under `cli/`.

For the detailed design and implementation model, see [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md).

## Reproducibility and Random Seeds

QueueFlux uses deterministic virtual-time simulation and named random streams.

The scenario seed determines the starting state used by the pseudo-random generation. Randomness is separated into stable channels such as:

- arrivals
- service-time samples
- failure decisions
- retry jitter

Therefore, the same scenario, engine/schema version, and seed should produce the same logical simulation result. Changing the seed produces another random realization of the same scenario.

This makes QueueFlux suitable for controlled experiments, regression testing, and repeated statistical comparisons.

## Scenario Model

Scenarios are JSON documents validated against **schema version 1**.

A scenario can describe:

- queues and queue policies
- worker pools and concurrency
- service-time distributions
- workloads and arrival processes
- priorities
- rate limits
- retry policies
- worker outages
- simulation duration
- random seed

Example:

```text
examples/
└── constant-load/
    └── scenario.json
```

The complete schema and semantics are documented in [docs/SCENARIO_FORMAT.md](docs/SCENARIO_FORMAT.md) and [docs/SIMULATION_MODEL.md](docs/SIMULATION_MODEL.md).

## Quick Start

### Option 1: Docker Compose

Requirements: Docker Engine or Docker Desktop with Compose v2.

```bash
git clone https://github.com/nishanthn99/queueflux.git
cd queueflux
docker compose up --build
```

Open:

- Web UI: http://localhost:3000
- API: http://localhost:8080
- PostgreSQL: localhost:5432

The Compose configuration uses a named PostgreSQL volume for local persistence.

```bash
docker compose down       # stop containers; keep the database volume
docker compose up -d      # start again with saved runs
docker compose down -v    # destructive: also remove persisted PostgreSQL data
```

The default database credentials are for local development only. Override them before exposing the stack to a network.

### Option 2: Run the API and UI locally

Requirements:

- Java 21+
- Maven 3.9+
- Node.js 22+
- npm 10+
- PostgreSQL 17+

Configure the PostgreSQL connection using:

```text
DB_URL
DB_USERNAME
DB_PASSWORD
```

Start the API:

```bash
mvn -pl backend/server -am spring-boot:run
```

In another terminal:

```bash
cd web
npm install
npm run dev
```

The Vite development server runs on port 5173.

## Run an Experiment from the CLI

The CLI supports validation and execution of scenario files.

From `cli/`:

```bash
npm install
npm test
```

Validate a scenario:

```bash
node bin/qf.js validate ../examples/constant-load/scenario.json
```

Run a scenario against a running QueueFlux API:

```bash
node bin/qf.js run ../examples/constant-load/scenario.json --api http://localhost:8080
```

The CLI also supports JSON output, configurable polling timeouts, and non-blocking submission. See [docs/API.md](docs/API.md) for the API contract.

## Run an Experiment from the API

Synchronous execution:

```bash
curl -sS http://localhost:8080/api/v1/simulations/run \
  -H 'Content-Type: application/json' \
  --data-binary @examples/constant-load/scenario.json
```

Asynchronous execution:

```bash
curl -sS http://localhost:8080/api/v1/simulations/runs \
  -H 'Content-Type: application/json' \
  --data-binary @examples/constant-load/scenario.json
```

The asynchronous response provides a run ID and status/events URLs.

See [docs/API.md](docs/API.md) for REST endpoints, status codes, SSE progress, idempotency, and metrics.

## How the Simulation Works

At a high level:

```text
Workload arrival
      |
      v
Queue admission
      |
      v
Dispatch according to queue policy/rate limit
      |
      v
Worker executes simulated service time
      |
      +-------- success --------> Metrics
      |
      +-------- failure
                 |
                 v
           Retry policy
          /           \
      retry           exhausted
       |                 |
       v                 v
  backoff/jitter     dead letter
       |
       v
   re-admission
```

The engine operates on virtual time measured in integer microseconds. Events are ordered deterministically by timestamp, event phase, and insertion sequence.

See [docs/SIMULATION_MODEL.md](docs/SIMULATION_MODEL.md) for the complete event model.

## Metrics and Interpretation

QueueFlux reports metrics intended for comparative experiments, including:

- throughput
- average queue wait
- end-to-end latency
- P95/P99 latency
- peak backlog
- worker utilization
- rejected jobs
- retries
- dead letters
- end-of-run job states

Metrics should be interpreted as **model outputs**, not measurements of a production broker.

For definitions and interpretation guidance, see [docs/METRICS.md](docs/METRICS.md).

## BullMQ-Inspired Profile

QueueFlux includes a deliberately limited BullMQ-inspired profile.

This does **not** mean QueueFlux runs BullMQ or Redis, nor that its results are drop-in predictions of BullMQ behaviour.

The profile exists to provide a familiar queue-oriented configuration vocabulary and a compatibility boundary for selected behaviours.

See [docs/BULLMQ_PROFILE.md](docs/BULLMQ_PROFILE.md) for supported and intentionally unsupported semantics.

## Persistence and Data Model

PostgreSQL is used for **experiment run metadata and JSON results**.

The simulation engine itself remains in-memory and stateless between runs. PostgreSQL is not used as the simulated queue.

For asynchronous runs, QueueFlux stores information such as:

- run ID
- scenario
- status
- timestamps
- progress
- result snapshot
- error information

Operational limitations, retention, restart behaviour, and backup considerations are documented in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Testing and Quality

The project uses layered automated validation:

```text
Continuous Integration
├── Maven tests + JaCoCo
├── scenario schema validation
├── CLI tests
├── frontend tests + coverage
├── frontend lint/build
├── API Docker image validation
└── build artifacts

Continuous Testing
└── PostgreSQL-backed API integration tests

Code Security
├── CodeQL
└── Semgrep

SonarCloud
└── SonarCloud GitHub App / Quality Gate
```

Local backend verification:

```bash
mvn -B test
```

Frontend verification:

```bash
cd web
npm install
npm run test:coverage
npm run lint
npm run build
```

The CI/CD configuration and quality policy are documented in [docs/QUALITY_AND_SECURITY.md](docs/QUALITY_AND_SECURITY.md).

## Releases and Versioning

QueueFlux uses Conventional Commits and Release Please for semantic versioning and GitHub Releases.

The current development version is tracked by the root Maven POM. Releases below 1.0.0 are pre-release versions.

Release automation builds versioned backend, Maven-module, and frontend artifacts. Maven modules can also be published to GitHub Packages.

See [docs/RELEASES.md](docs/RELEASES.md) and [docs/ARTIFACTS_AND_FREE_HOSTING.md](docs/ARTIFACTS_AND_FREE_HOSTING.md).

## Deployment

QueueFlux can be deployed as a demonstration or hobby application.

The repository contains deployment configuration for a Spring Boot API and a static React frontend. The documented free-tier architecture uses:

| Component | Example provider | Purpose |
|---|---|---|
| React + Vite | Cloudflare Pages | Static frontend hosting |
| Spring Boot API | Render | Application hosting |
| PostgreSQL | Neon | Managed database |

Provider limits, free-tier eligibility, cold starts, storage characteristics, and configuration requirements can change over time. The deployment documentation therefore treats these providers as examples rather than application dependencies.

See [docs/ARTIFACTS_AND_FREE_HOSTING.md](docs/ARTIFACTS_AND_FREE_HOSTING.md) for the deployment procedure.

### Important deployment boundary

Hosting QueueFlux on Render does **not** change the QueueFlux source-code license.

The QueueFlux source remains licensed under Apache License 2.0. Render's own service terms govern use of the Render platform and its services; they do not replace the license of this repository's source code. citeturn766400search5

Do not commit provider credentials, database passwords, API tokens, or other secrets to the repository.

## Open Source Licensing

### QueueFlux license

QueueFlux is distributed under the **Apache License 2.0 (Apache-2.0)**. The complete license text is in [LICENSE](LICENSE).

Apache-2.0 is an OSI-approved permissive open-source license. It grants broad rights to use, reproduce, modify, distribute, and create derivative works, subject to the license's conditions, including preservation of applicable notices and provision of the license text. citeturn766400search0turn766400search3

For this project, Apache-2.0 is intentionally preferred over a strong copyleft license because QueueFlux is intended to be reusable as a simulation library, API, CLI, and web application without requiring downstream projects to adopt the same license for their own independent code.

**This is a project-level licensing statement, not legal advice. Contributors and redistributors remain responsible for complying with the applicable licenses of the code they use or redistribute.**

### Third-party dependency licenses

QueueFlux uses third-party open-source dependencies. The project license does **not** relicense those dependencies: each dependency remains subject to its own license and attribution requirements.

The dependency manifests and lockfiles are committed to the repository so that versions and declared package metadata are reviewable.

The currently inspected Node.js lockfiles declare licenses including:

| License | Observed in lockfiles |
|---|---|
| MIT | Yes |
| Apache-2.0 | Yes |
| BSD-2-Clause | Yes |
| BSD-3-Clause | Yes |
| ISC | Yes |
| MPL-2.0 | Yes |
| BlueOak-1.0.0 | Yes |
| 0BSD | Yes |

The Java build also uses open-source components including Spring Boot and Flyway under Apache-2.0, PostgreSQL under the PostgreSQL License, AssertJ under Apache-2.0, and jqwik under EPL-2.0. citeturn993290search2turn993290search3turn993290search0turn993290search1turn993290search11

These licenses are not all the same, and that is expected in an OSS dependency graph. Permissive licenses such as MIT, BSD, Apache-2.0, ISC, 0BSD, and Blue Oak allow broad reuse subject to their respective notice/attribution conditions. MPL-2.0 and EPL-2.0 have additional file/component-level obligations, so they must not be treated as if they were MIT or Apache-2.0. citeturn711178search0turn711178search3

For that reason:

1. Do not remove or replace third-party license notices.
2. Do not claim that QueueFlux owns third-party code.
3. When redistributing third-party components, preserve the notices and license terms required by those components.
4. Review dependency-license changes when dependencies are upgraded.
5. If a future dependency introduces a stronger or incompatible license, evaluate it before merging rather than assuming that the QueueFlux Apache-2.0 license overrides it.

The current lockfile inspection did not identify a GPL or AGPL package license in the Node.js dependency metadata examined. This should not be interpreted as a complete legal audit of every transitive Maven artifact; future dependency changes should be checked independently.

## Security

QueueFlux is an experimental OSS project and should not be exposed to untrusted workloads without appropriate controls.

In particular, the current project does not claim to provide:

- authentication and authorization
- tenant isolation
- production-grade resource quotas
- distributed execution safety
- arbitrary-code sandboxing
- production broker semantics
- guaranteed persistence of simulation state during process failure

Do not submit secrets or sensitive production data as scenario content.

For vulnerability reporting and security-related development guidance, see the repository's security policy and [docs/QUALITY_AND_SECURITY.md](docs/QUALITY_AND_SECURITY.md).

## Contributing

Contributions are welcome.

Before opening a pull request:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md).
2. Understand the simulation semantics in [docs/SIMULATION_MODEL.md](docs/SIMULATION_MODEL.md).
3. Keep deterministic behaviour intact unless a change intentionally updates the documented model.
4. Add or update automated tests for behavioural changes.
5. Update documentation when the public scenario/API/model contract changes.
6. Run the relevant local tests before opening the PR.

Pull requests are validated through the repository's CI and security workflows.

## Documentation

- [Project guide](docs/PROJECT_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Scenario JSON format](docs/SCENARIO_FORMAT.md)
- [Simulation event model and determinism](docs/SIMULATION_MODEL.md)
- [Metrics and interpretation](docs/METRICS.md)
- [REST and SSE API](docs/API.md)
- [BullMQ-inspired profile](docs/BULLMQ_PROFILE.md)
- [Operations, persistence, backup and safety](docs/OPERATIONS.md)
- [Quality and security](docs/QUALITY_AND_SECURITY.md)
- [Release and versioning](docs/RELEASES.md)
- [Artifact publishing and free hosting](docs/ARTIFACTS_AND_FREE_HOSTING.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture decisions](docs/decisions/)

## Community

The project community can use the [QueueFlux Discord](https://discord.gg/RGRM8g75) for discussion, questions, ideas, and coordination.

## License

Copyright 2026 QueueFlux contributors.

QueueFlux is licensed under the [Apache License, Version 2.0](LICENSE).

Third-party dependencies are **not** relicensed under Apache-2.0; their respective licenses and notices continue to apply.

## Disclaimer

QueueFlux is provided for experimentation and educational/research purposes. Simulation results are model-dependent and should not be treated as guarantees about the behaviour, performance, availability, or reliability of a production queueing system.

---

**Repository:** https://github.com/nishanthn99/queueflux
