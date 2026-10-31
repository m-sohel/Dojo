import { isJudge0Configured, runJudge0 } from '../server/judge0.js';

const MAX_SOURCE_BYTES = 100 * 1024;
const MAX_STDIN_BYTES = 100 * 1024;

function readBody(request) {
  if (request.body !== undefined) {
    if (Buffer.isBuffer(request.body)) {
      try {
        return JSON.parse(request.body.toString('utf8'));
      } catch {
        return null;
      }
    }
    if (typeof request.body === 'string') {
      try {
        return JSON.parse(request.body);
      } catch {
        return null;
      }
    }
    return request.body;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > MAX_SOURCE_BYTES + MAX_STDIN_BYTES + 1024) {
        reject(Object.assign(new Error('Request body exceeds the size limit.'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    request.on('error', reject);
  });
}

function respondError(response, status, message) {
  return response.status(status).json({ error: message });
}

export default async function run(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return respondError(response, 405, 'Use POST to run Java code.');
  }

  if (!isJudge0Configured()) {
    return respondError(
      response,
      503,
      'Hosted Java execution is not configured. Add JUDGE0_API_URL to the Vercel project environment variables.',
    );
  }

  try {
    const body = await readBody(request);
    const { code, stdin } = body ?? {};
    if (typeof code !== 'string' || typeof stdin !== 'string') {
      return respondError(response, 400, 'Code and stdin must both be strings.');
    }
    if (Buffer.byteLength(code, 'utf8') > MAX_SOURCE_BYTES) {
      return respondError(response, 413, 'Code exceeds the 100 KB limit.');
    }
    if (Buffer.byteLength(stdin, 'utf8') > MAX_STDIN_BYTES) {
      return respondError(response, 413, 'Input exceeds the 100 KB limit.');
    }

    return response.status(200).json(await runJudge0(code, stdin));
  } catch (error) {
    if (error.statusCode === 413) {
      return respondError(response, 413, error.message);
    }
    console.error('Hosted Java run failed:', error);
    return respondError(
      response,
      502,
      error instanceof Error ? error.message : 'The hosted Java runner could not complete this request.',
    );
  }
}
