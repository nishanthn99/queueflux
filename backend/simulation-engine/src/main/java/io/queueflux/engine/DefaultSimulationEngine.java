package io.queueflux.engine;

import io.queueflux.engine.api.*;
import io.queueflux.engine.clock.VirtualClock;
import io.queueflux.engine.random.DeterministicRandom;
import io.queueflux.engine.runtime.ServiceTimeSampler;
import io.queueflux.engine.scheduler.*;
import io.queueflux.model.scenario.*;
import java.util.*;
import java.util.concurrent.CancellationException;

/**
 * Deterministic multi-queue discrete-event engine. Simulation time is virtual;
 * simulated jobs never create threads or perform real I/O.
 */
public final class DefaultSimulationEngine implements SimulationEngine {
    private enum JobStatus { WAITING, ACTIVE, DELAYED, COMPLETED, DEAD_LETTERED }

    private static final class JobState {
        final String id;
        final String queueId;
        final int priority;
        final long arrivalMicros;
        final long sequence;
        JobStatus status = JobStatus.WAITING;
        long enqueuedMicros;
        long startedMicros;
        long accumulatedWaitMicros;
        int attempts;

        JobState(String id, String queueId, int priority, long arrivalMicros, long sequence) {
            this.id = id; this.queueId = queueId; this.priority = priority;
            this.arrivalMicros = arrivalMicros; this.sequence = sequence; this.enqueuedMicros = arrivalMicros;
        }
    }

    private static final class QueueRuntime {
        final QueueDefinition definition;
        final WorkerPoolDefinition pool;
        final PriorityQueue<JobState> waiting;
        final Map<String, Integer> activeOutages = new HashMap<>();
        final List<Long> waits = new ArrayList<>();
        final List<Long> latencies = new ArrayList<>();
        double tokens;
        long lastRefillMicros;
        long nextDispatchMicros = -1;
        int active;
        long busySlotMicros;
        long lastAccountingMicros;
        long accepted, completed, rejected, retried, failedAttempts, deadLettered, peakBacklog;
        long waitingAtEnd, delayedAtEnd;

        QueueRuntime(QueueDefinition definition, WorkerPoolDefinition pool) {
            this.definition = definition; this.pool = pool;
            this.tokens = definition.rateLimit().ratePerSecond() == 0
                    ? Double.POSITIVE_INFINITY : definition.rateLimit().burstCapacity();
            Comparator<JobState> comparator = definition.discipline() == SchedulingDiscipline.PRIORITY
                    ? Comparator.comparingInt((JobState job) -> job.priority).reversed()
                        .thenComparingLong(job -> job.arrivalMicros).thenComparingLong(job -> job.sequence)
                    : Comparator.comparingLong((JobState job) -> job.arrivalMicros).thenComparingLong(job -> job.sequence);
            this.waiting = new PriorityQueue<>(comparator);
        }

        int effectiveCapacity() {
            int unavailable = activeOutages.values().stream().mapToInt(Integer::intValue).sum();
            unavailable = Math.min(pool.workerCount(), unavailable);
            return Math.max(0, pool.capacity() - unavailable * pool.concurrencyPerWorker());
        }

        void accountUntil(long now) {
            long elapsed = Math.max(0, now - lastAccountingMicros);
            busySlotMicros += elapsed * active;
            lastAccountingMicros = now;
        }

        boolean acquireToken(long now) {
            RateLimitPolicy policy = definition.rateLimit();
            if (policy.ratePerSecond() == 0) return true;
            long elapsed = Math.max(0, now - lastRefillMicros);
            tokens = Math.min(policy.burstCapacity(), tokens + elapsed * policy.ratePerSecond() / 1_000_000d);
            lastRefillMicros = now;
            if (tokens >= 1d) {
                tokens -= 1d;
                return true;
            }
            return false;
        }

        long nextTokenTime(long now) {
            RateLimitPolicy policy = definition.rateLimit();
            if (policy.ratePerSecond() == 0) return now;
            double missing = Math.max(0d, 1d - tokens);
            long delay = Math.max(1L, (long) Math.ceil(missing * 1_000_000d / policy.ratePerSecond()));
            return Math.addExact(now, delay);
        }
    }

    private record WorkloadRuntime(WorkloadDefinition definition, DeterministicRandom random, int index) {}

