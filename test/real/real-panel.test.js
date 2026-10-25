// -----------------------------------------------------------------------------
// The integration against a REAL Pterodactyl (or Pelican) panel, with a real
// Wings and a real server: skipped unless PTERODACTYL_URL and PTERODACTYL_KEY
// are set (`npm run test:real`). It starts, stops and restarts the server
// PTERODACTYL_SERVER (an identifier): never point it at a server in use.
//
// With PTERODACTYL_CRASH_COMMAND, a console command that makes the server
// process exit (the test server of the README answers `crash`), it also
// checks the crash detection: Wings restarts a crashed server that ran more
// than a minute, and the integration must tell it from a stop.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { TRIGGERS } from '../../src/hub.js';

process.env.LOG_LEVEL ??= 'info';

const { PTERODACTYL_URL, PTERODACTYL_KEY, PTERODACTYL_SERVER, PTERODACTYL_CRASH_COMMAND } =
  process.env;
const skip = !PTERODACTYL_URL || !PTERODACTYL_KEY || !PTERODACTYL_SERVER;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read the panel every 5 s until `check` holds. */
async function until(hub, check, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    await hub.pollAll();
    if (check()) {
      return;
    }
    assert.ok(Date.now() < end, 'timed out');
    await pause(5_000);
  }
}

test(
  'a real panel: devices, switch, scene actions, events, crash',
  { skip, timeout: 600_000 },
  async () => {
    const gladys = createFakeGladys({
      config: {
        panel_url: PTERODACTYL_URL,
        api_key: PTERODACTYL_KEY,
        allow_console: true,
        language: 'en',
      },
    });
    const app = registerHandlers(gladys, { timers: false });
    await gladys.connect();
    await app.ready;
    const { hub } = app;
    const fake = gladys.fake;
    try {
      assert.equal(hub.panel.reachable, true, JSON.stringify(hub.panel.error));
      const record = [...hub.records.values()].find(
        (r) => r.server.identifier === PTERODACTYL_SERVER,
      );
      assert.ok(record, `server ${PTERODACTYL_SERVER} found among ${hub.records.size}`);
      for (const device of fake.discoveredDevices) {
        await fake.deviceCreated(device);
      }
      const device = fake.discoveredDevices.find((d) => d.name === record.server.name);
      const power = device.features.find((f) => f.external_id.endsWith(':power'));
      const events = (key) => fake.sceneEvents.filter((event) => event.key === key);

      // Start from a stopped server.
      if (record.state !== 'offline') {
        await fake.sceneAction('stop_server', { device: device.external_id });
        await until(hub, () => record.state === 'offline');
      }
      const report = await fake.action('test_connection', {});
      console.log(report.data ?? report);

      // The switch starts it.
      await fake.setValue(device, power, 1);
      assert.equal(fake.lastState(power.external_id), 1, 'the switch shows the order at once');
      await until(hub, () => record.state === 'running');
      assert.equal(events(TRIGGERS.SERVER_STARTED).length, 1);
      assert.equal(events(TRIGGERS.SERVER_CRASHED).length, 0);
      const stateFeature = device.features.find((f) => f.external_id.endsWith(':state'));
      assert.equal(fake.lastState(stateFeature.external_id), 'Running');

      // A console command, then the read action.
      const command = await fake.sceneAction('send_command', {
        device: device.external_id,
        command: 'say hello from Gladys',
      });
      assert.equal(command.success, true, command.error);
      const read = await fake.sceneAction('read_server', { device: device.external_id });
      assert.equal(read.success, true, read.error);
      console.log('read_server', read.data.outputs);
      assert.equal(read.data.outputs.running, true);

      const stops = events(TRIGGERS.SERVER_STOPPED).length;
      if (PTERODACTYL_CRASH_COMMAND) {
        // Wings restarts a crashed server only when it ran more than a minute.
        await pause(65_000);
        await hub.pollAll();
        await fake.sceneAction('send_command', {
          device: device.external_id,
          command: PTERODACTYL_CRASH_COMMAND,
        });
        // The command is not a stop order: forget it was sent from here.
        record.order = null;
        await until(hub, () => events(TRIGGERS.SERVER_CRASHED).length === 1);
        await until(hub, () => record.state === 'running');
        assert.equal(events(TRIGGERS.SERVER_STOPPED).length, stops, 'a crash is not a stop');
      }

      // A restart ordered from Gladys is no crash.
      const crashes = events(TRIGGERS.SERVER_CRASHED).length;
      await fake.sceneAction('restart_server', { device: device.external_id });
      await pause(20_000);
      await until(hub, () => record.state === 'running' && record.resources.uptimeMs < 60_000);
      assert.equal(events(TRIGGERS.SERVER_CRASHED).length, crashes, 'an ordered restart');

      // The scene action stops it: a stop, not a crash.
      await fake.sceneAction('stop_server', { device: device.external_id });
      await until(hub, () => record.state === 'offline');
      assert.equal(events(TRIGGERS.SERVER_STOPPED).length, stops + 1);
      assert.equal(events(TRIGGERS.SERVER_CRASHED).length, crashes);
      assert.equal(fake.lastState(power.external_id), 0);
      console.log(
        'events',
        fake.sceneEvents.map((event) => `${event.key} ${JSON.stringify(event.data)}`),
      );

      // Kill stays disabled by default.
      const kill = await fake.sceneAction('kill_server', { device: device.external_id });
      assert.equal(kill.success, false);
    } finally {
      await app.stop();
    }
  },
);
