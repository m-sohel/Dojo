import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { isJudge0Configured, runJudge0 } from './judge0.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_SOURCE_BYTES = 100 * 1024;
const MAX_STDIN_BYTES = 100 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const COMPILE_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 5_000;
const RUN_RATE_WINDOW_MS = 60_000;
const RUN_RATE_LIMIT = 10;
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(serverDirectory, '..');
const runRequestWindows = new Map();

app.disable('x-powered-by');
const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (Number.isInteger(trustedProxyHops) && trustedProxyHops > 0) {
  app.set('trust proxy', trustedProxyHops);
}
app.use(express.json({ limit: '256kb', strict: true }));

setInterval(() => {
  const now = Date.now();
  for (const [ip, window] of runRequestWindows) {
    if (window.resetAt <= now) runRequestWindows.delete(ip);
  }
}, RUN_RATE_WINDOW_MS).unref();

function limitRunRequests(request, response, next) {
  const now = Date.now();
  const current = runRequestWindows.get(request.ip);
  if (!current || current.resetAt <= now) {
    runRequestWindows.set(request.ip, { count: 1, resetAt: now + RUN_RATE_WINDOW_MS });
    next();
    return;
  }
  if (current.count >= RUN_RATE_LIMIT) {
    response.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    response.status(429).json({ error: 'Run limit reached. Try again in a minute.' });
    return;
  }
  current.count += 1;
  next();
}

function terminateProcessTree(child) {
  if (process.platform !== 'win32') {
    if (!child.kill('SIGKILL')) {
      console.error(`Could not terminate child process ${child.pid}.`);
    }
    return;
  }

  const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
  });
  killer.on('error', (error) => {
    console.error(`Could not terminate child process ${child.pid}:`, error);
    if (!child.kill()) {
      console.error(`Signal fallback failed for child process ${child.pid}.`);
    }
  });
  killer.on('close', (exitCode) => {
    if (exitCode !== 0 && child.exitCode === null && !child.kill()) {
      console.error(`Could not terminate child process ${child.pid}; taskkill exited with ${exitCode}.`);
    }
  });
}

function runProcess(command, args, { cwd, stdin = '', timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;

    const capture = (target, chunk) => {
      const remaining = MAX_OUTPUT_BYTES - outputBytes;
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining);
        target.push(kept);
        outputBytes += kept.length;
      }
      if (chunk.length > remaining && !outputLimitExceeded) {
        outputLimitExceeded = true;
        terminateProcessTree(child);
      }
    };

    child.stdout.on('data', (chunk) => capture(stdout, chunk));
    child.stderr.on('data', (chunk) => capture(stderr, chunk));
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);

    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        timedOut,
        outputLimitExceeded,
      });
    });

    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        console.error('Could not send stdin to Java process:', error);
      }
    });
    child.stdin.end(stdin);
  });
}

app.post('/api/run', limitRunRequests, async (request, response, next) => {
  const { code, stdin } = request.body ?? {};
  if (typeof code !== 'string' || typeof stdin !== 'string') {
    response.status(400).json({ error: 'Code and stdin must both be strings.' });
    return;
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_SOURCE_BYTES) {
    response.status(413).json({ error: 'Code exceeds the 100 KB limit.' });
    return;
  }
  if (Buffer.byteLength(stdin, 'utf8') > MAX_STDIN_BYTES) {
    response.status(413).json({ error: 'Input exceeds the 100 KB limit.' });
    return;
  }

  if (isJudge0Configured()) {
    try {
      response.json(await runJudge0(code, stdin));
    } catch (error) {
      next(error);
    }
    return;
  }

  let temporaryDirectory;
  try {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'dojo-java-'));
    await writeFile(path.join(temporaryDirectory, 'Main.java'), code, 'utf8');

    const compilation = await runProcess(
      'javac',
      ['-encoding', 'UTF-8', 'Main.java'],
      { cwd: temporaryDirectory, timeoutMs: COMPILE_TIMEOUT_MS },
    );

    if (compilation.timedOut) {
      response.json({
        stdout: compilation.stdout,
        stderr: compilation.stderr || 'Compilation exceeded the 15 second limit.',
        exitCode: compilation.exitCode,
        executionTimeMs: 0,
        status: 'compile_timeout',
      });
      return;
    }
    if (compilation.outputLimitExceeded) {
      response.json({
        stdout: compilation.stdout,
        stderr: compilation.stderr,
        exitCode: compilation.exitCode,
        executionTimeMs: 0,
        status: 'output_limit',
      });
      return;
    }
    if (compilation.exitCode !== 0) {
      response.json({
        stdout: compilation.stdout,
        stderr: compilation.stderr,
        exitCode: compilation.exitCode,
        executionTimeMs: 0,
        status: 'compile_error',
      });
      return;
    }

    const startedAt = performance.now();
    const execution = await runProcess(
      'java',
      ['-Dfile.encoding=UTF-8', '-cp', temporaryDirectory, 'Main'],
      { cwd: temporaryDirectory, stdin, timeoutMs: RUN_TIMEOUT_MS },
    );
    const executionTimeMs = Math.round(performance.now() - startedAt);

    response.json({
      stdout: execution.stdout,
      stderr: execution.stderr,
      exitCode: execution.exitCode,
      executionTimeMs,
      status: execution.timedOut
        ? 'timeout'
        : execution.outputLimitExceeded
          ? 'output_limit'
          : execution.exitCode === 0
            ? 'success'
            : 'runtime_error',
    });
  } catch (error) {
    next(error);
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
});

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    runner: isJudge0Configured() ? 'hosted' : 'local',
  });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(projectDirectory, 'dist')));
  app.get('*path', (_request, response) => {
    response.sendFile(path.join(projectDirectory, 'dist', 'index.html'));
  });
}

app.use((error, _request, response, _next) => {
  if (error.type === 'entity.too.large') {
    response.status(413).json({ error: 'Request body exceeds the size limit.' });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({ error: 'Request body must be valid JSON.' });
    return;
  }
  console.error('Java runner request failed:', error);
  response.status(500).json({
    error: 'The local Java runner could not complete this request. Check that JDK 17+ is installed.',
  });
});

if (process.env.PUBLIC_HOSTED_RUNNER_REQUIRED === 'true' && !isJudge0Configured()) {
  throw new Error('JUDGE0_API_URL is required when PUBLIC_HOSTED_RUNNER_REQUIRED=true.');
}

app.listen(PORT, HOST, () => {
  console.log(`Dojo Java runner listening at http://${HOST}:${PORT}`);
});
