import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Poll only an explicitly not-ready state. Assertion, HTTP and protocol failures are not retried. */
export async function until(label, read, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

export async function readEndpoint(dataDir) {
  let endpoint;
  let credential;
  try {
    endpoint = JSON.parse(await readFile(path.join(dataDir, 'endpoint.json'), 'utf8'));
    credential = JSON.parse(await readFile(path.join(dataDir, 'auth/token'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError)
      throw new Error('Invalid service endpoint or credential JSON');
    throw error;
  }
  assert.equal(endpoint.version, 1);
  assert.equal(endpoint.protocolVersion, '1');
  assert.equal(endpoint.host, '127.0.0.1');
  assert.ok(Number.isInteger(endpoint.port) && endpoint.port > 0 && endpoint.port < 65536);
  assert.equal(endpoint.url, `http://127.0.0.1:${endpoint.port}`);
  assert.ok(Number.isInteger(endpoint.pid) && endpoint.pid > 1);
  assert.equal(credential.serviceId, endpoint.serviceId);
  assert.equal(typeof credential.token, 'string');
  assert.ok(credential.token.length >= 32);
  return { ...endpoint, token: credential.token };
}

/** Talks only to the service this test's app published. Never exposes the token to the renderer. */
export function serviceClient(endpoint) {
  async function request(route, method = 'GET', body, expected = 200, authenticated = true) {
    assert.ok(route.startsWith('/v1/'));
    const response = await fetch(`${endpoint.url}${route}`, {
      method,
      headers: {
        ...(authenticated ? { authorization: `Bearer ${endpoint.token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(35000),
      redirect: 'error',
    });
    // Do not dump request bodies, headers, or provider responses into CI logs.
    assert.equal(response.status, expected, `${method} ${route}: HTTP ${response.status}`);
    return response.json();
  }
  return { request, endpoint };
}

export async function openEvents(endpoint) {
  const frames = [];
  let failure;
  const socket = new WebSocket(endpoint.url.replace('http:', 'ws:') + '/v1/stream', [
    'ai.v1',
    `ai.auth.${endpoint.token}`,
  ]);
  socket.addEventListener('message', (event) => {
    try {
      frames.push(JSON.parse(String(event.data)));
    } catch {
      failure = new Error('Invalid service stream frame');
    }
  });
  socket.addEventListener('error', () => {
    failure = new Error('Service stream failed');
  });
  const check = () => {
    if (failure) throw failure;
  };
  try {
    await until('service WebSocket opens', () => {
      check();
      return socket.readyState === WebSocket.OPEN;
    });
    socket.send(JSON.stringify({ type: 'subscribe', epoch: 0, seq: 0, status: true }));
    return {
      frames,
      async waitFor(predicate) {
        return until('service stream event', () => {
          check();
          return frames.find(predicate);
        });
      },
      close: () => socket.close(),
    };
  } catch (error) {
    socket.close();
    throw error;
  }
}
