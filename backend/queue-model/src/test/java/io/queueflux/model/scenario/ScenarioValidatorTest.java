package io.queueflux.model.scenario;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScenarioValidatorTest {
    private ScenarioDefinition validScenario(
            List<QueueDefinition> queues,
            List<WorkerPoolDefinition> pools,
            List<WorkloadDefinition> workloads) {
        return new ScenarioDefinition(1, "validator-test", 1_000_000, 42L, queues, pools, workloads);
    }

    private QueueDefinition queue(String id) {
        return new QueueDefinition(id, 10, SchedulingDiscipline.FIFO);
    }

    private WorkerPoolDefinition pool(String id, String queueId, List<WorkerOutage> outages) {
        return new WorkerPoolDefinition(id, queueId, 1, 1, ServiceTimeModel.constant(100), 0, outages);
    }

    private WorkloadDefinition workload(String id, String queueId, long endMicros) {
        return new WorkloadDefinition(id, queueId, 0, endMicros, ArrivalModel.constantRate(1));
    }

    @Test
    void acceptsAValidScenario() {
        var scenario = validScenario(List.of(queue("emails")),
                List.of(pool("email-workers", "emails", List.of())),
                List.of(workload("email-load", "emails", 1_000_000)));
        assertThatCode(() -> ScenarioValidator.validate(scenario)).doesNotThrowAnyException();
    }

    @Test
    void rejectsDuplicateQueueIds() {
        var scenario = validScenario(List.of(queue("emails"), queue("emails")),
                List.of(pool("workers", "emails", List.of())), List.of(workload("load", "emails", 1_000_000)));
        assertThatThrownBy(() -> ScenarioValidator.validate(scenario)).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("duplicate queue id");
    }

    @Test
    void validateAllReportsMultipleIndependentErrors() {
        var scenario = validScenario(
                List.of(queue("emails"), queue("emails"), queue("reports")),
                List.of(pool("workers", "missing", List.of()),
                        pool("workers", "emails", List.of(new WorkerOutage("maintenance", 100, 1_000_001, 1))),
                        pool("report-workers", "reports", List.of())),
                List.of(workload("load", "missing", 1_000_001)));

        assertThat(ScenarioValidator.validateAll(scenario))
                .containsExactly(
                        "duplicate queue id: emails",
                        "duplicate worker pool id: workers",
                        "unknown queue for worker pool: missing",
                        "worker outage exceeds simulation duration",
                        "unknown queue for workload: missing",
                        "workload window exceeds simulation duration");
    }

    @Test
    void validateStillThrowsTheFirstErrorForBackwardCompatibility() {
        var scenario = validScenario(List.of(queue("emails"), queue("emails")),
                List.of(pool("workers", "emails", List.of())), List.of(workload("load", "emails", 1_000_000)));
        assertThatThrownBy(() -> ScenarioValidator.validate(scenario))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("duplicate queue id: emails");
    }
}
