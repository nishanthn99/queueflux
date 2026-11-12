package io.queueflux.server.persistence;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import io.queueflux.engine.api.SimulationProgress;
import io.queueflux.engine.api.SimulationResult;
import io.queueflux.model.scenario.ScenarioDefinition;
import io.queueflux.server.api.SimulationRunSnapshot;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SimulationRunRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public SimulationRunRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public void create(UUID id, ScenarioDefinition scenario, String idempotencyKey) {
        jdbc.update("""
                INSERT INTO simulation_runs
                (id, status, scenario_name, seed, submitted_at, scenario_json, virtual_time_micros, processed_events, idempotency_key)
                VALUES (?, 'QUEUED', ?, ?, ?, CAST(? AS JSONB), 0, 0, ?)
                """, id, scenario.name(), scenario.seed(), Timestamp.from(Instant.now()), toJson(scenario), idempotencyKey);
    }

    public boolean markRunning(UUID id) {
        return jdbc.update("UPDATE simulation_runs SET status='RUNNING', error_message=NULL WHERE id=? AND status='QUEUED'", id) > 0;
    }

    public void updateProgress(UUID id, SimulationProgress progress) {
        jdbc.update("""
                UPDATE simulation_runs SET virtual_time_micros=?, processed_events=?
                WHERE id=? AND status='RUNNING'
                """, progress.virtualTimeMicros(), progress.processedEvents(), id);
    }

    public void markCompleted(UUID id, SimulationResult result) {
        jdbc.update("""
                UPDATE simulation_runs SET status='COMPLETED', completed_at=?, result_json=CAST(? AS JSONB), error_message=NULL,
                virtual_time_micros=?, processed_events=? WHERE id=?
                """, Timestamp.from(Instant.now()), toJson(result), result.simulationDurationMicros(), result.processedEvents(), id);
    }

    public void markFailed(UUID id, String message) {
        jdbc.update("""
                UPDATE simulation_runs SET status='FAILED', completed_at=?, error_message=? WHERE id=?
                """, Timestamp.from(Instant.now()), safeMessage(message), id);
    }

    public Optional<SimulationRunSnapshot> find(UUID id) {
        List<SimulationRunSnapshot> results = jdbc.query("""
                SELECT id, status, scenario_name, seed, submitted_at, completed_at,
                       virtual_time_micros, processed_events, scenario_json::text, result_json::text, error_message
                FROM simulation_runs WHERE id=?
                """, (rs, row) -> new SimulationRunSnapshot(
                rs.getObject("id", UUID.class),
                rs.getString("status"),
                rs.getString("scenario_name"),
                rs.getLong("seed"),
                rs.getTimestamp("submitted_at").toInstant(),
                rs.getTimestamp("completed_at") == null ? null : rs.getTimestamp("completed_at").toInstant(),
                rs.getLong("virtual_time_micros"),
                rs.getLong("processed_events"),
                readJson(rs.getString("scenario_json")),
                readJson(rs.getString("result_json")),
                rs.getString("error_message")), id);
        return results.stream().findFirst();
    }

    public boolean markCancelled(UUID id) {
        return jdbc.update("""
                UPDATE simulation_runs SET status='CANCELLED', completed_at=?
                WHERE id=? AND status IN ('QUEUED', 'RUNNING')
                """, Timestamp.from(Instant.now()), id) > 0;
    }

    public Optional<SimulationRunSnapshot> findByIdempotencyKey(String key) {
        List<SimulationRunSnapshot> results = jdbc.query("""
                SELECT id, status, scenario_name, seed, submitted_at, completed_at,
                       virtual_time_micros, processed_events, scenario_json::text, result_json::text, error_message
                FROM simulation_runs WHERE idempotency_key=?
                """, (rs, row) -> new SimulationRunSnapshot(
                rs.getObject("id", UUID.class),
                rs.getString("status"),
                rs.getString("scenario_name"),
                rs.getLong("seed"),
                rs.getTimestamp("submitted_at").toInstant(),
                rs.getTimestamp("completed_at") == null ? null : rs.getTimestamp("completed_at").toInstant(),
                rs.getLong("virtual_time_micros"),
                rs.getLong("processed_events"),
                readJson(rs.getString("scenario_json")),
                readJson(rs.getString("result_json")),
                rs.getString("error_message")), key);
        return results.stream().findFirst();
    }

    public List<PendingSimulationRun> findInterrupted() {
        return jdbc.query("""
                SELECT id, scenario_json::text FROM simulation_runs
                WHERE status IN ('QUEUED', 'RUNNING') ORDER BY submitted_at ASC
                """, (rs, row) -> {
            try {
                return new PendingSimulationRun(rs.getObject("id", UUID.class),
                        mapper.readValue(rs.getString("scenario_json"), ScenarioDefinition.class));
            } catch (JacksonException exception) {
                throw new IllegalStateException("could not read a persisted scenario for restart recovery", exception);
            }
        });
    }

    public void requeueAfterRestart(UUID id) {
        jdbc.update("""
                UPDATE simulation_runs SET status='QUEUED', completed_at=NULL, result_json=NULL,
                error_message=NULL,
                virtual_time_micros=0, processed_events=0
                WHERE id=? AND status IN ('QUEUED', 'RUNNING')
                """, id);
    }

    private String toJson(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (JacksonException exception) { throw new IllegalStateException("could not serialize simulation data", exception); }
    }

    private JsonNode readJson(String value) {
        if (value == null) return null;
        try { return mapper.readTree(value); }
        catch (JacksonException exception) { throw new IllegalStateException("stored simulation JSON is invalid", exception); }
    }

    private String safeMessage(String value) {
        if (value == null || value.isBlank()) return "Simulation failed without an error message";
        return value.length() > 2000 ? value.substring(0, 2000) : value;
    }
}
