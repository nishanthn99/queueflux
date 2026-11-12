package io.queueflux.model.scenario;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class ScenarioValidator {
    private ScenarioValidator() {}

    public static void validate(ScenarioDefinition scenario) {
        List<String> errors = validateAll(scenario);
        if (!errors.isEmpty()) throw new IllegalArgumentException(errors.get(0));
    }

    /**
     * Returns every validation problem found in the scenario instead of stopping at the first one.
     * The returned list is deterministic and ordered by validation phase.
     */
    public static List<String> validateAll(ScenarioDefinition scenario) {
        List<String> errors = new ArrayList<>();
        if (scenario == null) {
            errors.add("scenario is required");
            return List.copyOf(errors);
        }

        Set<String> queueIds = new HashSet<>();
        for (QueueDefinition queue : scenario.queues()) {
            if (!queueIds.add(queue.id())) errors.add("duplicate queue id: " + queue.id());
        }

        Set<String> poolIds = new HashSet<>();
        for (WorkerPoolDefinition pool : scenario.workerPools()) {
            if (!poolIds.add(pool.id())) errors.add("duplicate worker pool id: " + pool.id());
            if (!queueIds.contains(pool.queueId())) errors.add("unknown queue for worker pool: " + pool.queueId());
            Set<String> outageIds = new HashSet<>();
            for (WorkerOutage outage : pool.outages()) {
                if (!outageIds.add(outage.id())) errors.add("duplicate worker outage id: " + outage.id());
                if (outage.endMicros() > scenario.durationMicros()) errors.add("worker outage exceeds simulation duration");
            }
        }

        Set<String> workloadIds = new HashSet<>();
        for (WorkloadDefinition workload : scenario.workloads()) {
            if (!workloadIds.add(workload.id())) errors.add("duplicate workload id: " + workload.id());
            if (!queueIds.contains(workload.queueId())) errors.add("unknown queue for workload: " + workload.queueId());
            if (workload.endMicros() > scenario.durationMicros()) errors.add("workload window exceeds simulation duration");
        }

        for (QueueDefinition queue : scenario.queues()) {
            long pools = scenario.workerPools().stream().filter(pool -> pool.queueId().equals(queue.id())).count();
            if (pools != 1) errors.add("exactly one worker pool per queue is currently supported: " + queue.id());
            if (scenario.workloads().stream().noneMatch(workload -> workload.queueId().equals(queue.id()))) {
                errors.add("queue has no workload: " + queue.id());
            }
        }
        return List.copyOf(errors);
    }
}