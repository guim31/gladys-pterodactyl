// -----------------------------------------------------------------------------
// The hub against the fake panel: discovery, states, the three scene events
// (started, stopped, crashed) and how a crash is told from a stop, the power
// orders of the switch and the scene actions, a panel or a node going down,
// the configuration mistakes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS } from '../src/hub.js';
import {
  CONFIG,
  createAll,
  createWorld,
  deviceId,
  events,
  featureId,
  makeServer,
  tick,
} from './helpers/world.js';

async function world(t, { servers, config = {} } = {}) {
  const server = makeServer({ name: 'Survival' });
  const w = await createWorld({
    servers: servers ?? [server],
    config: { ...CONFIG, ...config },
  });
  t.after(() => w.app.stop());
  await createAll(w);
  return { ...w, server: servers?.[0] ?? server };
}

const state = (w, key, server = w.server) => w.fake.lastState(featureId(w.gladys, server, key));

/** Start the server on the panel and read it until it has run `ms`. */
async function running(w, ms = 5 * 60_000) {
  w.panel.power(w.server, 'start');
  await tick(w, ms);
}

test('one device per server of the panel, with its limits as params', async (t) => {
  const w = await world(t, {
    servers: [
      makeServer({ name: 'Survival' }),
      makeServer({ name: 'Creative', limits: { memory: 0, disk: 0, cpu: 0 } }),
    ],
  });
  const devices = w.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Survival', 'Creative'],
  );
  const [survival, creative] = devices;
  assert.equal(survival.external_id, deviceId(w.gladys, w.panel.servers[0]));
  assert.deepEqual(
    survival.params.map((p) => [p.name, p.value]),
    [
      ['IDENTIFIER', w.panel.servers[0].identifier],
      ['NODE', 'node1'],
      ['MEMORY_LIMIT_MB', '2048'],
      ['DISK_LIMIT_MB', '10240'],
      ['CPU_LIMIT_PERCENT', '200'],
    ],
  );
  const cpu = (device) => device.features.find((f) => f.external_id.endsWith(':cpu'));
  assert.equal(cpu(survival).max, 200, 'the CPU limit of the server');
  assert.equal(cpu(creative).max, 400, 'four cores without a limit');
  assert.equal(state(w, 'state'), 'Stopped');
  assert.equal(state(w, 'power'), 0);
});

test('the states of a running server, in megabytes and hours', async (t) => {
  const w = await world(t);
  await running(w, 90 * 60_000);
  assert.equal(state(w, 'power'), 1);
  assert.equal(state(w, 'state'), 'Running');
  assert.equal(state(w, 'cpu'), 12.3);
  assert.equal(state(w, 'memory'), 512);
  assert.equal(state(w, 'disk'), 300);
  assert.equal(state(w, 'uptime'), 1.5);
});

test('a server started then stopped from the panel: started, stopped, no crash', async (t) => {
  const w = await world(t);
  await running(w);
  assert.equal(events(w, TRIGGERS.SERVER_STARTED).length, 1);
  w.panel.power(w.server, 'stop');
  await tick(w);
  assert.deepEqual(events(w, TRIGGERS.SERVER_STOPPED), [
    {
      device: deviceId(w.gladys, w.server),
      server: 'Survival',
      node: 'node1',
      uptime_minutes: 5,
    },
  ]);
  assert.deepEqual(events(w, TRIGGERS.SERVER_CRASHED), []);
  assert.equal(state(w, 'uptime'), 0);
});

test('a stop typed in the console of the panel is no crash', async (t) => {
  const w = await world(t);
  await running(w);
  w.panel.command(w.server, 'stop');
  w.panel.stop(w.server);
  await tick(w);
  assert.equal(events(w, TRIGGERS.SERVER_STOPPED).length, 1);
  assert.deepEqual(events(w, TRIGGERS.SERVER_CRASHED), []);
});

test('a crash that stops the server: crashed, not stopped', async (t) => {
  const w = await world(t);
  await running(w, 20 * 60_000);
  w.panel.crash(w.server, { restart: false });
  await tick(w);
  assert.deepEqual(events(w, TRIGGERS.SERVER_CRASHED), [
    {
      device: deviceId(w.gladys, w.server),
      server: 'Survival',
      node: 'node1',
      uptime_minutes: 20,
    },
  ]);
  assert.deepEqual(events(w, TRIGGERS.SERVER_STOPPED), []);
});

test('a crash Wings restarted at once: seen by the uptime, crashed then started', async (t) => {
  const w = await world(t);
  await running(w, 20 * 60_000);
  // Between two readings the process crashes and Wings starts it again.
  w.clock.advance(10_000);
  w.panel.crash(w.server);
  await tick(w, 20_000);
  assert.equal(state(w, 'state'), 'Running', 'the panel never showed it stopped');
  assert.equal(events(w, TRIGGERS.SERVER_CRASHED).length, 1);
  assert.equal(events(w, TRIGGERS.SERVER_STARTED).length, 2);
  // The cache of the panel repeating a reading is no restart.
  await w.hub.pollAll();
  await tick(w, 30_000);
  assert.equal(events(w, TRIGGERS.SERVER_CRASHED).length, 1);
});