    @Override
    public SimulationResult run(SimulationRequest request, SimulationObserver observer) {
        Objects.requireNonNull(request, "request");
        observer = observer == null ? SimulationObserver.noop() : observer;
        ScenarioDefinition scenario = request.scenario();
        ScenarioValidator.validate(scenario);

        Map<String, QueueRuntime> queues = new LinkedHashMap<>();
        Map<String, WorkerPoolDefinition> poolsByQueue = new HashMap<>();
        scenario.workerPools().forEach(pool -> poolsByQueue.put(pool.queueId(), pool));
        scenario.queues().forEach(queue -> queues.put(queue.id(), new QueueRuntime(queue, poolsByQueue.get(queue.id()))));

        EventScheduler scheduler = new EventScheduler();
        VirtualClock clock = new VirtualClock();
        Map<String, JobState> jobs = new HashMap<>();
        List<WorkloadRuntime> workloads = new ArrayList<>();
        long[] nextJobNumber = new long[scenario.workloads().size()];
        long[] generated = {0};
        long[] accepted = {0};
        long[] globalSequence = {0};
        long[] pendingRetries = {0};
        List<TraceEvent> trace = new ArrayList<>();
        long processedEvents = 0;
        long scenarioPeakBacklog = 0;

        for (int i = 0; i < scenario.workloads().size(); i++) {
            WorkloadDefinition workload = scenario.workloads().get(i);
            DeterministicRandom random = DeterministicRandom.stream(scenario.seed(), "arrival:" + workload.id());
            workloads.add(new WorkloadRuntime(workload, random, i));
            long first = workload.arrivals().mode() == ArrivalMode.CONSTANT
                    ? workload.startMicros() : nextArrival(workload, workload.startMicros(), random);
            if (first < workload.endMicros() && first < scenario.durationMicros()) {
                scheduler.schedule(first, EventType.JOB_ARRIVAL, jobId(i, workload, nextJobNumber[i]++), workload.queueId());
            }
        }
        for (QueueRuntime queue : queues.values()) {
            for (WorkerOutage outage : queue.pool.outages()) {
                scheduler.schedule(outage.startMicros(), EventType.WORKER_OUTAGE_START, null,
                        queue.definition.id(), outage.id());
                scheduler.schedule(outage.endMicros(), EventType.WORKER_OUTAGE_END, null,
                        queue.definition.id(), outage.id());
            }
        }

        int maxTrace = request.maxTraceEvents();
        while (!scheduler.isEmpty()) {
            if (observer.isCancelled()) throw new CancellationException("simulation run was cancelled");
            ScheduledEvent event = scheduler.poll();
            if (event.timeMicros() > scenario.durationMicros()) break;
            if (++processedEvents > request.maxEvents()) throw new IllegalStateException("maximum event limit exceeded");
            QueueRuntime queue = queues.get(event.queueId());
            if (queue == null) throw new IllegalStateException("event references unknown queue " + event.queueId());
            queue.accountUntil(event.timeMicros());
            clock.advanceTo(event.timeMicros());

            switch (event.type()) {
                case JOB_ARRIVAL -> {
                    if (generated[0] >= request.maxGeneratedJobs()) throw new IllegalStateException("maximum generated job limit exceeded");
                    WorkloadRuntime workload = workloadForJob(workloads, event.jobId());
                    generated[0]++;
                    dispatch(queue, scheduler, clock.nowMicros(), jobs, trace, maxTrace, scenario.seed());
                    JobState job = new JobState(event.jobId(), queue.definition.id(), workload.definition().priority(),
                            clock.nowMicros(), globalSequence[0]++);
                    if (queue.waiting.size() >= queue.definition.maxDepth()) {
                        queue.rejected++;
                        addTrace(trace, maxTrace, new TraceEvent(clock.nowMicros(), "JOB_REJECTED", job.id, "Waiting queue reached maxDepth"));
                    } else {
                        queue.waiting.add(job);
                        jobs.put(job.id, job);
                        queue.accepted++;
                        accepted[0]++;
                        addTrace(trace, maxTrace, new TraceEvent(clock.nowMicros(), "JOB_ARRIVED", job.id, "Accepted into " + queue.definition.id()));
                        dispatch(queue, scheduler, clock.nowMicros(), jobs, trace, maxTrace, scenario.seed());
                        queue.peakBacklog = Math.max(queue.peakBacklog, queue.waiting.size());
                    }
                    WorkloadDefinition definition = workload.definition();
                    long next = nextArrival(definition, clock.nowMicros(), workload.random());
                    if (next > clock.nowMicros() && next < definition.endMicros() && next < scenario.durationMicros()) {
                        scheduler.schedule(next, EventType.JOB_ARRIVAL,
                                jobId(workload.index(), definition, nextJobNumber[workload.index()]++), definition.queueId());
                    }
                }
                case JOB_COMPLETED -> {
                    JobState job = jobs.get(event.jobId());
                    if (job == null || job.status != JobStatus.ACTIVE) break;
                    queue.active--;
                    if (shouldFail(queue.pool.failureProbability(), scenario.seed(), job.id, job.attempts)) {
                        queue.failedAttempts++;
                        if (job.attempts < queue.definition.retryPolicy().maxAttempts()) {
                            queue.retried++;
                            job.status = JobStatus.DELAYED;
                            long backoff = retryDelay(queue.definition.retryPolicy(), scenario.seed(), job.id, job.attempts);
                            long retryAt = Math.addExact(clock.nowMicros(), backoff);
                            pendingRetries[0]++;
                            scheduler.schedule(retryAt, EventType.JOB_RETRY_READY, job.id, queue.definition.id());
                            addTrace(trace, maxTrace, new TraceEvent(clock.nowMicros(), "JOB_RETRY_SCHEDULED", job.id,
                                    "Attempt " + job.attempts + " failed; retry at " + retryAt));
                        } else {
                            job.status = JobStatus.DEAD_LETTERED;
                            jobs.remove(job.id);
                            queue.deadLettered++;
                            addTrace(trace, maxTrace, new TraceEvent(clock.nowMicros(), "JOB_DEAD_LETTERED", job.id,
                                    "Maximum attempts exhausted"));
                        }
                    } else {
                        job.status = JobStatus.COMPLETED;
                        jobs.remove(job.id);
                        queue.completed++;
                        queue.waits.add(job.accumulatedWaitMicros);
                        queue.latencies.add(clock.nowMicros() - job.arrivalMicros);
                        addTrace(trace, maxTrace, new TraceEvent(clock.nowMicros(), "JOB_COMPLETED", job.id, "Processing completed"));
                    }
                    dispatch(queue, scheduler, clock.nowMicros(), jobs, trace, maxTrace, scenario.seed());
                }
                case JOB_RETRY_READY -> {
                    pendingRetries[0]--;
                    JobState job = jobs.get(event.jobId());
                    if (job == null || job.status != JobStatus.DELAYED) break;
                    job.status = JobStatus.WAITING;
                    job.enqueuedMicros = clock.nowMicros();
                    if (queue.waiting.size() >= queue.definition.maxDepth()) {
                        job.status = JobStatus.DEAD_LETTERED;
                        jobs.remove(job.id);
                        queue.deadLettered++;
                        addTrace(trace, maxTrace, new TraceEvent(clock.nowMicros(), "JOB_DEAD_LETTERED", job.id,
                                "Retry could not re-enter a full waiting queue"));
                    } else {
                        queue.waiting.add(job);
                        addTrace(trace, maxTrace, new TraceEvent(clock.nowMicros(), "JOB_RETRY_READY", job.id, "Retry entered the waiting queue"));
                        dispatch(queue, scheduler, clock.nowMicros(), jobs, trace, maxTrace, scenario.seed());
                        queue.peakBacklog = Math.max(queue.peakBacklog, queue.waiting.size());
                    }
                }
                case WORKER_OUTAGE_START -> {
                    WorkerOutage outage = findOutage(queue.pool, event.outageId());
                    queue.activeOutages.put(outage.id(), outage.unavailableWorkers());
                    addTrace(trace, maxTrace, new TraceEvent(clock.nowMicros(), "WORKER_OUTAGE_STARTED", outage.id(),
                            outage.unavailableWorkers() + " workers unavailable in pool " + queue.pool.id()));
                    dispatch(queue, scheduler, clock.nowMicros(), jobs, trace, maxTrace, scenario.seed());
                }
                case WORKER_OUTAGE_END -> {
                    WorkerOutage outage = findOutage(queue.pool, event.outageId());
                    queue.activeOutages.remove(outage.id());
                    addTrace(trace, maxTrace, new TraceEvent(clock.nowMicros(), "WORKER_OUTAGE_ENDED", outage.id(),
                            "Worker capacity restored in pool " + queue.pool.id()));
                    dispatch(queue, scheduler, clock.nowMicros(), jobs, trace, maxTrace, scenario.seed());
                }
                case QUEUE_DISPATCH -> {
                    queue.nextDispatchMicros = -1;
                    dispatch(queue, scheduler, clock.nowMicros(), jobs, trace, maxTrace, scenario.seed());
                }
            }
            long totalWaitingNow = queues.values().stream().mapToLong(runtime -> runtime.waiting.size()).sum();
            scenarioPeakBacklog = Math.max(scenarioPeakBacklog, totalWaitingNow);
            if (processedEvents % 10_000 == 0) {
                observer.onProgress(new SimulationProgress(clock.nowMicros(), processedEvents, processedEvents + scheduler.size()));
            }
        }

        long totalBusy = 0;
        long totalCapacity = 0;
        long totalCompleted = 0, totalRejected = 0, totalRetried = 0, totalFailed = 0, totalDead = 0;
        long waitingAtEnd = 0, activeAtEnd = 0;
        List<Long> waits = new ArrayList<>(), latencies = new ArrayList<>();
        List<QueueMetrics> queueMetrics = new ArrayList<>();
        for (QueueRuntime queue : queues.values()) {
            queue.accountUntil(scenario.durationMicros());
            long capacityMicros = (long) queue.pool.capacity() * scenario.durationMicros();
            totalBusy += queue.busySlotMicros;
            totalCapacity += capacityMicros;
            totalCompleted += queue.completed;
            totalRejected += queue.rejected;
            totalRetried += queue.retried;
            totalFailed += queue.failedAttempts;
            totalDead += queue.deadLettered;
            waitingAtEnd += queue.waiting.size();
            activeAtEnd += queue.active;
            waits.addAll(queue.waits);
            latencies.addAll(queue.latencies);
            long queueDelayed = jobs.values().stream().filter(job ->
                    job.queueId.equals(queue.definition.id()) && job.status == JobStatus.DELAYED).count();
            queue.waitingAtEnd = queue.waiting.size();
            queue.delayedAtEnd = queueDelayed;
            double durationSeconds = scenario.durationMicros() / 1_000_000d;
            queueMetrics.add(new QueueMetrics(queue.definition.id(), queue.accepted, queue.completed,
                    queue.rejected, queue.retried, queue.deadLettered, queue.waitingAtEnd,
                    queue.delayedAtEnd, queue.active, queue.peakBacklog,
                    durationSeconds == 0 ? 0 : queue.completed / durationSeconds,
                    mean(queue.waits), percentile(queue.latencies, 0.95), percentile(queue.latencies, 0.99),
                    capacityMicros == 0 ? 0 : Math.min(1d, queue.busySlotMicros / (double) capacityMicros)));
        }
        double durationSeconds = scenario.durationMicros() / 1_000_000d;
        double utilization = totalCapacity == 0 ? 0 : Math.min(1d, totalBusy / (double) totalCapacity);
        SimulationResult result = new SimulationResult(
                scenario.name(), scenario.seed(), scenario.durationMicros(), processedEvents,
                generated[0], accepted[0], totalCompleted, totalRejected, totalRetried, totalFailed, totalDead,
                waitingAtEnd, pendingRetries[0], activeAtEnd, scenarioPeakBacklog,
                durationSeconds == 0 ? 0 : totalCompleted / durationSeconds,
                mean(waits), mean(latencies), percentile(latencies, 0.95), percentile(latencies, 0.99),
                utilization, queueMetrics, trace);
        observer.onProgress(new SimulationProgress(scenario.durationMicros(), processedEvents, processedEvents));
        return result;
    }

