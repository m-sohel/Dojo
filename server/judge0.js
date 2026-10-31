const CPU_TIME_LIMIT_SECONDS = 5;
const WALL_TIME_LIMIT_SECONDS = 10;
const MAX_FILE_SIZE_BYTES = 256 * 1024;
const POLL_INTERVAL_MS = 300;
const SUBMISSION_TIMEOUT_MS = 30_000;

function decodeOutput(value) {
  if (!value) return '';
  return Buffer.from(value, 'base64').subarray(0, MAX_FILE_SIZE_BYTES).toString('utf8');
}

function getErrorMessage(payload, status) {
  const message = typeof payload === 'string'
    ? payload
    : payload?.error ?? payload?.message ?? payload?.error_description;
  return message
    ? `Hosted Java runner returned HTTP ${status}: ${message}`
    : `Hosted Java runner returned HTTP ${status}.`;
}

async function requestJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, {
    ...options,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Hosted Java runner returned invalid JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(getErrorMessage(payload, response.status));
  return payload;
}

export function isJudge0Configured(env = process.env) {
  return Boolean(env.JUDGE0_API_URL);
}

export async function runJudge0(code, stdin, env = process.env, fetchImpl = fetch) {
  const apiUrl = env.JUDGE0_API_URL?.replace(/\/+$/, '');
  if (!apiUrl) throw new Error('Hosted Java runner is not configured.');

  const headers = { 'Content-Type': 'application/json' };
  if (env.JUDGE0_API_KEY) {
    headers[env.JUDGE0_AUTH_HEADER || 'X-RapidAPI-Key'] = env.JUDGE0_API_KEY;
  }
  if (env.JUDGE0_API_HOST) headers['X-RapidAPI-Host'] = env.JUDGE0_API_HOST;

  const deadline = Date.now() + SUBMISSION_TIMEOUT_MS;
  const submission = await requestJson(fetchImpl, `${apiUrl}/submissions?base64_encoded=true&wait=false`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      language_id: 62,
      source_code: Buffer.from(code, 'utf8').toString('base64'),
      stdin: Buffer.from(stdin, 'utf8').toString('base64'),
      cpu_time_limit: CPU_TIME_LIMIT_SECONDS,
      wall_time_limit: WALL_TIME_LIMIT_SECONDS,
      max_file_size: MAX_FILE_SIZE_BYTES,
    }),
  });

  if (typeof submission.token !== 'string' || submission.token.length === 0) {
    throw new Error('Hosted Java runner did not return a submission token.');
  }

  let result;
  do {
    if (Date.now() >= deadline) {
      return {
        stdout: '',
        stderr: 'The hosted Java runner did not finish within 30 seconds.',
        exitCode: null,
        executionTimeMs: SUBMISSION_TIMEOUT_MS,
        status: 'runner_timeout',
      };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    result = await requestJson(
      fetchImpl,
      `${apiUrl}/submissions/${encodeURIComponent(submission.token)}?base64_encoded=true`,
      { headers },
    );
  } while (!result.status || result.status.id <= 2);

  const statusId = result.status.id;
  const compileOutput = decodeOutput(result.compile_output);
  const stderr = decodeOutput(result.stderr);
  const stdout = decodeOutput(result.stdout);
  const message = decodeOutput(result.message);
  const failed = statusId !== 3;
  const timedOut = statusId === 5;
  const compileError = statusId === 6;

  return {
    stdout,
    stderr: [compileOutput, stderr, message].filter(Boolean).join('\n'),
    exitCode: failed ? statusId === 6 ? 1 : statusId : 0,
    executionTimeMs: Math.round(Number.parseFloat(result.time) * 1000) || 0,
    status: timedOut
      ? 'timeout'
      : compileError
        ? 'compile_error'
        : failed
          ? 'runtime_error'
          : 'success',
  };
}
