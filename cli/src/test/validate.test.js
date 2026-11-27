import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../validate.js';

const BASE = {
  schemaVersion: 1,
  name: 'test',
  durationMicros: 1000000,
  seed: 42,
  queues: [{ id: 'q1', maxDepth: 100, discipline: 'FIFO' }],
  workerPools: [{
    id: 'pool1', queueId: 'q1', workerCount: 2, concurrencyPerWorker: 1,
    serviceTime: { distribution: 'CONSTANT', constantMicros: 1000, meanMicros: 1000 },
  }],
  workloads: [{
    id: 'w1', queueId: 'q1', startMicros: 0, endMicros: 1000000,
    arrivals: { mode: 'CONSTANT', ratePerSecond: 5 },
  }],
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

describe('validate()', () => {
  it('accepts a well-formed scenario', () => {
    const result = validate(clone(BASE));
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('rejects missing required top-level fields', () => {
    const bad = clone(BASE);
    delete bad.name;
    const result = validate(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some(e => e.includes('name')));
  });

  it('rejects invalid schemaVersion', () => {
    const bad = clone(BASE);
    bad.schemaVersion = 99;
    const result = validate(bad);
    assert.equal(result.valid, false);
  });

  it('stops after the first validation error to bound error accumulation', () => {
    const bad = clone(BASE);
    bad.name = 42;
    bad.durationMicros = 0;
    bad.seed = 'not-an-integer';
    bad.queues[0].discipline = 'LIFO';

    const result = validate(bad);

    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
  });

  it('rejects unknown discipline', () => {
    const bad = clone(BASE);
    bad.queues[0].discipline = 'LIFO';
    const result = validate(bad);
    assert.equal(result.valid, false);
  });

  it('rejects CONSTANT serviceTime without constantMicros', () => {
    const bad = clone(BASE);
    bad.workerPools[0].serviceTime = { distribution: 'CONSTANT', meanMicros: 1000 };
    const result = validate(bad);
    assert.equal(result.valid, false);
  });

  it('accepts EXPONENTIAL serviceTime without constantMicros', () => {
    const good = clone(BASE);
    good.workerPools[0].serviceTime = { distribution: 'EXPONENTIAL', meanMicros: 1000 };
    const result = validate(good);
    assert.equal(result.valid, true);
  });

  it('accepts fractional EXPONENTIAL meanMicros under the canonical v1 schema', () => {
    const good = clone(BASE);
    good.workerPools[0].serviceTime = { distribution: 'EXPONENTIAL', meanMicros: 1000.5 };
    const result = validate(good);
    assert.equal(result.valid, true);
  });

  it('rejects EXPONENTIAL serviceTime without meanMicros', () => {
    const bad = clone(BASE);
    bad.workerPools[0].serviceTime = { distribution: 'EXPONENTIAL', constantMicros: 1000 };
    const result = validate(bad);
    assert.equal(result.valid, false);
  });

  it('accepts LOGNORMAL serviceTime with meanMicros and stdDevMicros', () => {
    const good = clone(BASE);
    good.workerPools[0].serviceTime = { distribution: 'LOGNORMAL', meanMicros: 500, stdDevMicros: 100 };
    const result = validate(good);
    assert.equal(result.valid, true);
  });

  it('accepts LOGNORMAL serviceTime with float values', () => {
    const good = clone(BASE);
    good.workerPools[0].serviceTime = { distribution: 'LOGNORMAL', meanMicros: 1500.5, stdDevMicros: 300.25 };
    const result = validate(good);
    assert.equal(result.valid, true);
  });

  it('rejects LOGNORMAL serviceTime without meanMicros', () => {
    const bad = clone(BASE);
    bad.workerPools[0].serviceTime = { distribution: 'LOGNORMAL', stdDevMicros: 100 };
    const result = validate(bad);
    assert.equal(result.valid, false);
  });

  it('rejects LOGNORMAL serviceTime without stdDevMicros', () => {
    const bad = clone(BASE);
    bad.workerPools[0].serviceTime = { distribution: 'LOGNORMAL', meanMicros: 500 };
    const result = validate(bad);
    assert.equal(result.valid, false);
  });

  it('rejects maxDepth < 1', () => {
    const bad = clone(BASE);
    bad.queues[0].maxDepth = 0;
    const result = validate(bad);
    assert.equal(result.valid, false);
  });

  it('rejects workerCount < 1', () => {
    const bad = clone(BASE);
    bad.workerPools[0].workerCount = 0;
    const result = validate(bad);
    assert.equal(result.valid, false);
  });

  it('accepts POISSON arrivals', () => {
    const good = clone(BASE);
    good.workloads[0].arrivals = { mode: 'POISSON', ratePerSecond: 10 };
    const result = validate(good);
    assert.equal(result.valid, true);
  });

  it('rejects ratePerSecond = 0 in arrivals', () => {
    const bad = clone(BASE);
    bad.workloads[0].arrivals = { mode: 'CONSTANT', ratePerSecond: 0 };
    const result = validate(bad);
    assert.equal(result.valid, false);
  });

  it('rejects null scenario', () => {
    const result = validate(null);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('validates the constant-load example scenario', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = dirname(fileURLToPath(import.meta.url));
    const examplePath = resolve(dir, '../../../examples/constant-load/scenario.json');
    const scenario = JSON.parse(readFileSync(examplePath, 'utf8'));
    const result = validate(scenario);
    assert.equal(result.valid, true, `Expected valid but got errors: ${result.errors.join(', ')}`);
  });
});
