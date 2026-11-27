# QueueFlux — Complete Project Guide

**Version:** 0.1.0-SNAPSHOT development baseline  
**License:** Apache-2.0  
**Primary stack:** Java 21, Spring Boot, React, TypeScript, PostgreSQL, Docker Compose

## 1. Project purpose

QueueFlux is a deterministic experimentation environment for asynchronous workloads. A developer describes a queue topology, the rate and shape of incoming jobs, worker capacity, processing-time distribution, and optional failure policies. The engine evaluates the scenario using a discrete-event model and reports how the system behaved over a configured virtual-time horizon.

The central question is: given these workload assumptions and queue/worker policies, what happens to throughput, tail latency, backlog, retries, and recovery when capacity or failures change?

QueueFlux is deliberately not a production message broker, a load generator, a distributed task runtime, or an exact implementation of BullMQ. It performs model-based what-if experiments. A result is only as representative as the scenario assumptions and the model semantics.

### Intended users

- Backend developers designing background-job services.
- Platform and SRE engineers exploring worker capacity and queue policies.
- Students learning queueing systems and discrete-event simulation.
- Teams comparing workload assumptions before controlled tests against a real broker.

### Non-goals

- Executing arbitrary user code or real background jobs.
- Replacing Redis, BullMQ, RabbitMQ, SQS, Kafka, or another production queue.
- Claiming broker-level performance benchmarks from a virtual-time model.
- Automatically inferring distributions from production telemetry.
- Providing multi-tenant SaaS isolation in this development baseline.

## 2. Capabilities in this baseline

| Capability | Behaviour |
|---|---|
| Virtual time | Integer microseconds; event-to-event advancement |
| Arrival models | Constant-rate and Poisson arrivals |
| Service-time models | Constant and exponential distributions |
| Queue topology | Multiple independent queues, one worker pool per queue |
| Scheduling | FIFO or workload-level priority |
| Bounded queue | maxDepth limits waiting jobs; active jobs do not use waiting depth |
| Rate limiting | Per-queue global token bucket with configured burst |
| Retry | Max attempts, exponential backoff, maximum backoff and deterministic jitter |
| Failure injection | Per-attempt probability of transient processing failure |
| Dead-letter outcome | Jobs that exhaust attempts, or cannot re-enter a full queue, are counted |
| Worker outages | Planned intervals reduce worker capacity for new dispatch |
| Metrics | Throughput, queue wait, end-to-end latency p95/p99, backlog, utilization, rejects, retries and dead-letter counts |
| Determinism | Named random streams derived from scenario seed |
| Replications | Multiple derived seeds with summary means and standard deviations |
| Run persistence | PostgreSQL stores scenario/result JSON and run lifecycle metadata |
| Async execution | Bounded server executor and run-status API |
| Progress | SSE endpoint plus status polling |
| UI | Common-input form and advanced versioned JSON editor |

## 3. Repository layout

```text
queueflux/
├── backend/
│   ├── queue-model/
│   │   └── src/main/java/io/queueflux/model/scenario/
│   ├── simulation-engine/
│   │   ├── src/main/java/io/queueflux/engine/
│   │   │   ├── api/              # engine requests, results, progress, metrics
│   │   │   ├── clock/            # virtual clock
│   │   │   ├── random/           # deterministic named streams
│   │   │   ├── runtime/          # service-time samplers
│   │   │   └── scheduler/        # event priority queue and event types
│   │   └── src/test/java/
│   ├── simulation-profiles/
│   └── server/
│       ├── src/main/java/io/queueflux/server/
│       │   ├── api/              # REST DTOs and controllers
│       │   ├── config/           # CORS, engine and executor beans
│       │   ├── persistence/      # JDBC repository
│       │   └── service/          # async run orchestration
│       └── src/main/resources/   # application.yml and schema.sql
├── web/
├── docs/
├── examples/
├── docker-compose.yml
└── pom.xml
```

### Backend module boundaries

**queue-model** contains immutable data contracts and validation. It has no dependency on Spring, HTTP, SQL, or the simulation runtime.

**simulation-engine** is pure Java. It owns the virtual clock, ordered event scheduler, queue state, worker state, random sampling, job transitions, and metrics. It does not know about HTTP requests or PostgreSQL.

**simulation-profiles** is the boundary for named behaviour profiles. The generic profile is the default. The BullMQ-inspired class is intentionally a compatibility label and validator for the supported generic subset; it is not a Redis/BullMQ emulator. See BULLMQ_PROFILE.md.

**server** composes the engine and exposes endpoints. It owns run lifecycle, bounded asynchronous execution, PostgreSQL persistence, and SSE delivery.

**web** is the experiment workspace. It sends scenario JSON to the server; it does not implement simulation semantics in the browser.

## 4. Runtime architecture and data flow

