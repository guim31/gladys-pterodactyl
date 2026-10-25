// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (the real Pterodactyl 1.15.2 answers): servers running, stopped,
// with and without limits, suspended, a node down, in every feature-name
// language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, createAll, createWorld, makeServer, tick } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const servers = () => [
  makeServer({ name: 'Survival', state: 'running', startedAt: Date.UTC(2026, 9, 25, 12) }),
  makeServer({ name: 'Creative', limits: { memory: 0, disk: 0, cpu: 0 } }),
  // Above its limit: Wings lets a server use a little more than its memory.
  makeServer({
    name: 'Modded',
    state: 'running',
    startedAt: Date.UTC(2026, 8, 1),
    cpu: 812.5,
    memoryBytes: 2300 * 1024 * 1024,
  }),
  makeServer({ name: 'Suspended', status: 'suspended' }),
];

const scenarios = [
  { label: 'English names', language: 'en' },
  { label: 'French names', language: 'fr' },
  { label: 'German names', language: 'de' },
  { label: 'Spanish names', language: 'es' },
  { label: 'node down', language: 'en', nodeDown: true },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({
      servers: servers(),
      config: { ...CONFIG, language: scenario.language },
    });
    const { app, fake } = world;
    try {
      await createAll(world);
      if (scenario.nodeDown) {
        world.panel.nodeDown = true;
        await tick(world);
      }
      const devices = fake.discoveredDevices;
      assert.equal(devices.length, 4);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The value read from the fixtures fits the declared bounds; a text is never empty.
          const value = fake.lastState(feature.external_id);
          if (value === undefined) {
            // Only the state of a server Wings cannot report is unknown.
            assert.ok(where === 'Suspended' || scenario.nodeDown, `${at}: no state published`);
            continue;
          }
          if (feature.category === 'text') {
            assert.equal(typeof value, 'string', `${at}: not a text`);
            assert.ok(value.trim().length > 0, `${at}: empty text`);
          } else {
            assert.equal(typeof value, 'number', `${at}: not a number`);
            assert.ok(
              value >= feature.min && value <= feature.max,
              `${at}: ${value} out of bounds`,
            );
            if (feature.type === 'integer' || feature.type === 'binary') {
              assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
            }
          }
        }
        // Every device has a power switch and a state text.
        assert.ok(device.features.some((f) => f.category === 'switch' && !f.read_only));
        assert.ok(device.features.some((f) => f.category === 'text'));
      }
      // Every state went to a feature that exists.
      const known = new Set(devices.flatMap((device) => device.features.map((f) => f.external_id)));
      for (const state of fake.states) {
        assert.ok(known.has(state.device_feature_external_id), state.device_feature_external_id);
      }
    } finally {
      await app.stop();
    }
  });
}
