# HTTP API

Base URL for local Compose: http://localhost:8080. All simulation endpoints accept JSON. Time values are integer microseconds; rates are jobs per second.

## 1. Synchronous run

POST /api/v1/simulations/run

Request body: a complete ScenarioDefinition, such as examples/constant-load/scenario.json.

```bash
curl -X POST http://localhost:8080/api/v1/simulations/run \
  -H 'Content-Type: application/json' \
  --data-binary @examples/constant-load/scenario.json
```

Returns a SimulationResult containing scenario/seed metadata, aggregate metrics, per-queue metrics, and the bounded event trace. This is intended for short experiments because the HTTP request remains open until the run completes.

Default engine limits for this endpoint are 1,000,000 generated jobs, 5,000,000 processed events, and 100,000 trace events.

## 2. Create an asynchronous run

POST /api/v1/simulations/runs

Request body: a ScenarioDefinition.

```bash
curl -X POST http://localhost:8080/api/v1/simulations/runs \
  -H 'Content-Type: application/json' \
  --data-binary @examples/constant-load/scenario.json
```

Returns HTTP 202 Accepted:

```json
{
  "id": "a-uuid",
  "status": "QUEUED",
  "statusUrl": "/api/v1/simulations/runs/a-uuid",
  "eventsUrl": "/api/v1/simulations/runs/a-uuid/events"
}
```

The run record is inserted before the task is submitted to the bounded executor. Status values are QUEUED, RUNNING, COMPLETED, and FAILED.

## 3. Read run status

GET /api/v1/simulations/runs/{id}

Returns:
- id, status, scenarioName, and seed;
- submittedAt and nullable completedAt;
- virtualTimeMicros and processedEvents;
- original scenario;
- nullable final result;
- nullable errorMessage.

Returns 404 Not Found when the run ID does not exist.

## 4. Fetch run metrics

GET /api/v1/simulations/runs/{id}/metrics

Returns only the final metrics object (the `result` payload of a completed run), without the surrounding snapshot (scenario, timestamps, status metadata). Useful for CLI/UI callers that already know the run completed and only need the numbers:

```bash
curl http://localhost:8080/api/v1/simulations/runs/<uuid>/metrics
```

Response body is the SimulationResult metrics: acceptedJobs, completedJobs, rejectedJobs, deadLetteredJobs, throughputPerSecond, p95EndToEndLatencyMicros, p99EndToEndLatencyMicros, workerUtilization, peakBacklog, and related fields.

- Returns 404 Not Found when the run ID does not exist.
- Returns 409 Conflict when the run exists but has not completed yet (no metrics available).

The QueueFlux CLI `run --wait` uses this endpoint to retrieve metrics once a run reaches COMPLETED.

## 5. Subscribe to run events

GET /api/v1/simulations/runs/{id}/events

Content type: text/event-stream.

Event names:
- snapshot: latest persisted run snapshot on connection;
- status: transition to running;
- progress: virtual time and processed/scheduled event counts;
- completed: final persisted snapshot;
- failed: failed snapshot and error text.

Example:

```bash
curl -N http://localhost:8080/api/v1/simulations/runs/<uuid>/events
```

A client should still read the status endpoint after an SSE disconnect. SSE connections are transient; the PostgreSQL run record is durable.

## 6. Replicated stochastic comparison

POST /api/v1/simulations/compare

Request:

```json
{
  "replications": 10,
  "seedStride": 1000,
  "scenario": {
    "schemaVersion": 1,
    "name": "poisson-capacity-study",
    "durationMicros": 60000000,
    "seed": 1234,
    "queues": [
      { "id": "jobs", "maxDepth": 1000, "discipline": "FIFO" }
    ],
    "workerPools": [
      {
        "id": "workers",
        "queueId": "jobs",
        "workerCount": 4,
        "concurrencyPerWorker": 1,
        "serviceTime": { "distribution": "EXPONENTIAL", "constantMicros": 200000, "meanMicros": 200000 }
      }
    ],
    "workloads": [
      {
        "id": "traffic",
        "queueId": "jobs",
        "startMicros": 0,
        "endMicros": 60000000,
        "arrivals": { "mode": "POISSON", "ratePerSecond": 15 }
      }
    ]
  }
}
```

replications must be 2–30; seedStride must be at least 1. Seeds are scenario.seed + i * seedStride. The response includes aggregate means/standard deviations and a compact summary per seed. Each internal run is limited to 250,000 generated jobs, 1,000,000 processed events and zero trace events.

## 7. Health

GET /actuator/health

Spring Boot Actuator health response. PostgreSQL availability is included by the configured datasource health contributor.

## Error handling

- Invalid scenario/policy values produce HTTP 400 with a structured error body.
- A simulation exceeding a configured engine limit produces an execution error.
- Async execution failures are persisted with status FAILED; the status endpoint contains errorMessage.
- Unknown run IDs produce HTTP 404.

Do not expose stack traces or database credentials to public clients. Add authentication and per-tenant admission policies before deploying this API for untrusted users.
