import { isJudge0Configured } from '../server/judge0.js';

export default function health(_request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.status(200).json({
    status: 'ok',
    runner: isJudge0Configured() ? 'hosted' : 'unconfigured',
  });
}