test('a restart ordered from the panel is no crash', async (t) => {
  const w = await world(t);
  await running(w);
  w.panel.power(w.server, 'restart');
  await tick(w);
  assert.deepEqual(events(w, TRIGGERS.SERVER_CRASHED), []);
  assert.equal(events(w, TRIGGERS.SERVER_STARTED).length, 2, 'running again');
});

test('without the activity log, only the orders of Gladys tell a stop from a crash', async (t) => {
  const w = await world(t);
  w.panel.activityStatus = 403;
  await running(w);
  await w.fake.sceneAction('stop_server', { device: deviceId(w.gladys, w.server) });
  await tick(w);
  assert.equal(events(w, TRIGGERS.SERVER_STOPPED).length, 1);
  w.panel.power(w.server, 'start');
  await tick(w, 5 * 60_000);
  w.panel.power(w.server, 'stop');
  await tick(w);
  assert.equal(
    events(w, TRIGGERS.SERVER_CRASHED).length,
    1,
    'a stop from the panel looks like a crash',
  );
  const report = await w.fake.action('test_connection', {});
  assert.match(report.data.message.en, /activity log not readable/);
});

test('the switch starts and stops the server, and shows the order at once', async (t) => {
  const w = await world(t);
  const device = w.fake.discoveredDevices[0];
  const power = device.features.find((f) => f.external_id.endsWith(':power'));
  // The panel takes its time: the order is shown until a reading confirms it.
  const start = w.panel.start.bind(w.panel);
  w.panel.start = () => {};
  const ack = await w.fake.setValue(device, power, 1);
  assert.equal(ack.success, true, ack.error);
  assert.equal(state(w, 'power'), 1);
  assert.equal(state(w, 'state'), 'Starting');
  await tick(w);
  assert.equal(state(w, 'state'), 'Starting', 'the cached reading does not undo the order');
  start(w.server);
  await tick(w);
  assert.equal(state(w, 'state'), 'Running');
  await w.fake.setValue(device, power, 0);
  assert.equal(state(w, 'power'), 0);
  await tick(w);
  assert.equal(state(w, 'state'), 'Stopped');
  assert.equal(events(w, TRIGGERS.SERVER_STOPPED).length, 1);
  assert.deepEqual(
    w.panel.requests.filter((r) => r.path.endsWith('/power')).map((r) => JSON.parse(r.body).signal),
    ['start', 'stop'],
  );
});

test('an order that never shows is given up after 90 s', async (t) => {
  const w = await world(t);
  w.panel.start = () => {};
  await w.fake.sceneAction('start_server', { device: deviceId(w.gladys, w.server) });
  await tick(w, 60_000);
  assert.equal(state(w, 'state'), 'Starting');
  await tick(w, 60_000);
  assert.equal(state(w, 'state'), 'Stopped');
});

test('kill and console commands are refused unless allowed', async (t) => {
  const w = await world(t);
  await running(w);
  const device = deviceId(w.gladys, w.server);
  const kill = await w.fake.sceneAction('kill_server', { device });
  assert.equal(kill.success, false);
  assert.match(kill.error, /disabled/);
  const command = await w.fake.sceneAction('send_command', { device, command: 'say hi' });
  assert.equal(command.success, false);
  assert.match(command.error, /disabled/);
  assert.ok(!w.panel.requests.some((r) => /\/(command|power)$/.test(r.path)));

  await w.fake.configUpdated({ ...CONFIG, allow_kill: true, allow_console: true });
  assert.equal(
    (await w.fake.sceneAction('send_command', { device, command: 'say hi' })).success,
    true,
  );
  assert.equal((await w.fake.sceneAction('kill_server', { device })).success, true);
  await tick(w);
  assert.equal(events(w, TRIGGERS.SERVER_STOPPED).length, 1, 'a kill is an order');
  const offline = await w.fake.sceneAction('send_command', { device, command: 'say hi' });
  assert.equal(offline.error, 'Survival: the server is not running');
});

test('read_server hands the state to the next actions', async (t) => {
  const w = await world(t);
  await running(w, 75 * 60_000);
  const ack = await w.fake.sceneAction('read_server', { device: deviceId(w.gladys, w.server) });
  assert.deepEqual(ack.data.outputs, {
    running: true,
    state: 'Running',
    cpu: 12.3,
    memory_mb: 512,
    disk_mb: 300,
    uptime_minutes: 75,
    server: 'Survival',
  });
  const unknown = await w.fake.sceneAction('read_server', { device: 'ext:other:server:1' });
  assert.equal(unknown.success, false);
});

