package io.queueflux.server.service;

import io.queueflux.engine.api.*;
import io.queueflux.engine.api.SimulationEngine;
import io.queueflux.model.scenario.ScenarioDefinition;
import io.queueflux.model.scenario.ScenarioValidator;
import io.queueflux.server.api.SimulationRunSnapshot;
import io.queueflux.server.persistence.SimulationRunRepository;
import io.queueflux.server.persistence.PendingSimulationRun;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import java.io.IOException;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class SimulationRunService implements ApplicationRunner {
    private final SimulationEngine engine;
    private final SimulationRunRepository repository;
    private final TaskExecutor executor;
    private final Map<UUID, CopyOnWriteArrayList<SseEmitter>> subscribers = new ConcurrentHashMap<>();
    private final Map<UUID, AtomicBoolean> cancellationFlags = new ConcurrentHashMap<>();

    public SimulationRunService(SimulationEngine engine, SimulationRunRepository repository,
            @Qualifier("simulationTaskExecutor") TaskExecutor executor) {
        this.engine = engine;
        this.repository = repository;
        this.executor = executor;
    }

    /** Replays queued/running rows after a single-process restart from virtual time zero. */
    @Override
    public void run(ApplicationArguments arguments) {
        for (PendingSimulationRun pending : repository.findInterrupted()) {
            repository.requeueAfterRestart(pending.id());
            AtomicBoolean cancelled = new AtomicBoolean(false);
            cancellationFlags.put(pending.id(), cancelled);
            try {
                executor.execute(() -> execute(pending.id(), pending.scenario(), cancelled));
            } catch (RuntimeException rejected) {
                cancellationFlags.remove(pending.id());
                repository.markFailed(pending.id(), "Restart recovery could not enqueue this run: " + rejected.getMessage());
            }
        }
    }

    /** Returns (id, isNew=true) for a fresh run, or (id, isNew=false) when the idempotency key already exists. */
    public SubmitOutcome submit(ScenarioDefinition scenario, String idempotencyKey) {
        if (idempotencyKey != null) {
            Optional<SimulationRunSnapshot> existing = repository.findByIdempotencyKey(idempotencyKey);
            if (existing.isPresent()) return new SubmitOutcome(existing.get().id(), false);
        }
        ScenarioValidator.validate(scenario);
        UUID id = UUID.randomUUID();
        AtomicBoolean cancelled = new AtomicBoolean(false);
        cancellationFlags.put(id, cancelled);
        repository.create(id, scenario, idempotencyKey);
        try {
            executor.execute(() -> execute(id, scenario, cancelled));
        } catch (RuntimeException rejected) {
            cancellationFlags.remove(id);
            repository.markFailed(id, "Simulation executor is full or shutting down: " + rejected.getMessage());
            throw new IllegalStateException("simulation executor cannot accept another run", rejected);
        }
        return new SubmitOutcome(id, true);
    }

    /**
     * Cancels a run. QUEUED runs are cancelled immediately; RUNNING runs stop at the
     * engine's next event boundary. Returns false if the run is already in a terminal state.
     */
    public boolean cancel(UUID id) {
        AtomicBoolean flag = cancellationFlags.get(id);
        if (flag != null) flag.set(true);
        return repository.markCancelled(id);
    }

    public Optional<SimulationRunSnapshot> find(UUID id) {
        return repository.find(id);
    }

    public SseEmitter subscribe(UUID id) {
        SseEmitter emitter = new SseEmitter(0L);
        CopyOnWriteArrayList<SseEmitter> listeners = subscribers.computeIfAbsent(id, ignored -> new CopyOnWriteArrayList<>());
        listeners.add(emitter);
        emitter.onCompletion(() -> remove(id, emitter));
        emitter.onTimeout(() -> remove(id, emitter));
        emitter.onError(ignored -> remove(id, emitter));
        repository.find(id).ifPresent(snapshot -> {
            send(emitter, "snapshot", snapshot);
            if (isTerminal(snapshot.status())) {
                remove(id, emitter);
                emitter.complete();
            }
        });
        return emitter;
    }

    private void execute(UUID id, ScenarioDefinition scenario, AtomicBoolean cancelled) {
        try {
            if (!repository.markRunning(id)) return; // cancelled before executor picked it up
            publish(id, "status", Map.of("status", "RUNNING"));
            SimulationObserver observer = new SimulationObserver() {
                @Override public void onProgress(SimulationProgress p) {
                    repository.updateProgress(id, p);
                    publish(id, "progress", p);
                }
                @Override public boolean isCancelled() { return cancelled.get(); }
            };
            SimulationResult result = engine.run(SimulationRequest.defaults(scenario), observer);
            repository.markCompleted(id, result);
            repository.find(id).ifPresent(snapshot -> publish(id, "completed", snapshot));
        } catch (CancellationException ignored) {
            repository.markCancelled(id);
            repository.find(id).ifPresent(snapshot -> publish(id, "cancelled", snapshot));
        } catch (RuntimeException exception) {
            repository.markFailed(id, exception.getMessage());
            repository.find(id).ifPresent(snapshot -> publish(id, "failed", snapshot));
        } finally {
            cancellationFlags.remove(id);
            completeListeners(id);
        }
    }

    private void publish(UUID id, String event, Object payload) {
        CopyOnWriteArrayList<SseEmitter> listeners = subscribers.get(id);
        if (listeners == null) return;
        for (SseEmitter emitter : listeners) {
            try { send(emitter, event, payload); }
            catch (RuntimeException exception) { remove(id, emitter); }
        }
    }

    private void send(SseEmitter emitter, String event, Object payload) {
        try { emitter.send(SseEmitter.event().name(event).data(payload, MediaType.APPLICATION_JSON)); }
        catch (IOException exception) { throw new IllegalStateException("could not publish run event", exception); }
    }

    private void remove(UUID id, SseEmitter emitter) {
        CopyOnWriteArrayList<SseEmitter> listeners = subscribers.get(id);
        if (listeners != null) {
            listeners.remove(emitter);
            if (listeners.isEmpty()) subscribers.remove(id, listeners);
        }
    }

    private void completeListeners(UUID id) {
        CopyOnWriteArrayList<SseEmitter> listeners = subscribers.remove(id);
        if (listeners != null) listeners.forEach(SseEmitter::complete);
    }

    private boolean isTerminal(String status) {
        return "COMPLETED".equals(status) || "FAILED".equals(status) || "CANCELLED".equals(status);
    }

    public record SubmitOutcome(UUID id, boolean isNew) {}
}