### Synchronous execution

1. The browser or caller submits a ScenarioDefinition.
2. Spring MVC deserializes JSON into immutable model records.
3. ScenarioValidator checks IDs, references, time windows, queue/pool pairing, and outage bounds.
4. SimulationController creates a SimulationRequest with safety limits.
5. DefaultSimulationEngine creates queue runtimes, workload streams, and initial arrival/outage events.
6. EventScheduler returns events in deterministic order.
7. The engine advances VirtualClock, updates queue/worker state, and schedules resulting events.
8. Metrics and a bounded trace are returned as SimulationResult.

### Asynchronous execution

1. POST /api/v1/simulations/runs validates the scenario and writes a QUEUED row to PostgreSQL.
2. A bounded ThreadPoolTaskExecutor starts the run and marks it RUNNING.
3. The same pure Java engine executes the scenario.
4. Progress callbacks update virtual time/event counters in PostgreSQL and are published to connected SSE clients.
5. The completed result is stored as JSONB and the run is marked COMPLETED; exceptions mark it FAILED.
6. Clients can retrieve the durable snapshot after reconnecting or restarting the API.

PostgreSQL persistence is for experiment records, not individual simulated queue jobs. The simulation engine does not persist its internal event queue.

## 5. Scenario model

Every scenario uses schemaVersion 1 and defines a name, horizon, seed, one or more queues, exactly one worker pool per queue, and one or more workloads.

Times are integer microseconds. Rates are jobs per second. The complete field reference is in SCENARIO_FORMAT.md.

### Queue configuration

- id: unique queue identifier.
- maxDepth: maximum number of jobs waiting for workers. Active jobs are not counted.
- discipline: FIFO or PRIORITY.
- retryPolicy: optional attempt/backoff policy. Omitted means retries are disabled (maxAttempts = 1).
- rateLimit: optional token bucket. A zero ratePerSecond disables limiting.

Priority is supplied on a workload. Larger integer values are dispatched first when the target queue uses PRIORITY; arrival timestamp and insertion sequence break ties. Under FIFO, priority is ignored.

### Worker-pool configuration

- workerCount: number of simulated workers.
- concurrencyPerWorker: simultaneous slots per worker.
- serviceTime: constant or exponential service duration.
- failureProbability: independent transient failure probability for every attempt (default 0).
- outages: planned intervals that reduce capacity for new job starts.

Effective slot capacity outside outages is workerCount × concurrencyPerWorker. Multiple overlapping outage windows add unavailable worker counts, clamped to workerCount. Jobs already active at an outage start are not killed; they complete normally. The outage affects subsequent dispatches.

### Workload configuration

A workload defines its queue, active interval, arrival process and optional integer priority. For constant arrivals, the first job is created at startMicros, then at rounded fixed intervals. For Poisson arrivals, the first inter-arrival interval is sampled exponentially from the workload start time. endMicros is exclusive.

## 6. Job state transitions

```text
ARRIVAL -> WAITING -> ACTIVE -> COMPLETED
                |       |
                |       +-- failed attempt
                |                 |
                |                 v
                |              DELAYED -- backoff elapsed --> WAITING
                |                 |
                |                 +-- attempts exhausted --> DEAD-LETTERED
                |
                +-- maxDepth reached --> REJECTED

DELAYED -- retry queue full --> DEAD-LETTERED
```

- A queue admission counts as an accepted job.
- A retry is another attempt of the same job; it does not increment generatedJobs or acceptedJobs.
- retriedJobs counts retry schedules, not total attempt count.
- failedAttempts counts every failed service attempt.
- deadLetteredJobs counts jobs that exhaust attempts or cannot re-enter a full waiting queue.
- A job delayed for retry at the simulation horizon contributes to delayedRetryAtEnd.

## 7. Event ordering and determinism

The event scheduler sorts by virtual timestamp, event phase, then monotonically increasing insertion sequence.

| Phase | Event |
|---:|---|
| 0 | JOB_COMPLETED |
| 1 | WORKER_OUTAGE_END |
| 2 | WORKER_OUTAGE_START |
| 3 | JOB_ARRIVAL |
| 4 | JOB_RETRY_READY |
| 5 | QUEUE_DISPATCH |

This means a completion can release worker capacity before an arrival at the same timestamp, and a worker outage end restores new-dispatch capacity before an arrival.

Random streams are isolated by semantic name:
- arrival:<workloadId>
- service:<jobId>:<attempt>
- failure:<jobId>:<attempt>
- retry-jitter:<jobId>:<attempt>

The engine uses a documented SplitMix64 step and stable FNV-1a channel hashing. A scenario with the same engine version, schema and seed yields the same logical metrics and trace. Changing event phases, random derivation, or distribution sampling is a behavioural change and should be covered by regression tests.