test('CPU and memory are sent at most once a minute', async (t) => {
  const w = await world(t);
  await running(w);
  const count = () =>
    w.fake.states.filter(
      (s) => s.device_feature_external_id === featureId(w.gladys, w.server, 'cpu'),
    ).length;
  const before = count();
  for (let i = 0; i < 4; i += 1) {
    w.server.cpu = 30 + i;
    await tick(w, 30_000);
  }
  assert.equal(count() - before, 2);
});

test('a suspended server shows it, without orders', async (t) => {
  const w = await world(t, { servers: [makeServer({ name: 'Old', status: 'suspended' })] });
  assert.equal(state(w, 'state'), 'Suspended');
  assert.equal(state(w, 'power'), 0);
  const ack = await w.fake.sceneAction('start_server', { device: deviceId(w.gladys, w.server) });
  assert.match(ack.error, /Old: busy/);
});

test('a node down: unreachable, then a new starting point without events', async (t) => {
  const w = await world(t);
  await running(w);
  w.panel.nodeDown = true;
  w.panel.stop(w.server);
  await tick(w);
  assert.equal(state(w, 'state'), 'Unreachable');
  const transports = w.fake.transports.filter(
    (e) => e.device_external_id === deviceId(w.gladys, w.server),
  );
  assert.equal(transports.at(-1).transport, 'unreachable');
  w.panel.nodeDown = false;
  await tick(w);
  assert.equal(state(w, 'state'), 'Stopped');
  assert.deepEqual(events(w, TRIGGERS.SERVER_CRASHED), []);
  assert.equal(w.fake.transports.at(-1).transport, 'cloud', 'panel.example.com is on the Internet');
});

test('a panel down then back: connection status and transports', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.connectionStatus.connected, true);
  w.panel.down = true;
  await tick(w);
  assert.equal(w.fake.connectionStatus.connected, true, 'one failure is no outage');
  await tick(w);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /panel\.example\.com: panel unreachable/);
  assert.equal(state(w, 'state'), 'Unreachable');
  w.panel.down = false;
  await tick(w);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(state(w, 'state'), 'Stopped');
});

test('servers added and removed on the panel follow', async (t) => {
  const w = await world(t);
  const added = makeServer({ name: 'New' });
  w.panel.servers.push(added);
  await tick(w);
  assert.deepEqual(
    w.fake.discoveredDevices.map((d) => d.name),
    ['Survival', 'New'],
  );
  w.panel.servers.shift();
  await tick(w);
  assert.deepEqual(
    w.fake.discoveredDevices.map((d) => d.name),
    ['New'],
  );
});

test('configuration mistakes are told in the connection status', async (t) => {
  const cases = [
    [{ panel_url: '', api_key: '' }, /Enter the address of your panel/],
    [{ panel_url: 'http://', api_key: 'ptlc_x' }, /Panel address not understood/],
    [{ api_key: 'ptla_ApplicationKey' }, /application key \(ptla_\)/],
    [{ api_key: 'ptlc_wrong' }, /API key refused/],
  ];
  for (const [config, message] of cases) {
    const w = await createWorld({ config: { ...CONFIG, ...config } });
    t.after(() => w.app.stop());
    assert.equal(w.fake.connectionStatus.connected, false);
    assert.match(w.fake.connectionStatus.message.en, message);
  }
});

test('a panel with no server for this key says so', async (t) => {
  const w = await world(t, { servers: [] });
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.match(w.fake.connectionStatus.message.en, /sees no server/);
  const report = await w.fake.action('test_connection', {});
  assert.match(report.data.message.en, /0 server/);
});

test('"Test the connection" lists every server, in the four languages', async (t) => {
  const w = await world(t, {
    servers: [
      makeServer({ name: 'Survival', state: 'running', startedAt: Date.UTC(2026, 9, 25) }),
      makeServer({ name: 'Creative' }),
    ],
  });
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  const { message } = ack.data;
  assert.equal(
    message.en,
    [
      'panel.example.com: 2 server(s)',
      'Survival: Running, CPU 12 %, memory 512 MB',
      'Creative: Stopped',
      'activity log readable: crashes told apart from stops',
    ].join('\n'),
  );
  assert.match(
    message.fr,
    /^panel\.example\.com : 2 serveur\(s\)\nSurvival : Démarré, CPU 12 %, mémoire 512 MB/,
  );
  assert.deepEqual(Object.keys(message).sort(), ['de', 'en', 'es', 'fr']);
});

test('Gladys restarted: everything is sent again', async (t) => {
  const w = await world(t);
  await running(w);
  const before = w.fake.states.length;
  await w.hub.resync(w.hub.config);
  assert.ok(w.fake.states.length - before >= 6);
});
