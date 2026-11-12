package io.queueflux.server.api;

import io.queueflux.engine.api.*;
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

@RestController
@RequestMapping("/api/v1/simulations")
public class SimulationController {
    private final SimulationEngine engine;
    private final SimulationRunService runService;

    public SimulationController(SimulationEngine engine, SimulationRunService runService) {
        this.engine = engine;
        this.runService = runService;
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
            @RequestBody ScenarioDefinition scenario) {
        SimulationRunService.SubmitOutcome outcome = runService.submit(scenario, idempotencyKey);
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
            SimulationResult result = engine.run(new SimulationRequest(replicated, 250_000, 1_000_000, 0));
            summaries.add(new SimulationComparison.ReplicationSummary(seed, result.throughputPerSecond(),
                    result.p95EndToEndLatencyMicros(), result.p99EndToEndLatencyMicros(), result.peakBacklog(),
                    result.rejectedJobs(), result.workerUtilization()));
        }
        double[] throughput = summaries.stream().mapToDouble(SimulationComparison.ReplicationSummary::throughputPerSecond).toArray();
        double[] p95 = summaries.stream().mapToDouble(SimulationComparison.ReplicationSummary::p95LatencyMicros).toArray();
        return new SimulationComparison(request.replications(), request.seedStride(),
                mean(throughput), stddev(throughput), mean(p95), stddev(p95),
                summaries.stream().mapToDouble(SimulationComparison.ReplicationSummary::p99LatencyMicros).average().orElse(0),
                summaries.stream().mapToLong(SimulationComparison.ReplicationSummary::peakBacklog).average().orElse(0),
                summaries.stream().mapToLong(SimulationComparison.ReplicationSummary::rejectedJobs).average().orElse(0),
                summaries.stream().mapToDouble(SimulationComparison.ReplicationSummary::workerUtilization).average().orElse(0),
                summaries);
    }

    private static double mean(double[] values) {
        return java.util.Arrays.stream(values).average().orElse(0);
    }

    private static double stddev(double[] values) {
        double mean = mean(values);
        return Math.sqrt(java.util.Arrays.stream(values).map(value -> Math.pow(value - mean, 2)).average().orElse(0));
    }
}