## 8. Metrics and interpretation

All time metrics are microseconds in the API result. Convert to milliseconds by dividing by 1,000 and seconds by dividing by 1,000,000.

- Throughput: completed jobs divided by configured scenario duration in seconds.
- Average queue wait: accumulated waiting time across attempts, averaged over completed jobs.
- End-to-end latency: first arrival to final completion, including retry delays.
- p95/p99 latency: nearest-rank percentiles over completed jobs only.
- Peak backlog: largest observed number of jobs waiting after a dispatch pass.
- Worker utilization: busy worker-slot microseconds divided by provisioned worker-slot microseconds over the horizon, capped at 100%.
- Rejected jobs: new arrivals rejected because waiting capacity is full.
- Retry and dead-letter counts: effect of injected processing failures and retry policy.

Jobs active, waiting or delayed at the horizon do not contribute to completion latency percentiles. Read the end-of-run counters alongside latency. See METRICS.md.

## 9. API reference

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/v1/simulations/run | Synchronous run for short scenarios |
| POST | /api/v1/simulations/runs | Create durable asynchronous run |
| GET | /api/v1/simulations/runs/{id} | Read status, progress and final result |
| GET | /api/v1/simulations/runs/{id}/events | SSE stream (snapshot, status, progress, completed, failed) |
| POST | /api/v1/simulations/compare | Run 2–30 seeded replications and summarize variation |
| GET | /actuator/health | Service health |

See API.md for examples and error semantics.

## 10. Replicated comparisons

The compare endpoint derives each seed as:

```text
replicationSeed(i) = scenario.seed + i × seedStride
```

It reports mean throughput, standard deviation of throughput, mean p95 latency, standard deviation of p95 latency, mean p99 latency, mean peak backlog, mean rejected jobs, and mean utilization. The current endpoint allows 2–30 replications and disables traces to keep its response bounded.

These are descriptive statistics over the specified seeds, not a formal confidence interval. Use more replications and validate the model against real measurements before using results for capacity commitments.

## 11. Persistence and asynchronous execution

The simulation_runs PostgreSQL table stores:
- UUID run ID and lifecycle status;
- scenario name and random seed;
- submission/completion timestamps;
- scenario JSONB and result JSONB;
- last progress time and processed-event count;
- an error message for failed runs.

The API's async executor currently uses two core threads, a maximum of four threads, and a queue of fifty tasks. This is a single-process development arrangement, not a distributed job scheduler. On a single-process API restart, QUEUED and RUNNING rows are replayed deterministically from virtual time zero. This is a replay, not a checkpointed continuation; it assumes only one API instance is running.

The Compose named volume preserves run data across docker compose down. Deleting the volume destroys the database. See OPERATIONS.md.

## 12. Frontend

The React interface provides a basic scenario editor for common workload, worker, duration and seed settings; an advanced JSON scenario editor for multiple queues and policies; asynchronous run submission and progress polling; throughput, p95 latency, backlog and utilization cards; an event activity chart and run summary.

The UI intentionally treats JSON as the complete scenario contract. If an advanced field is not represented by a simple form control, use the JSON editor.

## 13. Local development

Requirements: JDK 21, Maven 3.9+, Node.js 22+, npm 10+, PostgreSQL 18+ or Docker Compose.

```bash
mvn -B test
docker compose up --build

cd web
npm install
npm run dev
```

GitHub Actions checks the Maven test lifecycle and frontend TypeScript/Vite build. CI success confirms those automated jobs for that commit; it does not validate model calibration against a production broker.

## 14. Security and operational limitations

- The default PostgreSQL password is for local development only.
- Do not expose the development Compose stack directly to the public internet.
- Add authentication, authorization, per-user quotas, request-size limits, rate limiting and retention policies before multi-user deployment.
- Scenario JSON is data; the product does not evaluate code strings.
- Bound scenario duration, generated jobs, processed events, trace size, and replication count at API boundaries. The current synchronous and comparison endpoints apply engine limits; production deployments should add API-level admission policies.
- Use backups before migrations or database-volume changes.

## 15. Extension guidelines

- Keep scenario records immutable and framework-independent.
- Add policy semantics to the model and engine, not the web layer.
- Use named random streams for any new stochastic behaviour.
- Define event phases before adding same-time event types.
- Add deterministic tests for boundaries, equal timestamps, retry limits, and capacity changes.
- Update the scenario-format, simulation-model and metrics documentation with each behavioural change.
- Do not describe a profile as broker-compatible until its semantics have conformance tests against the target broker version.

## 16. Current roadmap

See ROADMAP.md. Major remaining work includes automatic recovery/resumption of interrupted async runs, API authentication and quotas, richer outage models (including active-job interruption), BullMQ conformance experiments, calibration against captured telemetry, and confidence-interval reporting.
