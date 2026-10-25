// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing — servers starting and stopping
// included —, a failure that repeats is logged once, and its end once. Never
// the API key, never a console command (it may hold a password).
// (Adapted from guim31/gladys-gamedig.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEY } from './helpers/fakePanel.js';
import { CONFIG, createAll, createWorld, deviceId, makeServer, tick } from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, config = {}) {
  const server = makeServer({ name: 'Survival' });
  const w = await createWorld({
    servers: [server],
    config: { ...CONFIG, allow_console: true, ...config },
  });
  t.after(() => w.app.stop());
  await createAll(w);
  return { ...w, server };
}

test('a normal reading cycle writes nothing at info, servers started from the panel included', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => /Connected to the panel panel\.example\.com: 1 server/.test(text)),
    logs.texts().join('\n'),
  );
  logs.clear();
  for (let i = 0; i < 4; i += 1) {
    w.server.cpu = 10 + i;
    if (i === 1) {
      w.panel.power(w.server, 'start');
    }
    if (i === 3) {
      w.panel.power(w.server, 'stop');
    }
    await tick(w);
  }
  assert.deepEqual(logs.texts(), []);
});

test('a panel that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.panel.down = true;
  for (let i = 0; i < 6; i += 1) {
    await tick(w, 60_000);
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');

  logs.clear();
  w.panel.down = false;
  await tick(w);
  await tick(w);
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again after 6 min/);
});

test('a crash and the orders of the user are one line each', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  await w.fake.sceneAction('start_server', { device: deviceId(w.gladys, w.server) });
  await tick(w, 120_000);
  w.panel.crash(w.server);
  await tick(w, 60_000);
  assert.equal(logs.lines.length, 2, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /"Survival" \([0-9a-f]+\): start sent \(scene\)/);
  assert.match(logs.lines[1].text, /"Survival" \([0-9a-f]+\): crashed, restarted by Wings/);
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.gladys.publishChangedStates = async () => {
    throw new Error('HTTP 429');
  };
  w.panel.power(w.server, 'start');
  for (let i = 0; i < 3; i += 1) {
    w.server.cpu = 20 + i;
    await tick(w, 120_000);
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States of .* refused: HTTP 429/);
});

test('never the API key nor a console command, even in debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  w.panel.power(w.server, 'start');
  await tick(w);
  await w.fake.sceneAction('send_command', {
    device: deviceId(w.gladys, w.server),
    command: 'op SecretFriend42',
  });
  w.panel.key = 'ptlc_another';
  await tick(w);
  await tick(w);
  const text = logs.texts().join('\n');
  assert.match(text, /console command sent/);
  assert.match(text, /HTTP 401/);
  assert.ok(!text.includes(KEY), 'never the key');
  assert.ok(!text.includes('SecretFriend42'), 'never the command');
});
