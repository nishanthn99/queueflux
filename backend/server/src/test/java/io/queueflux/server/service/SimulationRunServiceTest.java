package io.queueflux.server.service;

import io.queueflux.engine.api.*;
import io.queueflux.model.scenario.*;
import io.queueflux.server.api.SimulationRunSnapshot;
import io.queueflux.server.persistence.SimulationRunRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.task.SyncTaskExecutor;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SimulationRunServiceTest {

    @Mock SimulationEngine engine;
    @Mock SimulationRunRepository repository;

    ScheduledExecutorService scheduler;
    SimulationRunService service;

    ScenarioDefinition scenario;

    @BeforeEach
    void setUp() {
        scheduler = Executors.newSingleThreadScheduledExecutor();
        service = new SimulationRunService(engine, repository, new SyncTaskExecutor(), scheduler);
        scenario = new ScenarioDefinition(1, "test-scenario", 60_000_000L, 42L,
                List.of(new QueueDefinition("q1", 100, SchedulingDiscipline.FIFO)),
                List.of(new WorkerPoolDefinition("w1", "q1", 1, 1, ServiceTimeModel.constant(1000), 0, List.of())),
                List.of(new WorkloadDefinition("load1", "q1", 0L, 60_000_000L, ArrivalModel.constantRate(1.0))));
    }

    @Test
    void submitWithoutTimeoutCompletesNormally() {
        SimulationResult result = mock(SimulationResult.class);
        doNothing().when(repository).create(any(), any(), any(), anyLong());
        when(repository.markRunning(any())).thenReturn(true);
        when(engine.run(any(SimulationRequest.class), any())).thenReturn(result);
        doAnswer(inv -> {
            UUID id = inv.getArgument(0);
            when(repository.find(id)).thenReturn(Optional.of(snapshot(id, "COMPLETED")));
            return null;
        }).when(repository).markCompleted(any(), any());

        SimulationRunService.SubmitOutcome outcome = service.submit(scenario, null, 0);

        assertThat(outcome.isNew()).isTrue();
        verify(repository).markCompleted(any(), eq(result));
    }

    @Test
    void idempotencyKeyReturnsExistingRunWithoutCreatingNew() {
        UUID existingId = UUID.randomUUID();
        when(repository.findByIdempotencyKey("key-abc")).thenReturn(Optional.of(snapshot(existingId, "RUNNING")));

        SimulationRunService.SubmitOutcome outcome = service.submit(scenario, "key-abc", 0);

        assertThat(outcome.isNew()).isFalse();
        assertThat(outcome.id()).isEqualTo(existingId);
        verify(repository, never()).create(any(), any(), any(), anyLong());
        verify(engine, never()).run(any(), any());
    }

    @Test
    void cancelBeforeExecutionPreventsEngineRun() {
        doNothing().when(repository).create(any(), any(), any(), anyLong());
        when(repository.markRunning(any())).thenReturn(false);

        service.submit(scenario, null, 0);

        verify(engine, never()).run(any(), any());
    }

    @Test
    void cancelWhileRunningIsIdempotentAndStopsEngine() {
        doNothing().when(repository).create(any(), any(), any(), anyLong());
        when(repository.markRunning(any())).thenReturn(true);
        doAnswer(inv -> {
            UUID id = inv.getArgument(0);
            when(repository.find(id)).thenReturn(Optional.of(snapshot(id, "CANCELLED")));
            return true;
        }).when(repository).markCancelled(any());
        when(engine.run(any(SimulationRequest.class), any())).thenThrow(new java.util.concurrent.CancellationException("cancelled"));

        service.submit(scenario, null, 0);

        verify(repository).markCancelled(any());
        verify(repository, never()).markCompleted(any(), any());
    }

    @Test
    void cancelAlreadyTerminalReturnsFalse() {
        UUID id = UUID.randomUUID();
        when(repository.markCancelled(id)).thenReturn(false); // already terminal

        boolean result = service.cancel(id);

        assertThat(result).isFalse();
    }

    @Test
    void findReturnsRepositoryResult() {
        UUID id = UUID.randomUUID();
        when(repository.find(id)).thenReturn(Optional.of(snapshot(id, "QUEUED")));

        Optional<SimulationRunSnapshot> found = service.find(id);

        assertThat(found).isPresent();
        assertThat(found.get().status()).isEqualTo("QUEUED");
    }

    // --- helpers ---

    private SimulationRunSnapshot snapshot(UUID id, String status) {
        return new SimulationRunSnapshot(id, status, "test-scenario", 42L,
                Instant.now(), null, 0L, 0L, 0L, null, null, null);
    }
}
