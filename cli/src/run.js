const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/**
 * Submits a scenario to the QueueFlux API and optionally waits for completion.
 * @param {object} scenario - Parsed scenario definition
 * @param {{ apiUrl: string, wait: boolean, timeoutSeconds: number, pollIntervalMs?: number }} opts
 * @param {typeof fetch} [fetchImpl] - Injectable fetch for testing (defaults to global fetch)
 * @returns {Promise<{ id: string, status: string, result: object|null, snapshot: object|null }>}
 */
export async function submitRun(scenario, { apiUrl, wait, timeoutSeconds, pollIntervalMs = 1000 }, fetchImpl = fetch) {
  const runsUrl = `${apiUrl}/api/v1/simulations/runs`;

  let response;
  try {
    response = await fetchImpl(runsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scenario),
    });
  } catch (err) {
    throw new NetworkError(`Could not reach API at ${runsUrl}: ${err.message}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(response.status, body);
  }

  const accepted = await response.json();
  const runId = accepted.id;
  const statusUrl = `${apiUrl}/api/v1/simulations/runs/${runId}`;

  if (!wait) {
    return { id: runId, status: accepted.status, result: null, snapshot: null };
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    let snap;
    try {
      const r = await fetchImpl(statusUrl);
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new ApiError(r.status, body);
      }
      snap = await r.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new NetworkError(`Lost connection while polling ${statusUrl}: ${err.message}`);
    }

    if (TERMINAL_STATUSES.has(snap.status)) {
      let result = snap.result;
      // For a completed run, fetch the lighter metrics-only endpoint rather than
      // re-reading the full snapshot payload.
      if (snap.status === 'COMPLETED') {
        const metricsUrl = `${apiUrl}/api/v1/simulations/runs/${runId}/metrics`;
        try {
          const m = await fetchImpl(metricsUrl);
          if (!m.ok) {
            const body = await m.text().catch(() => '');
            throw new ApiError(m.status, body);
          }
          result = await m.json();
        } catch (err) {
          if (err instanceof ApiError) throw err;
          throw new NetworkError(`Lost connection while fetching ${metricsUrl}: ${err.message}`);
        }
      }
      return { id: runId, status: snap.status, result, snapshot: snap };
    }
  }

  throw new TimeoutError(runId, timeoutSeconds);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ApiError extends Error {
  constructor(statusCode, body) {
    super(`API returned HTTP ${statusCode}: ${body}`);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

export class TimeoutError extends Error {
  constructor(runId, seconds) {
    super(`Run ${runId} did not complete within ${seconds}s`);
    this.name = 'TimeoutError';
    this.runId = runId;
  }
}
