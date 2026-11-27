import { describe, expect, it } from 'vitest';
import type { Scenario } from '../types';
import {
  addQueueToScenario, removeQueueFromScenario, addWorkerPoolToScenario,
  removeWorkerPoolFromScenario, addWorkloadToScenario, removeWorkloadFromScenario,
  updateQueueInScenario, updateWorkerPoolInScenario, updateWorkloadInScenario,
  loadSavedExperiments, persistSavedExperiments, upsertSavedExperiment,
  findSavedExperiment, removeSavedExperiment, parseSavedExperiments,
  serializeScenario, scenarioJsonFilename, resultsCsvFilename, buildResultsCsv,
} from './experimentTools';

const scenario: Scenario = {
  schemaVersion: 1, name: 'Builder Test', durationMicros: 2_000_000, seed: 42,
  queues: [{ id: 'queue-1', maxDepth: 100, discipline: 'FIFO' }],
  workerPools: [{
    id: 'pool-1', queueId: 'queue-1', workerCount: 2, concurrencyPerWorker: 1,
    serviceTime: { distribution: 'EXPONENTIAL', constantMicros: 1000, meanMicros: 1000 },
  }],
  workloads: [{
    id: 'workload-1', queueId: 'queue-1', startMicros: 0, endMicros: 2_000_000,
    arrivals: { mode: 'POISSON', ratePerSecond: 5 },
  }],
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('scenario builder operations', () => {
  it('adds unique queue, pool and workload IDs and associates new items with a queue', () => {
    const withQueue = addQueueToScenario(scenario);
    expect(withQueue.queues.map(q => q.id)).toEqual(['queue-1', 'queue-2']);

    const withPool = addWorkerPoolToScenario(withQueue);
    expect(withPool.workerPools.at(-1)).toMatchObject({ id: 'pool-2', queueId: 'queue-1' });

    const withWorkload = addWorkloadToScenario(withPool);
    expect(withWorkload.workloads.at(-1)).toMatchObject({
      id: 'workload-2', queueId: 'queue-1', endMicros: scenario.durationMicros,
    });
  });

  it('generates IDs without collisions after deletions', () => {
    const withTwo = addQueueToScenario(addQueueToScenario(scenario));
    const afterRemove = removeQueueFromScenario(withTwo, 0);
    expect(addQueueToScenario(afterRemove).queues.map(q => q.id)).toEqual(['queue-2', 'queue-3']);
  });

  it('removing a queue also removes its linked worker pools and workloads', () => {
    const withSecondQueue = addQueueToScenario(scenario);
    const withSecondPool = updateWorkerPoolInScenario(
      addWorkerPoolToScenario(withSecondQueue), 1, { queueId: 'queue-2' },
    );
    const withSecondWorkload = updateWorkloadInScenario(
      addWorkloadToScenario(withSecondPool), 1, { queueId: 'queue-2' },
    );
    const result = removeQueueFromScenario(withSecondWorkload, 1);

    expect(result.queues.map(q => q.id)).toEqual(['queue-1']);
    expect(result.workerPools.every(pool => pool.queueId === 'queue-1')).toBe(true);
    expect(result.workloads.every(workload => workload.queueId === 'queue-1')).toBe(true);
  });

  it('updates and removes queue, pool and workload records', () => {
    expect(updateQueueInScenario(scenario, 0, { maxDepth: 250 }).queues[0].maxDepth).toBe(250);
    const updatedPool = updateWorkerPoolInScenario(scenario, 0, { workerCount: 7 });
    expect(updatedPool.workerPools[0].workerCount).toBe(7);
    expect(removeWorkerPoolFromScenario(updatedPool, 0).workerPools).toHaveLength(0);
    const updatedWorkload = updateWorkloadInScenario(scenario, 0, { priority: 9 });
    expect(updatedWorkload.workloads[0].priority).toBe(9);
    expect(removeWorkloadFromScenario(updatedWorkload, 0).workloads).toHaveLength(0);
  });
});

describe('saved experiment lifecycle', () => {
  it('saves, reloads, replaces by name and deletes experiments from storage', () => {
    const storage = memoryStorage();
    const first = upsertSavedExperiment(loadSavedExperiments(storage), scenario);
    persistSavedExperiments(storage, first);
    expect(loadSavedExperiments(storage)).toEqual(first);
    expect(findSavedExperiment(first, 'Builder Test')?.scenario.seed).toBe(42);

    const changed = { ...scenario, seed: 99 };
    const replaced = upsertSavedExperiment(first, changed);
    expect(replaced).toHaveLength(1);
    expect(findSavedExperiment(replaced, 'Builder Test')?.scenario.seed).toBe(99);

    const deleted = removeSavedExperiment(replaced, 'Builder Test');
    persistSavedExperiments(storage, deleted);
    expect(loadSavedExperiments(storage)).toEqual([]);
  });

  it('handles malformed or unexpected local-storage payloads safely', () => {
    expect(parseSavedExperiments('{not-json')).toEqual([]);
    expect(parseSavedExperiments('{"not":"an array"}')).toEqual([]);
  });
});

describe('scenario JSON and result CSV exports', () => {
  it('serializes a valid scenario and generates a stable JSON filename', () => {
    expect(JSON.parse(serializeScenario(scenario))).toEqual(scenario);
    expect(scenarioJsonFilename(scenario)).toBe('builder-test-42.json');
  });

  it('exports result metrics to CSV and escapes embedded quotes/commas', () => {
    const csv = buildResultsCsv({
      scenarioName: 'Email "priority", batch', seed: 42,
      throughputPerSecond: 12.345, p95EndToEndLatencyMicros: 2500,
      p99EndToEndLatencyMicros: 5000, workerUtilization: 0.75,
      peakBacklog: 10, completedJobs: 20, rejectedJobs: 2,
      deadLetteredJobs: 1, retriedJobs: 3,
    });
    const [header, row] = csv.split('\\n');
    expect(header).toContain('throughput_jobs_s');
    expect(row).toContain('"Email ""priority"", batch"');
    expect(row).toContain('12.35');
    expect(row).toContain('2.50');
    expect(resultsCsvFilename(scenario)).toBe('builder-test-results.csv');
  });
});
