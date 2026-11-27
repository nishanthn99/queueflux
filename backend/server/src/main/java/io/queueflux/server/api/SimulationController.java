package io.queueflux.server.api;

import io.queueflux.engine.api.*;
import io.queueflux.engine.calibration.TelemetryCalibrator;
import io.queueflux.model.scenario.ScenarioDefinition;
import io.queueflux.server.service.SimulationRunService;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/v1/simulations")
public class SimulationController {
    private final SimulationEngine engine;
    private final SimulationRunService runService;
    private final TelemetryCalibrator calibrator;

    public SimulationController(SimulationEngine engine, SimulationRunService runService,
            TelemetryCalibrator calibrator) {
        this.engine = engine;
        this.runService = runService;
        this.calibrator = calibrator;
    }

    /** Backwards-compatible synchronous endpoint for short experiments. */
    @PostMapping("/run")
    public ResponseEntity<SimulationResult> run(@RequestBody ScenarioDefinition scenario) {
        return ResponseEntity.ok(engine.run(SimulationRequest.defaults(scenario)));
    }

    /** Create a durable asynchronous run; its status and progress survive server restarts. */
    @PostMapping("/runs")
    public ResponseEntity<RunAccepted> submit(
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestHeader(value = "X-Timeout-Millis", required = false, defaultValue = "0") long timeoutMillis,
            @RequestBody ScenarioDefinition scenario) {
        SimulationRunService.SubmitOutcome outcome = runService.submit(scenario, idempotencyKey, timeoutMillis);
        String statusUrl = "/api/v1/simulations/runs/" + outcome.id();
        RunAccepted body = new RunAccepted(outcome.id(), "QUEUED", statusUrl, statusUrl + "/events");
        return outcome.isNew()
                ? ResponseEntity.accepted().location(URI.create(statusUrl)).body(body)
                : ResponseEntity.ok().location(URI.create(statusUrl)).body(body);
    }

    @DeleteMapping("/runs/{id}")
    public ResponseEntity<Void> cancel(@PathVariable UUID id) {
        if (runService.find(id).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "simulation run not found");
        if (!runService.cancel(id)) throw new ResponseStatusException(HttpStatus.CONFLICT, "run is already in a terminal state");
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/runs/{id}")
    public SimulationRunSnapshot getRun(@PathVariable UUID id) {
        return runService.find(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "simulation run not found"));
    }

    /** Lightweight accessor for just the final metrics, avoiding the full snapshot payload. */
    @GetMapping("/runs/{id}/metrics")
    public JsonNode getRunMetrics(@PathVariable UUID id) {
        SimulationRunSnapshot snapshot = runService.find(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "simulation run not found"));
        if (snapshot.result() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "metrics not available until run completes");
        }
        return snapshot.result();
    }

    @GetMapping(value = "/runs/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@PathVariable UUID id) {
        if (runService.find(id).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "simulation run not found");
        return runService.subscribe(id);
    }

    /** Paired-seed style repetitions for measuring stochastic variation. */
    @PostMapping("/compare")
    public SimulationComparison compare(@RequestBody ComparisonRequest request) {
        request.validate();
        ScenarioDefinition base = request.scenario();
        List<SimulationComparison.ReplicationSummary> summaries = new ArrayList<>();
        for (int i = 0; i < request.replications(); i++) {
            long seed = Math.addExact(base.seed(), Math.multiplyExact((long) i, request.seedStride()));
            ScenarioDefinition replicated = new ScenarioDefinition(base.schemaVersion(), base.name(), base.durationMicros(),
                    seed, base.queues(), base.workerPools(), base.workloads());
            SimulationResult result = engine.run(new SimulationRequest(replicated, 250_000, 1_000_000, 0, request.warmUpMicros()));
            // Use post-warmup metrics when warmUp is set, otherwise whole-run metrics
            double throughput = request.warmUpMicros() > 0 ? result.postWarmUpThroughputPerSecond() : result.throughputPerSecond();
            double p95 = request.warmUpMicros() > 0 ? result.postWarmUpP95LatencyMicros() : result.p95EndToEndLatencyMicros();
            double p99 = request.warmUpMicros() > 0 ? result.postWarmUpP99LatencyMicros() : result.p99EndToEndLatencyMicros();
            summaries.add(new SimulationComparison.ReplicationSummary(seed, throughput, p95, p99,
                    result.peakBacklog(), result.rejectedJobs(), result.workerUtilization()));
        }
        double[] throughput = summaries.stream().mapToDouble(SimulationComparison.ReplicationSummary::throughputPerSecond).toArray();
        double[] p95 = summaries.stream().mapToDouble(SimulationComparison.ReplicationSummary::p95LatencyMicros).toArray();
        double[] p99 = summaries.stream().mapToDouble(SimulationComparison.ReplicationSummary::p99LatencyMicros).toArray();
        return new SimulationComparison(request.replications(), request.seedStride(), request.warmUpMicros(),
                mean(throughput), stddev(throughput), mean(p95), stddev(p95),
                mean(p99),
                summaries.stream().mapToLong(SimulationComparison.ReplicationSummary::peakBacklog).average().orElse(0),
                summaries.stream().mapToLong(SimulationComparison.ReplicationSummary::rejectedJobs).average().orElse(0),
                summaries.stream().mapToDouble(SimulationComparison.ReplicationSummary::workerUtilization).average().orElse(0),
                ConfidenceInterval.of("throughputPerSecond", throughput),
                ConfidenceInterval.of("p95LatencyMicros", p95),
                ConfidenceInterval.of("p99LatencyMicros", p99),
                summaries);
    }

    /** Fits calibration parameters from observed telemetry, optionally with a comparison simulation run. */
    @PostMapping("/calibrate")
    public CalibrationReport calibrate(@RequestBody CalibrationRequest request) {
        return calibrator.calibrate(request.queueId(), request.windows(), request.compare(), request.seed());
    }

    private static double mean(double[] values) {
        return java.util.Arrays.stream(values).average().orElse(0);
    }

    private static double stddev(double[] values) {
        double mean = mean(values);
        return Math.sqrt(java.util.Arrays.stream(values).map(value -> Math.pow(value - mean, 2)).average().orElse(0));
    }
}
