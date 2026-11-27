import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
const scenarioTemplate = JSON.parse(await readFile("examples/constant-load/scenario.json", "utf8"));

async function request(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json")
    ? await response.json()
    : await response.text();
  return { response, payload };
}

function smallScenario(name) {
  const scenario = structuredClone(scenarioTemplate);
  scenario.name = name;
  scenario.durationMicros = 5_000_000;
  scenario.workloads = scenario.workloads.map((workload) => ({
    ...workload,
    endMicros: scenario.durationMicros,
  }));
  return scenario;
}

console.log("1/5 Checking health and PostgreSQL connectivity...");
const health = await request("/actuator/health");
assert.equal(health.response.status, 200);
assert.equal(health.payload.status, "UP");

console.log("2/5 Checking synchronous simulation endpoint...");
const sync = await request("/api/v1/simulations/run", {
  method: "POST",
  body: JSON.stringify(smallScenario("ct-sync-smoke")),
});
assert.equal(sync.response.status, 200);
assert.equal(sync.payload.scenarioName, "ct-sync-smoke");
assert.ok(Number.isFinite(sync.payload.processedEvents) && sync.payload.processedEvents > 0);
assert.ok(Number.isFinite(sync.payload.completedJobs));
assert.ok(Number.isFinite(sync.payload.throughputPerSecond));

console.log("3/5 Checking replicated comparison endpoint...");
const comparison = await request("/api/v1/simulations/compare", {
  method: "POST",
  body: JSON.stringify({
    scenario: smallScenario("ct-comparison"),
    replications: 2,
    seedStride: 10,
    warmUpMicros: 0,
  }),
});
assert.equal(comparison.response.status, 200);
assert.equal(comparison.payload.replications, 2);
assert.equal(comparison.payload.runs.length, 2);
assert.notEqual(comparison.payload.runs[0].seed, comparison.payload.runs[1].seed);
assert.ok(Number.isFinite(comparison.payload.meanThroughputPerSecond));

console.log("4/5 Checking async persistence and idempotency...");
const asyncScenario = smallScenario("ct-async-persistence");
const idempotencyKey = "queueflux-ct-" + Date.now();
const accepted = await request("/api/v1/simulations/runs", {
  method: "POST",
  headers: { "Idempotency-Key": idempotencyKey },
  body: JSON.stringify(asyncScenario),
});
assert.equal(accepted.response.status, 202);
assert.ok(accepted.payload.id);
assert.equal(accepted.payload.status, "QUEUED");

const duplicate = await request("/api/v1/simulations/runs", {
  method: "POST",
  headers: { "Idempotency-Key": idempotencyKey },
  body: JSON.stringify(asyncScenario),
});
assert.equal(duplicate.response.status, 200);
assert.equal(duplicate.payload.id, accepted.payload.id);

let run;
for (let attempt = 0; attempt < 45; attempt++) {
  const status = await request(accepted.payload.statusUrl);
  assert.equal(status.response.status, 200);
  run = status.payload;
  if (run.status === "COMPLETED" || run.status === "FAILED") break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(run?.status, "COMPLETED", `expected COMPLETED, got ${run?.status}: ${run?.errorMessage ?? ""}`);
assert.ok(run.result);
assert.ok(run.processedEvents > 0);

console.log("5/5 Checking missing run returns 404...");
const missing = await request("/api/v1/simulations/runs/00000000-0000-0000-0000-000000000000");
assert.equal(missing.response.status, 404);

console.log("All extended API integration checks passed.");
