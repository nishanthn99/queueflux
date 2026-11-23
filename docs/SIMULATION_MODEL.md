# Simulation Model and Determinism

## Virtual clock

The engine stores time as signed 64-bit integer microseconds. It does not sleep or create threads for simulated jobs. The next event is removed from a priority queue and the virtual clock advances directly to its timestamp.

## Event ordering

Every event is ordered by (timeMicros, phase, insertionSequence). Phases are:

| Phase | Event |
|---:|---|
| 0 | JOB_COMPLETED |
| 1 | WORKER_OUTAGE_END |
| 2 | WORKER_OUTAGE_START |
| 3 | JOB_ARRIVAL |
| 4 | JOB_RETRY_READY |
| 5 | QUEUE_DISPATCH |

The insertion sequence is monotonically increasing and resolves equal-time, equal-phase events. A completion therefore releases capacity before an arrival at the same virtual timestamp. Outage end restores capacity before arrival processing, while outage start reduces capacity before an arrival at the same timestamp.

## Arrival sampling

For constant rate λ jobs/sec, the interval is rounded to the nearest microsecond:

```text
gapMicros = max(1, round(1,000,000 / λ))
```

The first constant-rate arrival occurs at startMicros. For Poisson arrivals, each inter-arrival interval is sampled from an exponential distribution:

```text
gapMicros = max(1, ceil(-ln(1 - U) × 1,000,000 / λ))
```

where U is a deterministic uniform sample in [0, 1). The first Poisson arrival is sampled from the workload start timestamp. The workload end is exclusive.

## Service times and failures

Constant service times return the configured duration. Exponential service times are sampled from an exponential distribution using the configured mean. Log-normal service times are sampled from a single uniform draw mapped through the inverse standard-normal CDF (Acklam's rational approximation); the scenario's real-space mean and standard deviation are converted to the underlying normal parameters (mu, sigma) so the sampled durations reproduce the configured mean and variance. Every job attempt has its own stream key. If failureProbability is greater than zero, a second independent stream determines whether that attempt fails.

A failed attempt increments failedAttempts. If attempts remain, a retry is scheduled after a bounded exponential backoff with deterministic jitter. Otherwise the job reaches a dead-letter outcome. The model treats failures as transient processing failures; it does not simulate application exception types or retryable/non-retryable exception classifiers.

## Token-bucket rate limiter

Each queue has one global bucket:
- initial tokens = burstCapacity;
- refill = ratePerSecond tokens per second;
- tokens are capped at burstCapacity;
- starting a job consumes one token;
- if no token is available, a queue-dispatch event is scheduled for the next estimated token time.

A rate of zero disables the limiter. This policy applies to job starts, not arrivals. Jobs can wait in the bounded queue while tokens refill.

## Worker outages

A planned outage makes a configured number of workers unavailable for new dispatch between the start and end times. Overlapping outages sum unavailable worker counts and clamp at workerCount. Active jobs are allowed to complete; the outage does not kill or pause their service timers. When an outage ends, the dispatch loop is invoked to use restored capacity.

The current model is a planned capacity-reduction abstraction. It does not model individual worker identities, heartbeat timeouts, lock expiry, or job interruption/recovery.

## Queue discipline and admission

- FIFO orders by arrival timestamp, then insertion sequence.
- PRIORITY orders by descending workload priority, then arrival timestamp, then insertion sequence.
- Admission checks waiting depth after attempting to use already-available capacity.
- maxDepth is waiting capacity only; active jobs do not consume waiting slots.
- One pool serves each queue. Different queues execute independently within the same event scheduler.

## Retry states

WAITING -> ACTIVE -> COMPLETED is the success path. A failed active attempt becomes DELAYED, later re-enters WAITING, or is dead-lettered after attempts are exhausted. A retry that cannot re-enter a full waiting queue is also dead-lettered. A brand-new arrival that cannot be admitted is rejected.

## Deterministic streams

QueueFlux uses named SplitMix64 streams derived from the root seed and a stable FNV-1a hash of the channel name:
- arrival:<workloadId>;
- service:<jobId>:<attempt>;
- failure:<jobId>:<attempt>;
- retry-jitter:<jobId>:<attempt>.

This prevents one policy from consuming random numbers intended for another. Same-version, same-schema, same-seed scenarios should produce exactly reproducible logical results and traces. The algorithm and event-phase contract are part of the model version; changing either requires tests and release notes.

## Limits and horizon

The engine stops when the next event is beyond the scenario horizon. Jobs still queued, active or waiting for retry are represented in end-of-run counters. Completion percentiles include completed jobs only. Event trace retention is capped and does not change event processing or metrics.
