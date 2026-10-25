// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake panel (with its Wings)
// and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs unless `timers: true` (with node:test mock
// timers): the tests read the panel with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { FakePanel, KEY, PANEL_URL, makeServer } from './fakePanel.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the fake panel. */
export function createClock(start = Date.UTC(2026, 9, 25, 17, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CONFIG = {
  panel_url: PANEL_URL,
  api_key: KEY,
  language: 'en',
};

/**
 * @param {object} [options]
 * @param {object[]} [options.servers] makeServer() entries
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  servers,
  config = CONFIG,
  devices = [],
  connect = true,
  timings = {},
  timers = false,
} = {}) {
  const panel = new FakePanel({ servers, now: clock.now });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, { request: panel.request, timers, timings, now: clock.now });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, panel, app, hub: app.hub, clock };
}

export const deviceId = (gladys, server) => gladys.externalIds('server', server.uuid).device;
export const featureId = (gladys, server, key) =>
  gladys.externalIds('server', server.uuid).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** The scene events fired with this key. */
export const events = (world, key) =>
  world.fake.sceneEvents.filter((event) => event.key === key).map((event) => event.data);

/** Let time pass, then read the panel. */
export async function tick(world, ms = 30_000) {
  world.clock.advance(ms);
  await world.hub.pollAll();
}

export { makeServer };