    private static void dispatch(QueueRuntime queue, EventScheduler scheduler, long now,
                                 Map<String, JobState> jobs, List<TraceEvent> trace, int maxTrace, long seed) {
        while (queue.active < queue.effectiveCapacity() && !queue.waiting.isEmpty()) {
            if (!queue.acquireToken(now)) {
                long next = queue.nextTokenTime(now);
                if (queue.nextDispatchMicros < 0 || next < queue.nextDispatchMicros) {
                    queue.nextDispatchMicros = next;
                    scheduler.schedule(next, EventType.QUEUE_DISPATCH, null, queue.definition.id());
                }
                return;
            }
            JobState job = queue.waiting.poll();
            if (job == null) return;
            job.accumulatedWaitMicros = Math.addExact(job.accumulatedWaitMicros, now - job.enqueuedMicros);
            job.startedMicros = now;
            job.attempts++;
            job.status = JobStatus.ACTIVE;
            queue.active++;
            long service = ServiceTimeSampler.sample(queue.pool.serviceTime(), seed, job.id + ":" + job.attempts);
            scheduler.schedule(Math.addExact(now, service), EventType.JOB_COMPLETED, job.id, queue.definition.id());
            addTrace(trace, maxTrace, new TraceEvent(now, "JOB_STARTED", job.id,
                    "Attempt " + job.attempts + "; service time " + service + " µs"));
        }
    }

