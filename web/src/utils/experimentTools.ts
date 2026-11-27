import type { Result, Scenario } from '../types';

export const SAVED_EXPERIMENTS_KEY = 'queueflux_experiments';
export type SavedExperiment = { name: string; scenario: Scenario };
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function nextId(prefix: string, existing: string[]): string {
  const highest = existing.reduce((max, value) => {
    const expectedPrefix = prefix + '-';
    if (!value.startsWith(expectedPrefix)) return max;
    const suffix = value.slice(expectedPrefix.length);
    if (!/^\\d+$/.test(suffix)) return max;
    return Math.max(max, Number(suffix));
  }, 0);
  return prefix + '-' + (highest + 1);
}

export function addQueueToScenario(scenario: Scenario): Scenario {
  return { ...scenario, queues: [...scenario.queues, {
    id: nextId('queue', scenario.queues.map(q => q.id)), maxDepth: 10000, discipline: 'FIFO',
  }] };
}
export function updateQueueInScenario(scenario: Scenario, index: number, patch: Partial<Scenario['queues'][number]>): Scenario {
  return { ...scenario, queues: scenario.queues.map((q, i) => i === index ? { ...q, ...patch } : q) };
}
export function removeQueueFromScenario(scenario: Scenario, index: number): Scenario {
  const removed = scenario.queues[index];
  if (!removed) return scenario;
  return {
    ...scenario,
    queues: scenario.queues.filter((_, i) => i !== index),
    workerPools: scenario.workerPools.filter(p => p.queueId !== removed.id),
    workloads: scenario.workloads.filter(w => w.queueId !== removed.id),
  };
}
export function addWorkerPoolToScenario(scenario: Scenario): Scenario {
  return { ...scenario, workerPools: [...scenario.workerPools, {
    id: nextId('pool', scenario.workerPools.map(p => p.id)),
    queueId: scenario.queues[0]?.id ?? 'queue-1',
    workerCount: 3, concurrencyPerWorker: 1,
    serviceTime: { distribution: 'EXPONENTIAL', constantMicros: 250000, meanMicros: 250000 },
  }] };
}
export function updateWorkerPoolInScenario(scenario: Scenario, index: number, patch: Partial<Scenario['workerPools'][number]>): Scenario {
  return { ...scenario, workerPools: scenario.workerPools.map((p, i) => i === index ? { ...p, ...patch } : p) };
}
export function removeWorkerPoolFromScenario(scenario: Scenario, index: number): Scenario {
  return { ...scenario, workerPools: scenario.workerPools.filter((_, i) => i !== index) };
}
export function addWorkloadToScenario(scenario: Scenario): Scenario {
  return { ...scenario, workloads: [...scenario.workloads, {
    id: nextId('workload', scenario.workloads.map(w => w.id)),
    queueId: scenario.queues[0]?.id ?? 'queue-1',
    startMicros: 0, endMicros: scenario.durationMicros,
    arrivals: { mode: 'POISSON', ratePerSecond: 10 },
  }] };
}
export function updateWorkloadInScenario(scenario: Scenario, index: number, patch: Partial<Scenario['workloads'][number]>): Scenario {
  return { ...scenario, workloads: scenario.workloads.map((w, i) => i === index ? { ...w, ...patch } : w) };
}
export function removeWorkloadFromScenario(scenario: Scenario, index: number): Scenario {
  return { ...scenario, workloads: scenario.workloads.filter((_, i) => i !== index) };
}

export function parseSavedExperiments(raw: string | null): SavedExperiment[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SavedExperiment =>
      !!entry && typeof entry === 'object' && typeof entry.name === 'string' &&
      !!entry.scenario && typeof entry.scenario === 'object');
  } catch { return []; }
}
export function loadSavedExperiments(storage: KeyValueStorage, key = SAVED_EXPERIMENTS_KEY): SavedExperiment[] {
  return parseSavedExperiments(storage.getItem(key));
}
export function persistSavedExperiments(storage: KeyValueStorage, experiments: SavedExperiment[], key = SAVED_EXPERIMENTS_KEY): void {
  storage.setItem(key, JSON.stringify(experiments));
}
export function upsertSavedExperiment(experiments: SavedExperiment[], scenario: Scenario): SavedExperiment[] {
  return [...experiments.filter(saved => saved.name !== scenario.name), { name: scenario.name, scenario }];
}
export function findSavedExperiment(experiments: SavedExperiment[], name: string): SavedExperiment | undefined {
  return experiments.find(saved => saved.name === name);
}
export function removeSavedExperiment(experiments: SavedExperiment[], name: string): SavedExperiment[] {
  return experiments.filter(saved => saved.name !== name);
}

export function serializeScenario(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}
function filenameSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').replace(/-+/g, '-') || 'queueflux';
}
export function scenarioJsonFilename(scenario: Scenario): string {
  return filenameSlug(scenario.name) + '-' + scenario.seed + '.json';
}
export function resultsCsvFilename(scenario: Scenario): string {
  return filenameSlug(scenario.name) + '-results.csv';
}
export type ResultsCsvInput = Pick<Result,
  'scenarioName' | 'seed' | 'throughputPerSecond' | 'p95EndToEndLatencyMicros' |
  'p99EndToEndLatencyMicros' | 'workerUtilization' | 'peakBacklog' |
  'completedJobs' | 'rejectedJobs' | 'deadLetteredJobs' | 'retriedJobs'
>;
function csvCell(value: string | number): string {
  const text = String(value);
  return typeof value === 'string' ? '"' + text.replace(/"/g, '""') + '"' : text;
}
export function buildResultsCsv(result: ResultsCsvInput): string {
  const headers = [
    'scenario', 'seed', 'throughput_jobs_s', 'p95_latency_ms', 'p99_latency_ms',
    'utilization_pct', 'peak_backlog', 'completed', 'rejected', 'dead_lettered', 'retried',
  ];
  const values = [
    result.scenarioName, result.seed, result.throughputPerSecond.toFixed(2),
    (result.p95EndToEndLatencyMicros / 1000).toFixed(2),
    (result.p99EndToEndLatencyMicros / 1000).toFixed(2),
    (result.workerUtilization * 100).toFixed(1), result.peakBacklog,
    result.completedJobs, result.rejectedJobs, result.deadLetteredJobs, result.retriedJobs,
  ];
  return [headers.join(','), values.map(csvCell).join(',')].join('\n');
}
