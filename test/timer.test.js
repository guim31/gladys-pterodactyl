// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys 5.2 never polls a device
// published with should_poll: false (and never polls the devices created
// without should_poll, GladysAssistant/Gladys#3198): the panel must be read
// by the hub's own timer, with no onPoll at all. A first failure is read
// again 15 s later; a power order is followed by quick readings.
// (Adapted from guim31/gladys-gamedig.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS } from '../src/hub.js';
import {
  CONFIG,
  createAll,
  createClock,
  createWorld,
  deviceId,
  events,
  featureId,
  makeServer,
} from './helpers/world.js';

/** Let the timer callback and the fake panel settle. */
const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

async function timed(t, config = { ...CONFIG, poll_interval: '30' }) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = makeServer({ name: 'Survival' });
  const w = await createWorld({ clock: createClock(), servers: [server], config, timers: true });
  t.after(() => w.app.stop());
  return { ...w, server };
}

const reads = (w) => w.panel.requests.filter((r) => r.path.endsWith('/resources')).length;

async function pass(t, w, ms) {
  w.clock.advance(ms);
  t.mock.timers.tick(ms);
  await settle();
}

test('the internal timer reads the panel without any onPoll from Gladys', async (t) => {
  const w = await timed(t);
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  assert.equal(w.fake.discoveredDevices[0].should_poll, false, 'Gladys is not asked to poll');
  const before = reads(w);

  w.panel.power(w.server, 'start');
  await pass(t, w, 30_000);
  assert.equal(w.fake.lastState(featureId(w.gladys, w.server, 'power')), 1);
  w.panel.power(w.server, 'stop');
  await pass(t, w, 30_000);
  assert.equal(w.fake.lastState(featureId(w.gladys, w.server, 'power')), 0);
  assert.equal(reads(w) - before, 2, 'one reading per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
  assert.equal(events(w, TRIGGERS.SERVER_STARTED).length, 1);
  assert.equal(events(w, TRIGGERS.SERVER_STOPPED).length, 1);
});

test('a first failure is read again 15 s later', async (t) => {
  const w = await timed(t, { ...CONFIG, poll_interval: '300' });
  w.panel.down = true;
  await pass(t, w, 300_000);
  assert.equal(w.fake.connectionStatus.connected, true, 'one failure is no outage');
  await pass(t, w, 15_000);
  assert.equal(w.fake.connectionStatus.connected, false);
});

test('a power order is followed by quick readings', async (t) => {
  const w = await timed(t, { ...CONFIG, poll_interval: '300' });
  await createAll(w);
  const before = reads(w);
  await w.fake.sceneAction('start_server', { device: deviceId(w.gladys, w.server) });
  await pass(t, w, 10_000);
  await pass(t, w, 20_000);
  assert.equal(reads(w) - before, 2);
  assert.equal(events(w, TRIGGERS.SERVER_STARTED).length, 1);
});

test('the timer stops with the integration', async (t) => {
  const w = await timed(t);
  await w.app.stop();
  const before = w.panel.requests.length;
  t.mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(w.panel.requests.length, before);
});

test('the timer starts even when Gladys refuses the devices', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { createFakeGladys } = await import('@gladysassistant/integration-sdk/testing');
  const { registerHandlers } = await import('../src/app.js');
  const { FakePanel } = await import('./helpers/fakePanel.js');
  const clock = createClock();
  const panel = new FakePanel({ now: clock.now });
  const gladys = createFakeGladys({ config: CONFIG });
  gladys.publishDiscoveredDevices = async () => {
    throw new Error('HTTP 503');
  };
  const app = registerHandlers(gladys, { request: panel.request, timers: true, now: clock.now });
  t.after(() => app.stop());
  await gladys.connect();
  await app.ready;
  const before = panel.requests.length;
  t.mock.timers.tick(30_000);
  await settle();
  assert.ok(panel.requests.length > before);
});
