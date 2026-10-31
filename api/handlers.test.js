import assert from 'node:assert/strict';
import test from 'node:test';
import health from './health.js';
import run from './run.js';

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('Vercel health reports the hosted runner setup state', () => {
  const previousUrl = process.env.JUDGE0_API_URL;
  delete process.env.JUDGE0_API_URL;
  try {
    const response = createResponse();
    health({}, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.runner, 'unconfigured');
    assert.equal(response.headers['Cache-Control'], 'no-store');
  } finally {
    if (previousUrl === undefined) delete process.env.JUDGE0_API_URL;
    else process.env.JUDGE0_API_URL = previousUrl;
  }
});

test('Vercel run validates requests and requires hosted configuration', async () => {
  const previousUrl = process.env.JUDGE0_API_URL;
  delete process.env.JUDGE0_API_URL;
  try {
    const wrongMethod = createResponse();
    await run({ method: 'GET' }, wrongMethod);
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.Allow, 'POST');

    const missingConfig = createResponse();
    await run({ method: 'POST', body: { code: 'class Main {}', stdin: '' } }, missingConfig);
    assert.equal(missingConfig.statusCode, 503);
    assert.match(missingConfig.body.error, /JUDGE0_API_URL/);

    process.env.JUDGE0_API_URL = 'https://judge.example.test';
    const invalidBody = createResponse();
    await run({ method: 'POST', body: { code: 4, stdin: '' } }, invalidBody);
    assert.equal(invalidBody.statusCode, 400);
  } finally {
    if (previousUrl === undefined) delete process.env.JUDGE0_API_URL;
    else process.env.JUDGE0_API_URL = previousUrl;
  }
});

test('Vercel run proxies submissions to the hosted Java runner', async () => {
  const previousUrl = process.env.JUDGE0_API_URL;
  const previousKey = process.env.JUDGE0_API_KEY;
  const previousFetch = globalThis.fetch;
  const requests = [];
  process.env.JUDGE0_API_URL = 'https://judge.example.test';
  process.env.JUDGE0_API_KEY = 'test-secret';
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const payload = requests.length === 1
      ? { token: 'vercel-token' }
      : {
          status: { id: 3, description: 'Accepted' },
          stdout: Buffer.from('42').toString('base64'),
          time: '0.01',
        };
    return new Response(JSON.stringify(payload), { status: 200 });
  };

  try {
    const response = createResponse();
    await run({
      method: 'POST',
      body: { code: 'public class Main {}', stdin: '40' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, 'success');
    assert.equal(response.body.stdout, '42');
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(requests[0].options.headers['X-RapidAPI-Key'], 'test-secret');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.JUDGE0_API_URL;
    else process.env.JUDGE0_API_URL = previousUrl;
    if (previousKey === undefined) delete process.env.JUDGE0_API_KEY;
    else process.env.JUDGE0_API_KEY = previousKey;
  }
});
