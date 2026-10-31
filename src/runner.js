export async function runJava(code, stdin) {
  const response = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, stdin }),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The Java runner returned an invalid response (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(payload.error || `The Java runner returned HTTP ${response.status}.`);
  }
  return payload;
}
