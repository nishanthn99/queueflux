package io.queueflux.server.api;

import io.queueflux.engine.api.SimulationEngine;
import io.queueflux.engine.calibration.TelemetryCalibrator;
import io.queueflux.server.service.SimulationRunService;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(SimulationController.class)
class SimulationControllerMetricsTest {

    @Autowired MockMvc mvc;

    @MockitoBean SimulationEngine engine;
    @MockitoBean SimulationRunService runService;
    @MockitoBean TelemetryCalibrator calibrator;

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void returnsMetricsForCompletedRun() throws Exception {
        UUID id = UUID.randomUUID();
        var result = JSON.readTree("{\"throughputPerSecond\":42.5,\"peakBacklog\":7}");
        when(runService.find(id)).thenReturn(Optional.of(snapshot(id, "COMPLETED", result)));

        mvc.perform(get("/api/v1/simulations/runs/{id}/metrics", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.throughputPerSecond").value(42.5))
                .andExpect(jsonPath("$.peakBacklog").value(7));
    }

    @Test
    void returns404ForUnknownRun() throws Exception {
        UUID id = UUID.randomUUID();
        when(runService.find(id)).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/simulations/runs/{id}/metrics", id))
                .andExpect(status().isNotFound());
    }

    @Test
    void returns409WhenRunNotYetCompleted() throws Exception {
        UUID id = UUID.randomUUID();
        when(runService.find(id)).thenReturn(Optional.of(snapshot(id, "RUNNING", null)));

        mvc.perform(get("/api/v1/simulations/runs/{id}/metrics", id))
                .andExpect(status().isConflict());
    }

    private SimulationRunSnapshot snapshot(UUID id, String status, tools.jackson.databind.JsonNode result) {
        return new SimulationRunSnapshot(id, status, "scn", 42L,
                Instant.now(), null, 0L, 0L, 0L, null, result, null);
    }
}
