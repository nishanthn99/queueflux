package io.queueflux.server.persistence;

import io.queueflux.model.scenario.ScenarioDefinition;
import java.util.UUID;

public record PendingSimulationRun(UUID id, ScenarioDefinition scenario, long timeoutMillis) {}
