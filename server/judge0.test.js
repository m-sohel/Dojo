import assert from 'node:assert/strict';
import test from 'node:test';
import { isJudge0Configured, runJudge0 } from './judge0.js';

test('hosted runner submits Java 17 and maps successful output', async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, options });
    const payload = requests.length === 1
      ? { token: 'submission-token' }
      : {
          status: { id: 3, description: 'Accepted' },
          stdout: Buffer.from('42').toString('base64'),
          stderr: null,
          compile_output: null,
          message: null,
          time: '0.012',
        };
    return new Response(JSON.stringify(payload), { status: 200 });
  };

  const result = await runJudge0(
    'public class Main {}',
    '40',
    {
      JUDGE0_API_URL: 'https://judge.example.test/',
      JUDGE0_API_KEY: 'test-secret',
      JUDGE0_API_HOST: 'judge.example.test',
    },
    fetchMock,
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://judge.example.test/submissions?base64_encoded=true&wait=false');
  assert.equal(requests[0].options.headers['X-RapidAPI-Key'], 'test-secret');
  assert.equal(requests[0].options.headers['X-RapidAPI-Host'], 'judge.example.test');
  assert.equal(requests[0].options.signal instanceof AbortSignal, true);
  const submitted = JSON.parse(requests[0].options.body);
  assert.equal(submitted.language_id, 62);
  assert.equal(Buffer.from(submitted.source_code, 'base64').toString('utf8'), 'public class Main {}');
  assert.equal(Buffer.from(submitted.stdin, 'base64').toString('utf8'), '40');
  assert.equal(submitted.cpu_time_limit, 5);
  assert.equal(result.stdout, '42');
  assert.equal(result.status, 'success');
  assert.equal(result.executionTimeMs, 12);
});

test('hosted runner maps compilation errors and runtime timeouts', async (context) => {
  const cases = [
    {
      status: { id: 6, description: 'Compilation Error' },
      compile_output: Buffer.from('missing semicolon').toString('base64'),
      statusName: 'compile_error',
    },
    {
      status: { id: 5, description: 'Time Limit Exceeded' },
      stderr: Buffer.from('time limit exceeded').toString('base64'),
      statusName: 'timeout',
    },
  ];

  for (const sample of cases) {
    await context.test(sample.statusName, async () => {
      let requestCount = 0;
      const fetchMock = async () => {
        requestCount += 1;
        const payload = requestCount === 1
          ? { token: 'submission-token' }
          : { ...sample, time: '0.1' };
        return new Response(JSON.stringify(payload), { status: 200 });
      };

      const result = await runJudge0('class Main {}', '', { JUDGE0_API_URL: 'https://judge.example.test' }, fetchMock);
      assert.equal(result.status, sample.statusName);
      assert.match(result.stderr, /missing semicolon|time limit exceeded/);
    });
  }
});

test('hosted runner reports provider errors without hiding them', async () => {
  const fetchMock = async () => new Response(JSON.stringify({ error: 'Quota exceeded' }), { status: 429 });

  await assert.rejects(
    runJudge0('class Main {}', '', { JUDGE0_API_URL: 'https://judge.example.test' }, fetchMock),
    /HTTP 429: Quota exceeded/,
  );
  assert.equal(isJudge0Configured({}), false);
  assert.equal(isJudge0Configured({ JUDGE0_API_URL: 'https://judge.example.test' }), true);
});
