import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, ArrowUpRight, Clock3, Download, Gauge, Play, Plus, RotateCcw, Save, Server, Trash2, Zap } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Result, Scenario } from './types';
import { buildChartData, formatMetric, parseScenarioJson } from './utils/simulation';
import {
  addQueueToScenario, removeQueueFromScenario, updateQueueInScenario,
  addWorkerPoolToScenario, removeWorkerPoolFromScenario, updateWorkerPoolInScenario,
  addWorkloadToScenario, removeWorkloadFromScenario, updateWorkloadInScenario,
  loadSavedExperiments, persistSavedExperiments, upsertSavedExperiment,
  findSavedExperiment, removeSavedExperiment, serializeScenario,
  scenarioJsonFilename, resultsCsvFilename, buildResultsCsv,
} from './utils/experimentTools';

const T_CRIT_5 = 2.776;
function triggerDownload(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

const PRESETS: { label: string; tag: string; scenario: Scenario }[] = [
  {
    label: 'Email', tag: '20/s · 5w',
    scenario: {
      schemaVersion: 1, name: 'Email notification workload', durationMicros: 60_000_000, seed: 12345,
      queues: [{ id: 'email-queue', maxDepth: 5000, discipline: 'FIFO' }],
      workerPools: [{ id: 'email-workers', queueId: 'email-queue', workerCount: 5, concurrencyPerWorker: 1, serviceTime: { distribution: 'EXPONENTIAL', constantMicros: 250000, meanMicros: 250000 } }],
      workloads: [{ id: 'email-arrivals', queueId: 'email-queue', startMicros: 0, endMicros: 60_000_000, arrivals: { mode: 'POISSON', ratePerSecond: 20 } }],
    },
  },
  {
    label: 'API Gateway', tag: '100/s · 10w',
    scenario: {
      schemaVersion: 1, name: 'API gateway traffic', durationMicros: 60_000_000, seed: 99001,
      queues: [{ id: 'request-queue', maxDepth: 20000, discipline: 'FIFO', rateLimit: { ratePerSecond: 90, burstCapacity: 150 } }],
      workerPools: [{ id: 'api-workers', queueId: 'request-queue', workerCount: 10, concurrencyPerWorker: 4, serviceTime: { distribution: 'EXPONENTIAL', constantMicros: 50000, meanMicros: 50000 } }],
      workloads: [{ id: 'api-traffic', queueId: 'request-queue', startMicros: 0, endMicros: 60_000_000, arrivals: { mode: 'POISSON', ratePerSecond: 100 } }],
    },
  },
  {
    label: 'Report Pipeline', tag: '2/s · 3w',
    scenario: {
      schemaVersion: 1, name: 'Report generation pipeline', durationMicros: 120_000_000, seed: 55123,
      queues: [
        { id: 'report-queue', maxDepth: 500, discipline: 'PRIORITY', retryPolicy: { maxAttempts: 3, initialBackoffMicros: 2_000_000, maxBackoffMicros: 60_000_000, multiplier: 2, jitterFraction: 0.2 } },
      ],
      workerPools: [{ id: 'report-workers', queueId: 'report-queue', workerCount: 3, concurrencyPerWorker: 1, serviceTime: { distribution: 'LOGNORMAL', constantMicros: 5_000_000, meanMicros: 5_000_000, stdDevMicros: 2_000_000 }, failureProbability: 0.05 }],
      workloads: [
        { id: 'standard-reports', queueId: 'report-queue', startMicros: 0, endMicros: 120_000_000, priority: 1, arrivals: { mode: 'POISSON', ratePerSecond: 1.5 } },
        { id: 'priority-reports', queueId: 'report-queue', startMicros: 0, endMicros: 120_000_000, priority: 10, arrivals: { mode: 'POISSON', ratePerSecond: 0.5 } },
      ],
    },
  },
  {
    label: 'Payment Processing', tag: '50/s · 8w',
    scenario: {
      schemaVersion: 1, name: 'Payment processing system', durationMicros: 60_000_000, seed: 77442,
      queues: [
        { id: 'payment-queue', maxDepth: 10000, discipline: 'FIFO', retryPolicy: { maxAttempts: 5, initialBackoffMicros: 500_000, maxBackoffMicros: 30_000_000, multiplier: 2, jitterFraction: 0.15 } },
      ],
      workerPools: [{ id: 'payment-workers', queueId: 'payment-queue', workerCount: 8, concurrencyPerWorker: 1, serviceTime: { distribution: 'EXPONENTIAL', constantMicros: 100_000, meanMicros: 100_000 }, failureProbability: 0.02, outages: [{ id: 'gateway-blip', startMicros: 25_000_000, endMicros: 28_000_000, unavailableWorkers: 3 }] }],
      workloads: [{ id: 'payment-traffic', queueId: 'payment-queue', startMicros: 0, endMicros: 60_000_000, arrivals: { mode: 'POISSON', ratePerSecond: 50 } }],
    },
  },
];

const initial: Scenario = PRESETS[0].scenario;
const fmt = formatMetric;

export default function App() {
  const [scenario, setScenario] = useState(initial);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scenarioJson, setScenarioJson] = useState(() => serializeScenario(initial));
  const [jsonError, setJsonError] = useState('');
  const [progress, setProgress] = useState('');
  const [comparison, setComparison] = useState<import('./types').ComparisonResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [mode, setMode] = useState<'quick' | 'build' | 'json'>('quick');
  const [saved, setSaved] = useState(() => loadSavedExperiments(localStorage));
  const [expandedQueues, setExpandedQueues] = useState<Set<number>>(new Set([0]));
  const [expandedPools, setExpandedPools] = useState<Set<number>>(new Set([0]));
  const [expandedWorkloads, setExpandedWorkloads] = useState<Set<number>>(new Set([0]));

  const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
  const chartData = useMemo(() => result ? buildChartData(result.trace) : [], [result]);
  const queueIds = scenario.queues.map(q => q.id);

  // — Scenario mutations —
  function patch(p: Partial<Scenario>) { setScenario(s => ({ ...s, ...p })); }

  function setQueue(idx: number, p: Partial<Scenario['queues'][number]>) {
    setScenario(s => updateQueueInScenario(s, idx, p));
  }

  function addQueue() {
    const n = scenario.queues.length;
    setScenario(s => addQueueToScenario(s));
    setExpandedQueues(e => new Set([...e, n]));
  }

  function removeQueue(idx: number) {
    setScenario(s => removeQueueFromScenario(s, idx));
  }

  function setPool(idx: number, p: Partial<Scenario['workerPools'][number]>) {
    setScenario(s => updateWorkerPoolInScenario(s, idx, p));
  }

  function addPool() {
    const n = scenario.workerPools.length;
    setScenario(s => addWorkerPoolToScenario(s));
    setExpandedPools(e => new Set([...e, n]));
  }

  function removePool(idx: number) {
    setScenario(s => removeWorkerPoolFromScenario(s, idx));
  }

  function setWorkload(idx: number, p: Partial<Scenario['workloads'][number]>) {
    setScenario(s => updateWorkloadInScenario(s, idx, p));
  }

  function addWorkload() {
    const n = scenario.workloads.length;
    setScenario(s => addWorkloadToScenario(s));
    setExpandedWorkloads(e => new Set([...e, n]));
  }

  function removeWorkload(idx: number) {
    setScenario(s => removeWorkloadFromScenario(s, idx));
  }

  function toggleExpand(set: Set<number>, setFn: (s: Set<number>) => void, idx: number) {
    const next = new Set(set);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setFn(next);
  }

  // Quick-mode compat helpers (single queue/pool/workload)
  function quickUpdatePool(p: Partial<Scenario['workerPools'][number]>) { setPool(0, p); }
  function quickUpdateWorkload(p: Partial<Scenario['workloads'][number]['arrivals']>) {
    setScenario(s => ({ ...s, workloads: [{ ...s.workloads[0], arrivals: { ...s.workloads[0].arrivals, ...p } }] }));
  }

  // — Saved experiments —
  function saveExperiment() {
    const updated = upsertSavedExperiment(saved, scenario);
    setSaved(updated);
    persistSavedExperiments(localStorage, updated);
  }

  function loadExperiment(name: string) {
    const exp = findSavedExperiment(saved, name);
    if (exp) {
      setScenario(exp.scenario);
      setScenarioJson(serializeScenario(exp.scenario));
      setResult(null);
      setError('');
    }
  }

  function deleteExperiment(name: string) {
    const updated = removeSavedExperiment(saved, name);
    setSaved(updated);
    persistSavedExperiments(localStorage, updated);
  }

  // — Exports —
  function downloadScenarioJson() {
    triggerDownload(serializeScenario(scenario), scenarioJsonFilename(scenario), 'application/json');
  }

  function downloadResultsCsv() {
    if (!result) return;
    triggerDownload(buildResultsCsv(result), resultsCsvFilename(scenario), 'text/csv');
  }

  // — Run / Compare —
  async function runSimulation() {
    // Field validation before submit
    const emptyIds = [
      ...scenario.queues.filter(q => !q.id.trim()).map((_, i) => `Queue ${i + 1} ID`),
      ...scenario.workerPools.filter(p => !p.id.trim()).map((_, i) => `Pool ${i + 1} ID`),
      ...scenario.workloads.filter(w => !w.id.trim()).map((_, i) => `Workload ${i + 1} ID`),
    ];
    if (emptyIds.length) { setError(`Empty required fields: ${emptyIds.join(', ')}`); return; }

    setLoading(true); setError(''); setProgress('Submitting durable simulation run…'); setResult(null);
    // Keep JSON in sync with current scenario
    setScenarioJson(serializeScenario(scenario));
    try {
      const response = await fetch(`${apiUrl}/api/v1/simulations/runs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scenario),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? `Simulation submission failed (${response.status})`);
      }
      const accepted = await response.json() as { id: string };
      while (true) {
        await new Promise(resolve => window.setTimeout(resolve, 500));
        const statusResponse = await fetch(`${apiUrl}/api/v1/simulations/runs/${accepted.id}`);
        if (!statusResponse.ok) throw new Error(`Could not read simulation status (${statusResponse.status})`);
        const run = await statusResponse.json() as import('./types').RunSnapshot;
        setProgress(`${run.status} · ${fmt(run.processedEvents)} events · virtual time ${fmt(run.virtualTimeMicros / 1_000_000)}s`);
        if (run.status === 'COMPLETED') {
          if (!run.result) throw new Error('Run completed without a result payload.');
          setResult(run.result); break;
        }
        if (run.status === 'FAILED') throw new Error(run.errorMessage ?? 'Simulation failed.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reach the QueueFlux API.');
    } finally { setLoading(false); }
  }

  async function compareSeeds() {
    setComparing(true); setComparison(null); setError('');
    try {
      const response = await fetch(`${apiUrl}/api/v1/simulations/compare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, replications: 5, seedStride: 10000 }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? `Comparison failed (${response.status})`);
      }
      setComparison(await response.json() as import('./types').ComparisonResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not complete the replicated comparison.');
    } finally { setComparing(false); }
  }

  function applyScenarioJson() {
    try {
      const parsed = parseScenarioJson(scenarioJson);
      setScenario(parsed); setJsonError(''); setResult(null);
    } catch (reason) {
      setJsonError(reason instanceof Error ? reason.message : 'Invalid JSON scenario.');
    }
  }

  // — Render —
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Activity size={19} /></div>
          <span>queue<span className="brand-accent">flux</span></span>
          <span className="version">LAB / 0.1</span>
        </div>
        <div className="top-meta"><span className="live-dot" /> LOCAL EXPERIMENT</div>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> DISCRETE-EVENT WORKLOAD LAB</div>
          <h1>Find the breaking point.<br /><em>Before production does.</em></h1>
          <p className="hero-copy">Design a workload, tune worker capacity, and see how your queue behaves under pressure — with repeatable, seeded experiments.</p>
        </div>
        <div className="hero-stamp">
          <div className="stamp-orbit"><Zap size={25} /></div>
          <span>VIRTUAL TIME</span>
          <strong>NO SLEEP. JUST EVENTS.</strong>
        </div>
      </section>

      <div className="workspace">
        {/* ── LEFT PANEL ── */}
        <section className="panel config-panel">
          <div className="panel-head">
            <div>
              <div className="section-kicker">01 / EXPERIMENT SETUP</div>
              <h2>Configure workload</h2>
            </div>
            <button className="icon-button" title="Reset defaults" onClick={() => { setScenario(initial); setScenarioJson(serializeScenario(initial)); setResult(null); setError(''); }}>
              <RotateCcw size={16} />
            </button>
          </div>

          {/* Template presets */}
          <div className="preset-strip">
            {PRESETS.map(p => (
              <button key={p.label}
                className={`preset-chip${scenario.name === p.scenario.name ? ' active' : ''}`}
                onClick={() => { setScenario(p.scenario); setScenarioJson(serializeScenario(p.scenario)); setResult(null); setError(''); }}>
                <span className="preset-label">{p.label}</span>
                <span className="preset-tag">{p.tag}</span>
              </button>
            ))}
          </div>

          {/* Mode tabs */}
          <div className="mode-tabs">
            {(['quick', 'build', 'json'] as const).map(m => (
              <button key={m} className={`mode-tab${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
                {m === 'quick' ? 'QUICK' : m === 'build' ? 'BUILDER' : 'JSON'}
              </button>
            ))}
          </div>

          {/* ── QUICK MODE ── */}
          {mode === 'quick' && <>
            <label className="field-label">SCENARIO NAME
              <input value={scenario.name} onChange={e => patch({ name: e.target.value })} />
            </label>
            <div className="field-grid">
              <label className="field-label">ARRIVAL RATE <span>jobs / sec</span>
                <input type="number" min="0.1" step="0.5" value={scenario.workloads[0]?.arrivals.ratePerSecond ?? 10} onChange={e => quickUpdateWorkload({ ratePerSecond: Math.max(0.1, Number(e.target.value)) })} />
              </label>
              <label className="field-label">WORKERS
                <input type="number" min="1" max="500" value={scenario.workerPools[0]?.workerCount ?? 1} onChange={e => quickUpdatePool({ workerCount: Math.max(1, Math.min(500, Number(e.target.value))) })} />
              </label>
            </div>
            <div className="field-grid">
              <label className="field-label">CONCURRENCY / WORKER
                <input type="number" min="1" max="100" value={scenario.workerPools[0]?.concurrencyPerWorker ?? 1} onChange={e => quickUpdatePool({ concurrencyPerWorker: Math.max(1, Math.min(100, Number(e.target.value))) })} />
              </label>
              <label className="field-label">MEAN SERVICE TIME <span>ms</span>
                <input type="number" min="1" value={(scenario.workerPools[0]?.serviceTime.meanMicros ?? 250000) / 1000} onChange={e => quickUpdatePool({ serviceTime: { distribution: 'EXPONENTIAL', constantMicros: Math.max(1, Number(e.target.value)) * 1000, meanMicros: Math.max(1, Number(e.target.value)) * 1000 } })} />
              </label>
            </div>
            <div className="field-grid">
              <label className="field-label">DURATION <span>seconds</span>
                <input type="number" min="1" max="3600" value={scenario.durationMicros / 1_000_000} onChange={e => { const d = Math.max(1, Number(e.target.value)) * 1_000_000; setScenario(s => ({ ...s, durationMicros: d, workloads: s.workloads.map(w => ({ ...w, endMicros: d })) })); }} />
              </label>
              <label className="field-label">RANDOM SEED
                <input type="number" value={scenario.seed} onChange={e => patch({ seed: Number(e.target.value) })} />
              </label>
            </div>
          </>}

          {/* ── BUILD MODE ── */}
          {mode === 'build' && <>
            <label className="field-label">SCENARIO NAME
              <input value={scenario.name} onChange={e => patch({ name: e.target.value })} className={!scenario.name.trim() ? 'field-invalid' : ''} />
            </label>
            <div className="field-grid">
              <label className="field-label">DURATION <span>seconds</span>
                <input type="number" min="1" max="3600" value={scenario.durationMicros / 1_000_000} onChange={e => { const d = Math.max(1, Number(e.target.value)) * 1_000_000; setScenario(s => ({ ...s, durationMicros: d, workloads: s.workloads.map(w => ({ ...w, endMicros: d })) })); }} />
              </label>
              <label className="field-label">RANDOM SEED
                <input type="number" value={scenario.seed} onChange={e => patch({ seed: Number(e.target.value) })} />
              </label>
            </div>

            {/* QUEUES */}
            <BuildSection title="QUEUES" count={scenario.queues.length} onAdd={addQueue}>
              {scenario.queues.map((queue, idx) => (
                <ItemCard key={idx} label={queue.id || `queue-${idx + 1}`} badge={queue.discipline}
                  invalid={!queue.id.trim()}
                  expanded={expandedQueues.has(idx)}
                  onToggle={() => toggleExpand(expandedQueues, setExpandedQueues, idx)}
                  onRemove={scenario.queues.length > 1 ? () => removeQueue(idx) : undefined}>
                  <div className="field-grid">
                    <label className="field-label">QUEUE ID
                      <input value={queue.id} onChange={e => setQueue(idx, { id: e.target.value })} className={!queue.id.trim() ? 'field-invalid' : ''} />
                    </label>
                    <label className="field-label">MAX DEPTH
                      <input type="number" min="1" value={queue.maxDepth} onChange={e => setQueue(idx, { maxDepth: Math.max(1, Number(e.target.value)) })} />
                    </label>
                  </div>
                  <label className="field-label" style={{ marginBottom: 0 }}>DISCIPLINE
                    <SegmentControl options={['FIFO', 'PRIORITY']} value={queue.discipline} onChange={v => setQueue(idx, { discipline: v as 'FIFO' | 'PRIORITY' })} />
                  </label>

                  <ToggleSubsection label="RATE LIMIT" enabled={!!queue.rateLimit}
                    onToggle={on => setQueue(idx, { rateLimit: on ? { ratePerSecond: 50, burstCapacity: 10 } : undefined })}>
                    {queue.rateLimit && <div className="field-grid">
                      <label className="field-label">RATE / SEC
                        <input type="number" min="0" value={queue.rateLimit.ratePerSecond} onChange={e => setQueue(idx, { rateLimit: { ...queue.rateLimit!, ratePerSecond: Number(e.target.value) } })} />
                      </label>
                      <label className="field-label">BURST CAP
                        <input type="number" min="1" value={queue.rateLimit.burstCapacity} onChange={e => setQueue(idx, { rateLimit: { ...queue.rateLimit!, burstCapacity: Math.max(1, Number(e.target.value)) } })} />
                      </label>
                    </div>}
                  </ToggleSubsection>

                  <ToggleSubsection label="RETRY POLICY" enabled={!!queue.retryPolicy}
                    onToggle={on => setQueue(idx, { retryPolicy: on ? { maxAttempts: 3, initialBackoffMicros: 1_000_000, maxBackoffMicros: 30_000_000, multiplier: 2, jitterFraction: 0.1 } : undefined })}>
                    {queue.retryPolicy && <>
                      <div className="field-grid">
                        <label className="field-label">MAX ATTEMPTS
                          <input type="number" min="1" value={queue.retryPolicy.maxAttempts} onChange={e => setQueue(idx, { retryPolicy: { ...queue.retryPolicy!, maxAttempts: Math.max(1, Number(e.target.value)) } })} />
                        </label>
                        <label className="field-label">MULTIPLIER
                          <input type="number" min="1" step="0.5" value={queue.retryPolicy.multiplier} onChange={e => setQueue(idx, { retryPolicy: { ...queue.retryPolicy!, multiplier: Math.max(1, Number(e.target.value)) } })} />
                        </label>
                      </div>
                      <div className="field-grid">
                        <label className="field-label">INIT BACKOFF <span>ms</span>
                          <input type="number" min="1" value={queue.retryPolicy.initialBackoffMicros / 1000} onChange={e => setQueue(idx, { retryPolicy: { ...queue.retryPolicy!, initialBackoffMicros: Math.max(1, Number(e.target.value)) * 1000 } })} />
                        </label>
                        <label className="field-label">MAX BACKOFF <span>ms</span>
                          <input type="number" min="1" value={queue.retryPolicy.maxBackoffMicros / 1000} onChange={e => setQueue(idx, { retryPolicy: { ...queue.retryPolicy!, maxBackoffMicros: Math.max(1, Number(e.target.value)) * 1000 } })} />
                        </label>
                      </div>
                      <label className="field-label">JITTER FRACTION <span>0 – 1</span>
                        <input type="number" min="0" max="1" step="0.05" value={queue.retryPolicy.jitterFraction} onChange={e => setQueue(idx, { retryPolicy: { ...queue.retryPolicy!, jitterFraction: Math.max(0, Math.min(1, Number(e.target.value))) } })} />
                      </label>
                    </>}
                  </ToggleSubsection>
                </ItemCard>
              ))}
            </BuildSection>

            {/* WORKER POOLS */}
            <BuildSection title="WORKER POOLS" count={scenario.workerPools.length} onAdd={addPool}>
              {scenario.workerPools.map((pool, idx) => (
                <ItemCard key={idx} label={pool.id || `pool-${idx + 1}`} badge={pool.serviceTime.distribution}
                  invalid={!pool.id.trim()}
                  expanded={expandedPools.has(idx)}
                  onToggle={() => toggleExpand(expandedPools, setExpandedPools, idx)}
                  onRemove={scenario.workerPools.length > 1 ? () => removePool(idx) : undefined}>
                  <div className="field-grid">
                    <label className="field-label">POOL ID
                      <input value={pool.id} onChange={e => setPool(idx, { id: e.target.value })} className={!pool.id.trim() ? 'field-invalid' : ''} />
                    </label>
                    <label className="field-label">QUEUE
                      <select className="field-select" value={pool.queueId} onChange={e => setPool(idx, { queueId: e.target.value })}>
                        {queueIds.map(qid => <option key={qid} value={qid}>{qid}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="field-grid">
                    <label className="field-label">WORKERS
                      <input type="number" min="1" max="500" value={pool.workerCount} onChange={e => setPool(idx, { workerCount: Math.max(1, Math.min(500, Number(e.target.value))) })} />
                    </label>
                    <label className="field-label">CONCURRENCY / WORKER
                      <input type="number" min="1" max="100" value={pool.concurrencyPerWorker} onChange={e => setPool(idx, { concurrencyPerWorker: Math.max(1, Math.min(100, Number(e.target.value))) })} />
                    </label>
                  </div>
                  <label className="field-label" style={{ marginBottom: 0 }}>DISTRIBUTION
                    <SegmentControl options={['CONSTANT', 'EXPONENTIAL', 'LOGNORMAL']} value={pool.serviceTime.distribution}
                      onChange={v => setPool(idx, { serviceTime: { ...pool.serviceTime, distribution: v as typeof pool.serviceTime.distribution } })} />
                  </label>
                  <div className="field-grid">
                    <label className="field-label">{pool.serviceTime.distribution === 'CONSTANT' ? 'DURATION' : 'MEAN'} <span>ms</span>
                      <input type="number" min="1" value={pool.serviceTime.meanMicros / 1000}
                        onChange={e => { const ms = Math.max(1, Number(e.target.value)) * 1000; setPool(idx, { serviceTime: { ...pool.serviceTime, meanMicros: ms, constantMicros: ms } }); }} />
                    </label>
                    {pool.serviceTime.distribution === 'LOGNORMAL' && (
                      <label className="field-label">STD DEV <span>ms</span>
                        <input type="number" min="1" value={(pool.serviceTime.stdDevMicros ?? pool.serviceTime.meanMicros) / 1000}
                          onChange={e => setPool(idx, { serviceTime: { ...pool.serviceTime, stdDevMicros: Math.max(1, Number(e.target.value)) * 1000 } })} />
                      </label>
                    )}
                  </div>
                  <label className="field-label">FAILURE PROBABILITY <span>0 – 1</span>
                    <input type="number" min="0" max="1" step="0.01" value={pool.failureProbability ?? 0}
                      onChange={e => { const v = Math.max(0, Math.min(1, Number(e.target.value))); setPool(idx, { failureProbability: v || undefined }); }} />
                  </label>
                  <div className="subsection-label" style={{ marginTop: 10 }}>PLANNED OUTAGES</div>
                  {(pool.outages ?? []).map((outage, oi) => (
                    <div key={oi} className="outage-row">
                      <input className="outage-input" placeholder="id" value={outage.id}
                        onChange={e => { const o = [...(pool.outages ?? [])]; o[oi] = { ...o[oi], id: e.target.value }; setPool(idx, { outages: o }); }} />
                      <input className="outage-input" type="number" title="Start (ms)" placeholder="start ms" value={outage.startMicros / 1000}
                        onChange={e => { const o = [...(pool.outages ?? [])]; o[oi] = { ...o[oi], startMicros: Number(e.target.value) * 1000 }; setPool(idx, { outages: o }); }} />
                      <input className="outage-input" type="number" title="End (ms)" placeholder="end ms" value={outage.endMicros / 1000}
                        onChange={e => { const o = [...(pool.outages ?? [])]; o[oi] = { ...o[oi], endMicros: Number(e.target.value) * 1000 }; setPool(idx, { outages: o }); }} />
                      <input className="outage-input" type="number" title="Unavailable workers" placeholder="workers" value={outage.unavailableWorkers}
                        onChange={e => { const o = [...(pool.outages ?? [])]; o[oi] = { ...o[oi], unavailableWorkers: Math.max(1, Number(e.target.value)) }; setPool(idx, { outages: o }); }} />
                      <button className="item-remove sm" title="Remove outage" onClick={() => { const o = (pool.outages ?? []).filter((_, i) => i !== oi); setPool(idx, { outages: o.length ? o : undefined }); }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                  <button className="add-sub-btn" onClick={() => {
                    const existing = pool.outages ?? [];
                    setPool(idx, { outages: [...existing, { id: `outage-${existing.length + 1}`, startMicros: 30_000_000, endMicros: 33_000_000, unavailableWorkers: 1 }] });
                  }}>+ ADD OUTAGE</button>
                </ItemCard>
              ))}
            </BuildSection>

            {/* WORKLOADS */}
            <BuildSection title="WORKLOADS" count={scenario.workloads.length} onAdd={addWorkload}>
              {scenario.workloads.map((wl, idx) => (
                <ItemCard key={idx} label={wl.id || `workload-${idx + 1}`} badge={wl.arrivals.mode}
                  invalid={!wl.id.trim()}
                  expanded={expandedWorkloads.has(idx)}
                  onToggle={() => toggleExpand(expandedWorkloads, setExpandedWorkloads, idx)}
                  onRemove={scenario.workloads.length > 1 ? () => removeWorkload(idx) : undefined}>
                  <div className="field-grid">
                    <label className="field-label">WORKLOAD ID
                      <input value={wl.id} onChange={e => setWorkload(idx, { id: e.target.value })} className={!wl.id.trim() ? 'field-invalid' : ''} />
                    </label>
                    <label className="field-label">QUEUE
                      <select className="field-select" value={wl.queueId} onChange={e => setWorkload(idx, { queueId: e.target.value })}>
                        {queueIds.map(qid => <option key={qid} value={qid}>{qid}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="field-grid">
                    <label className="field-label">START <span>seconds</span>
                      <input type="number" min="0" value={wl.startMicros / 1_000_000} onChange={e => setWorkload(idx, { startMicros: Math.max(0, Number(e.target.value)) * 1_000_000 })} />
                    </label>
                    <label className="field-label">END <span>seconds</span>
                      <input type="number" min="1" value={wl.endMicros / 1_000_000} onChange={e => setWorkload(idx, { endMicros: Math.max(1, Number(e.target.value)) * 1_000_000 })} />
                    </label>
                  </div>
                  <div className="field-grid">
                    <label className="field-label">ARRIVAL RATE <span>/ sec</span>
                      <input type="number" min="0.1" step="0.5" value={wl.arrivals.ratePerSecond} onChange={e => setWorkload(idx, { arrivals: { ...wl.arrivals, ratePerSecond: Math.max(0.1, Number(e.target.value)) } })} />
                    </label>
                    <label className="field-label">PRIORITY <span>higher = first</span>
                      <input type="number" min="0" value={wl.priority ?? 0} onChange={e => setWorkload(idx, { priority: Number(e.target.value) })} />
                    </label>
                  </div>
                  <label className="field-label" style={{ marginBottom: 0 }}>ARRIVAL MODE
                    <SegmentControl options={['POISSON', 'CONSTANT']} value={wl.arrivals.mode} onChange={v => setWorkload(idx, { arrivals: { ...wl.arrivals, mode: v as 'POISSON' | 'CONSTANT' } })} />
                  </label>
                </ItemCard>
              ))}
            </BuildSection>
          </>}

          {/* ── JSON MODE ── */}
          {mode === 'json' && (
            <div style={{ marginTop: 12 }}>
              <textarea className="json-textarea" spellCheck={false} value={scenarioJson} onChange={e => setScenarioJson(e.target.value)} aria-label="Advanced scenario JSON" />
              <button className="apply-json" onClick={applyScenarioJson}>APPLY JSON SCENARIO</button>
              {jsonError && <div className="error-box">{jsonError}</div>}
            </div>
          )}

          {/* Saved experiments */}
          <details className="saved-section">
            <summary>SAVED EXPERIMENTS {saved.length > 0 ? `· ${saved.length}` : ''}</summary>
            {saved.length === 0
              ? <div className="saved-empty">No saved experiments yet. Click Save to store the current scenario.</div>
              : <div className="saved-list">
                {saved.map(exp => (
                  <div key={exp.name} className="saved-item">
                    <span className="saved-name" onClick={() => loadExperiment(exp.name)} title="Load this experiment">{exp.name}</span>
                    <button className="saved-export" title="Export as JSON" onClick={() => triggerDownload(serializeScenario(exp.scenario), scenarioJsonFilename(exp.scenario), 'application/json')}><Download size={11} /></button>
                    <button className="item-remove sm" title="Delete" onClick={() => deleteExperiment(exp.name)}><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
            }
          </details>

          <div className="config-note">
            <div className="note-icon"><Clock3 size={15} /></div>
            <p><strong>Deterministic run</strong><br />The same inputs and seed produce the same logical result.</p>
          </div>

          <div className="run-row">
            <button className="run-button" onClick={runSimulation} disabled={loading}>
              {loading ? <><span className="spinner" /> RUNNING EXPERIMENT</> : <><Play size={16} fill="currentColor" /> RUN SIMULATION <ArrowUpRight size={16} /></>}
            </button>
            <button className="save-btn" title="Save experiment" onClick={saveExperiment}><Save size={15} /></button>
          </div>
          {progress && <div className="progress-message">{progress}</div>}
          {error && <div className="error-box">{error}</div>}
          <div className="engine-foot">
            <span>ENGINE</span>
            <strong>Discrete-event / virtual clock</strong>
            <span className="engine-status">● READY</span>
          </div>
        </section>

        {/* ── RIGHT PANEL ── */}
        <section className="results-column">
          <div className="results-head">
            <div>
              <div className="section-kicker">02 / SIMULATION OUTPUT</div>
              <h2>{result ? 'Run analysis' : 'Awaiting experiment'}</h2>
            </div>
            <div className="result-actions">
              {result && <>
                <button className="export-btn" onClick={downloadScenarioJson} title="Download scenario as JSON">
                  <Download size={11} /> JSON
                </button>
                <button className="export-btn" onClick={downloadResultsCsv} title="Download results as CSV">
                  <Download size={11} /> CSV
                </button>
              </>}
              <span className="result-tag">{result ? 'COMPLETED' : 'NO RUN'}</span>
            </div>
          </div>

          {!result ? (
            <div className="empty-state">
              <div className="empty-graphic">
                <div className="empty-ring ring-one" />
                <div className="empty-ring ring-two" />
                <div className="empty-core"><Activity size={26} /></div>
              </div>
              <h3>Your next insight starts here.</h3>
              <p>Configure a workload and run your first experiment. Metrics and event traces will appear here.</p>
              <div className="empty-hint"><span>TIP</span> Try 20 jobs/sec with 5 workers to start.</div>
            </div>
          ) : <>
            <div className="metric-grid">
              <Metric icon={<Gauge size={16} />} label="THROUGHPUT" value={`${fmt(result.throughputPerSecond)}`} unit="jobs / sec" />
              <Metric icon={<Clock3 size={16} />} label="P95 LATENCY" value={`${fmt(result.p95EndToEndLatencyMicros / 1000)}`} unit="milliseconds" />
              <Metric icon={<Server size={16} />} label="PEAK BACKLOG" value={fmt(result.peakBacklog)} unit="waiting jobs" />
              <Metric icon={<Activity size={16} />} label="WORKER UTILIZATION" value={`${fmt(result.workerUtilization * 100)}%`} unit="of available capacity" />
            </div>

            <div className="panel chart-panel">
              <div className="chart-head">
                <div><h3>Event activity</h3><p>Captured events across virtual time</p></div>
                <span className="chart-legend"><i /> completions</span>
              </div>
              <div className="chart-wrap">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="completeFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#64e5bf" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#64e5bf" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#202b42" strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="time" stroke="#66738c" tickLine={false} axisLine={false} tickFormatter={v => `${v}s`} />
                      <YAxis stroke="#66738c" tickLine={false} axisLine={false} width={34} />
                      <Tooltip contentStyle={{ background: '#111a2b', border: '1px solid #293753', borderRadius: 10, color: '#eaf0ff' }} />
                      <Area type="monotone" dataKey="completed" name="Completions" stroke="#64e5bf" fill="url(#completeFill)" strokeWidth={2.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <div className="no-trace">Trace capture disabled or no events recorded.</div>}
              </div>
            </div>

            <div className="panel summary-panel">
              <div className="chart-head">
                <div><h3>Execution summary</h3><p>Seed {result.seed} · {fmt(result.processedEvents)} events processed</p></div>
              </div>
              <div className="summary-grid">
                <Summary label="Generated" value={result.generatedJobs} />
                <Summary label="Completed" value={result.completedJobs} />
                <Summary label="Rejected" value={result.rejectedJobs} />
                <Summary label="Waiting at end" value={result.waitingAtEnd} />
                <Summary label="Active at end" value={result.activeAtEnd} />
                <Summary label="p99 latency" value={`${fmt(result.p99EndToEndLatencyMicros / 1000)} ms`} />
                <Summary label="Retries scheduled" value={result.retriedJobs} />
                <Summary label="Dead-lettered" value={result.deadLetteredJobs} />
              </div>

              <button className="apply-json compare-button" onClick={compareSeeds} disabled={comparing}>
                {comparing ? 'RUNNING 5 SEEDS…' : 'COMPARE 5 SEEDED RUNS'}
              </button>

              {comparison && (
                <div className="comparison-result">
                  <span>5-REPLICATION STATISTICAL SUMMARY</span>
                  <div className="cmp-table-wrap">
                    <table className="cmp-table">
                      <thead>
                        <tr>
                          <th>SEED</th><th>THROUGHPUT</th><th>P95 (ms)</th><th>P99 (ms)</th><th>UTIL %</th><th>BACKLOG</th><th>REJECTED</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.runs.map(run => (
                          <tr key={run.seed}>
                            <td className="seed-col">{run.seed}</td>
                            <td>{run.throughputPerSecond.toFixed(2)}</td>
                            <td>{(run.p95LatencyMicros / 1000).toFixed(1)}</td>
                            <td>{(run.p99LatencyMicros / 1000).toFixed(1)}</td>
                            <td>{(run.workerUtilization * 100).toFixed(1)}%</td>
                            <td>{run.peakBacklog}</td>
                            <td>{run.rejectedJobs}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="cmp-mean-row">
                          <td>MEAN</td>
                          <td>
                            {comparison.meanThroughputPerSecond.toFixed(2)}
                            <span className="ci-pm"> ±{(T_CRIT_5 * comparison.standardDeviationThroughputPerSecond / Math.sqrt(5)).toFixed(2)}</span>
                          </td>
                          <td>
                            {(comparison.meanP95LatencyMicros / 1000).toFixed(1)}
                            <span className="ci-pm"> ±{(T_CRIT_5 * comparison.standardDeviationP95LatencyMicros / 1000 / Math.sqrt(5)).toFixed(1)}</span>
                          </td>
                          <td>{(comparison.meanP99LatencyMicros / 1000).toFixed(1)}</td>
                          <td>{(comparison.meanWorkerUtilization * 100).toFixed(1)}%</td>
                          <td>{Math.round(comparison.meanPeakBacklog)}</td>
                          <td>{Math.round(comparison.meanRejectedJobs)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <small className="ci-note">95% confidence intervals are shown for mean throughput and mean P95 latency only. P99, utilization, backlog and rejected-job values are means without confidence intervals in the comparison response.</small>
                </div>
              )}
            </div>

            <div className="panel summary-panel queue-panel">
              <div className="chart-head">
                <div><h3>Queue breakdown</h3><p>Independent queue and worker-pool outcomes</p></div>
              </div>
              <div className="queue-breakdown">
                {result.queues.map(queue => (
                  <div className="queue-row" key={queue.queueId}>
                    <strong>{queue.queueId}</strong>
                    <span>{fmt(queue.completedJobs)} complete</span>
                    <span>{fmt(queue.rejectedJobs)} rejected</span>
                    <span>{fmt(queue.workerUtilization * 100)}% used</span>
                  </div>
                ))}
              </div>
            </div>
          </>}
        </section>
      </div>

      <footer>
        <span>QUEUEFLUX <i>·</i> OPEN SOURCE WORKLOAD EXPERIMENTS</span>
        <span>BUILT FOR REPEATABILITY <i>·</i> APACHE 2.0</span>
      </footer>
    </main>
  );
}

function Metric({ icon, label, value, unit }: { icon: ReactNode; label: string; value: string; unit: string }) {
  return (
    <div className="metric-card">
      <div className="metric-top">{icon}<span>{label}</span></div>
      <div className="metric-value">{value}</div>
      <div className="metric-unit">{unit}</div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return <div className="summary-item"><span>{label}</span><strong>{value}</strong></div>;
}

function BuildSection({ title, count, onAdd, children }: { title: string; count: number; onAdd: () => void; children: ReactNode }) {
  return (
    <div className="build-section">
      <div className="build-section-head">
        <span className="build-section-title">{title} <span className="build-count">{count}</span></span>
        <button className="add-item-btn" onClick={onAdd}><Plus size={11} /> ADD</button>
      </div>
      {children}
    </div>
  );
}

function ItemCard({ label, badge, invalid, expanded, onToggle, onRemove, children }: {
  label: string; badge: string; invalid?: boolean; expanded: boolean;
  onToggle: () => void; onRemove?: () => void; children: ReactNode;
}) {
  return (
    <div className={`item-card${invalid ? ' item-invalid' : ''}`}>
      <div className="item-card-head" onClick={onToggle}>
        <span className="item-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="item-label">{label}{invalid && <span className="item-err-dot" title="ID required" />}</span>
        <span className="item-badge">{badge}</span>
        {onRemove && (
          <button className="item-remove" onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {expanded && <div className="item-card-body">{children}</div>}
    </div>
  );
}

function ToggleSubsection({ label, enabled, onToggle, children }: { label: string; enabled: boolean; onToggle: (on: boolean) => void; children: ReactNode }) {
  return (
    <div className="toggle-subsection">
      <div className="toggle-row">
        <span className="subsection-label">{label}</span>
        <button className={`toggle-pill${enabled ? ' on' : ''}`} onClick={() => onToggle(!enabled)}>{enabled ? 'ON' : 'OFF'}</button>
      </div>
      {enabled && <div className="toggle-body">{children}</div>}
    </div>
  );
}

function SegmentControl({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg-ctrl">
      {options.map(opt => (
        <button key={opt} className={`seg-btn${value === opt ? ' active' : ''}`} onClick={() => onChange(opt)}>{opt}</button>
      ))}
    </div>
  );
}