    private static boolean shouldFail(double probability, long seed, String jobId, int attempt) {
        return probability > 0 && DeterministicRandom.stream(seed, "failure:" + jobId + ":" + attempt).nextDouble() < probability;
    }

    private static long retryDelay(RetryPolicy policy, long seed, String jobId, int attempt) {
        if (policy.initialBackoffMicros() == 0) return 1;
        double exponential = policy.initialBackoffMicros() * Math.pow(policy.multiplier(), Math.max(0, attempt - 1));
        long bounded = (long) Math.min(policy.maxBackoffMicros(), Math.min(Long.MAX_VALUE, Math.ceil(exponential)));
        if (policy.jitterFraction() == 0) return Math.max(1, bounded);
        double jitter = 1d - policy.jitterFraction()
                + 2d * policy.jitterFraction() * DeterministicRandom.stream(seed, "retry-jitter:" + jobId + ":" + attempt).nextDouble();
        return Math.max(1, (long) Math.ceil(bounded * jitter));
    }

    private static WorkerOutage findOutage(WorkerPoolDefinition pool, String outageId) {
        return pool.outages().stream().filter(outage -> outage.id().equals(outageId)).findFirst()
                .orElseThrow(() -> new IllegalStateException("worker outage not found: " + outageId));
    }

    private static long nextArrival(WorkloadDefinition workload, long current, DeterministicRandom random) {
        long gap;
        if (workload.arrivals().mode() == ArrivalMode.CONSTANT) {
            gap = Math.max(1L, Math.round(1_000_000d / workload.arrivals().ratePerSecond()));
        } else {
            double u = Math.max(Double.MIN_VALUE, 1d - random.nextDouble());
            gap = Math.max(1L, (long) Math.ceil(-Math.log(u) * 1_000_000d / workload.arrivals().ratePerSecond()));
        }
        return Math.addExact(current, gap);
    }

