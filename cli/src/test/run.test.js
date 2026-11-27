import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { submitRun, NetworkError, ApiError, TimeoutError } from '../run.js';

const SCENARIO = { schemaVersion: 1, name: 'test', durationMicros: 1000, seed: 1, queues: [], workerPools: [], workloads: [] };
const FAST = { apiUrl: 'http://localhost:8080', pollIntervalMs: 1 };

function makeFetch(responses) {
  let call = 0;
  const calls = [];
  const fn = async (url, init) => {
    calls.push(url);
    const resp = responses[call++];
    if (resp instanceof Error) throw resp;
    return {
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      json: async () => resp.json,
      text: async () => resp.text ?? '',
    };
  };
  fn.calls = calls;
  return fn;
}

describe('submitRun()', () => {
  it('returns run id without waiting when wait=false', async () => {
    const fetchMock = makeFetch([
      { ok: true, status: 202, json: { id: 'abc-123', status: 'QUEUED' } },
    ]);
    const result = await submitRun(SCENARIO, { ...FAST, wait: false, timeoutSeconds: 10 }, fetchMock);
    assert.equal(result.id, 'abc-123');
    assert.equal(result.status, 'QUEUED');
    assert.equal(result.snapshot, null);
  });

  it('polls until COMPLETED and fetches metrics from the dedicated endpoint', async () => {
    const fetchMock = makeFetch([
      { ok: true, status: 202, json: { id: 'run-1', status: 'QUEUED' } },
      { ok: true, status: 200, json: { id: 'run-1', status: 'RUNNING' } },
      { ok: true, status: 200, json: { id: 'run-1', status: 'COMPLETED', result: { completedJobs: 1 } } },
      { ok: true, status: 200, json: { completedJobs: 10, throughputPerSecond: 42.5 } },
    ]);
    const result = await submitRun(SCENARIO, { ...FAST, wait: true, timeoutSeconds: 10 }, fetchMock);
    assert.equal(result.status, 'COMPLETED');
    // result comes from the /metrics endpoint, not the snapshot
    assert.equal(result.result.completedJobs, 10);
    assert.equal(result.result.throughputPerSecond, 42.5);
    assert.ok(fetchMock.calls.some(u => u.endsWith('/api/v1/simulations/runs/run-1/metrics')));
  });

  it('does not fetch metrics for a FAILED run', async () => {
    const fetchMock = makeFetch([
      { ok: true, status: 202, json: { id: 'run-2', status: 'QUEUED' } },
      { ok: true, status: 200, json: { id: 'run-2', status: 'FAILED', errorMessage: 'bad input' } },
    ]);
    const result = await submitRun(SCENARIO, { ...FAST, wait: true, timeoutSeconds: 10 }, fetchMock);
    assert.equal(result.status, 'FAILED');
    assert.ok(!fetchMock.calls.some(u => u.endsWith('/metrics')));
  });

  it('throws NetworkError when fetch rejects on submit', async () => {
    const fetchMock = makeFetch([new TypeError('fetch failed')]);
    await assert.rejects(
      () => submitRun(SCENARIO, { ...FAST, wait: false, timeoutSeconds: 10 }, fetchMock),
      (err) => {
        assert.ok(err instanceof NetworkError);
        return true;
      }
    );
  });

  it('throws ApiError on HTTP 400 response', async () => {
    const fetchMock = makeFetch([{ ok: false, status: 400, text: 'Bad request' }]);
    await assert.rejects(
      () => submitRun(SCENARIO, { ...FAST, wait: false, timeoutSeconds: 10 }, fetchMock),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it('throws TimeoutError when deadline passes before completion', async () => {
    const responses = [
      { ok: true, status: 202, json: { id: 'run-3', status: 'QUEUED' } },
    ];
    for (let i = 0; i < 200; i++) {
      responses.push({ ok: true, status: 200, json: { id: 'run-3', status: 'RUNNING' } });
    }
    const fetchMock = makeFetch(responses);
    await assert.rejects(
      () => submitRun(SCENARIO, { ...FAST, wait: true, timeoutSeconds: 0.001 }, fetchMock),
      (err) => {
        assert.ok(err instanceof TimeoutError);
        return true;
      }
    );
  });

  it('throws NetworkError when polling fetch rejects', async () => {
    const fetchMock = makeFetch([
      { ok: true, status: 202, json: { id: 'run-4', status: 'QUEUED' } },
      new TypeError('connection reset'),
    ]);
    await assert.rejects(
      () => submitRun(SCENARIO, { ...FAST, wait: true, timeoutSeconds: 10 }, fetchMock),
      (err) => {
        assert.ok(err instanceof NetworkError);
        return true;
      }
    );
  });

  it('throws ApiError when poll returns 500', async () => {
    const fetchMock = makeFetch([
      { ok: true, status: 202, json: { id: 'run-5', status: 'QUEUED' } },
      { ok: false, status: 500, text: 'Internal Server Error' },
    ]);
    await assert.rejects(
      () => submitRun(SCENARIO, { ...FAST, wait: true, timeoutSeconds: 10 }, fetchMock),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 500);
        return true;
      }
    );
  });
});
