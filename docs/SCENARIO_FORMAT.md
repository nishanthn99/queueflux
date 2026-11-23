# Scenario JSON Format (schemaVersion 1)

A machine-readable JSON Schema for this format lives at
[`schemas/v1/scenario.json`](../schemas/v1/scenario.json).
Point your editor at it via `"$schema": "https://raw.githubusercontent.com/nishanthn99/queueflux/main/schemas/v1/scenario.json"`
to get inline validation and autocomplete in VS Code, IntelliJ, and any other
editor that supports [JSON Schema](https://json-schema.org/).

A scenario is a complete description of a virtual-time queue experiment. The current parser accepts the fields below. Optional policy fields default to disabled behaviour when omitted.

## Top level

| Field | Type | Required | Meaning |
|---|---|---:|---|
| schemaVersion | integer | yes | Currently 1 |
| name | string | yes | Human-readable experiment label |
| durationMicros | integer | yes | Simulation horizon in microseconds |
| seed | integer | yes | Root deterministic random seed |
| queues | array | yes | One or more queue definitions |
| workerPools | array | yes | Exactly one pool for each queue |
| workloads | array | yes | One or more workload definitions |

## Queue definition

| Field | Type | Default | Meaning |
|---|---|---|---|
| id | string | — | Unique queue ID |
| maxDepth | integer | — | Max jobs waiting for workers; must be >= 1 |
| discipline | enum | — | FIFO or PRIORITY |
| retryPolicy | object | disabled | Retry rules for transient failures |
| rateLimit | object | unlimited | Global token-bucket rate limiter for job starts |

Retry policy:

| Field | Type | Meaning |
|---|---|---|
| maxAttempts | integer | Total attempts including the first; 1–100 |
| initialBackoffMicros | integer | Initial retry delay |
| maxBackoffMicros | integer | Upper bound for the exponential delay |
| multiplier | number | Exponential multiplier, >= 1 |
| jitterFraction | number | Deterministic symmetric jitter fraction from 0 to 1 |

For attempt a, the unjittered backoff is:

```text
min(maxBackoff, initialBackoff × multiplier^(a - 1))
```

Jitter is sampled from the job/attempt-specific deterministic stream. maxAttempts: 1 disables retries.

Rate limit:

| Field | Type | Meaning |
|---|---|---|
| ratePerSecond | number | Token refill rate; 0 disables limiting |
| burstCapacity | integer | Maximum token count and initial bucket size |

This is a token-bucket abstraction. It is global to the simulated queue, not a per-worker limiter.

## Worker-pool definition

| Field | Type | Default | Meaning |
|---|---|---|---|
| id | string | — | Unique pool ID |
| queueId | string | — | Queue served by this pool |
| workerCount | integer | — | Number of workers, >= 1 |
| concurrencyPerWorker | integer | — | Slots per worker, >= 1 |
| serviceTime | object | — | Service-time distribution |
| failureProbability | number | 0 | Failure probability per attempt, 0–1 |
| outages | array | empty | Planned worker-capacity outage windows |

Service time:
- CONSTANT: uses constantMicros.
- EXPONENTIAL: samples an exponential duration from meanMicros.
- LOGNORMAL: samples a right-skewed duration whose real-space mean is meanMicros and whose real-space standard deviation is stdDevMicros. Both must be > 0. The engine converts these to the underlying normal parameters, so the sampled durations reproduce the configured mean and standard deviation.

Worker outage:

| Field | Type | Meaning |
|---|---|---|
| id | string | Unique within the worker pool |
| startMicros | integer | Inclusive start time |
| endMicros | integer | Exclusive end time |
| unavailableWorkers | integer | Number of workers not accepting new jobs |

Outages reduce capacity for new dispatch. They do not interrupt jobs already running.

## Workload definition

| Field | Type | Default | Meaning |
|---|---|---|---|
| id | string | — | Unique workload ID |
| queueId | string | — | Target queue |
| startMicros | integer | — | Start of workload window |
| endMicros | integer | — | Exclusive end; <= scenario duration |
| priority | integer | 0 | Larger values first in PRIORITY queues |
| arrivals | object | — | Constant or Poisson process |

Arrival model:
- CONSTANT: first job at startMicros; then fixed intervals based on ratePerSecond.
- POISSON: exponential inter-arrival times with mean 1 / ratePerSecond; first arrival is also sampled from this distribution.

## Validation rules

- IDs must be unique within each entity type.
- Every workload and worker pool must refer to a defined queue.
- Every queue must have exactly one worker pool and at least one workload.
- Workload and outage time windows must fit within the simulation horizon.
- The scenario currently uses one worker pool per queue. Multiple workloads may feed the same queue.
- maxDepth bounds waiting jobs only; jobs executing in a worker slot are not part of the waiting depth.

See examples/constant-load/scenario.json for a multi-queue sample that exercises priority, rate limiting, retries, failure injection, and worker outages.