    private static String jobId(int workloadIndex, WorkloadDefinition workload, long jobNumber) {
        return "w" + workloadIndex + ":" + workload.id() + ":" + jobNumber;
    }

    private static WorkloadRuntime workloadForJob(List<WorkloadRuntime> workloads, String jobId) {
        int separator = jobId.indexOf(':');
        if (separator < 2 || jobId.charAt(0) != 'w') throw new IllegalStateException("invalid job id " + jobId);
        try {
            int index = Integer.parseInt(jobId.substring(1, separator));
            return workloads.get(index);
        } catch (RuntimeException exception) {
            throw new IllegalStateException("workload not found for job " + jobId, exception);
        }
    }

    private static void addTrace(List<TraceEvent> trace, int maxTrace, TraceEvent event) {
        if (trace.size() < maxTrace) trace.add(event);
    }

    private static double mean(List<Long> values) {
        return values.isEmpty() ? 0 : values.stream().mapToLong(Long::longValue).average().orElse(0);
    }

    private static double percentile(List<Long> values, double percentile) {
        if (values.isEmpty()) return 0;
        long[] sorted = values.stream().mapToLong(Long::longValue).sorted().toArray();
        int index = Math.max(0, (int) Math.ceil(percentile * sorted.length) - 1);
        return sorted[index];
    }
}
