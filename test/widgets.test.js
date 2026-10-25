// -----------------------------------------------------------------------------
// The `servers` widget: every server, one server with its buttons, the empty
// and error states, the budget of the core, and the buttons' orders.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { formatUptime } from '../src/widgets.js';
import { CONFIG, createAll, createWorld, deviceId, makeServer, tick } from './helpers/world.js';

async function world(t, { servers, config = {} } = {}) {
  const w = await createWorld({
    servers: servers ?? [
      makeServer({ name: 'Survival', state: 'running', startedAt: Date.UTC(2026, 9, 25, 14) }),
      makeServer({ name: 'Creative' }),
    ],
    config: { ...CONFIG, ...config },
  });
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  const { components } = tree;
  assert.ok(components.length <= 8);
  assert.ok(components.filter((c) => c.type === 'button').length <= 4);
  assert.ok(components.filter((c) => c.type === 'value').length <= 6);
  assert.ok(components.filter((c) => c.type === 'status').length <= 1);
  return tree;
}

test('every server: running count and one row each', async (t) => {
  const w = await world(t);
  const { components } = await content(w);
  assert.deepEqual(components[0], {
    type: 'value',
    value: '1/2',
    label: 'Running',
    icon: 'server',
    color: 'success',
  });
  assert.deepEqual(
    components[1].items.map((item) => [item.label, item.value, item.color]),
    [
      ['Survival', 'Running · 12 % · 512 MB', 'success'],
      ['Creative', 'Stopped', 'neutral'],
    ],
  );
});

test('more than ten servers: nine rows and a count', async (t) => {
  const servers = Array.from({ length: 12 }, (_, i) => makeServer({ name: `S${i}` }));
  const w = await world(t, { servers });
  const { components } = await content(w, {}, 'fr');
  const rows = components[1].items;
  assert.equal(rows.length, 10);
  assert.deepEqual([rows[9].label, rows[9].value], ['Autres', '+3']);
});

test('one running server: figures, limits, Restart and Stop confirmed', async (t) => {
  const w = await world(t);
  const [survival] = w.panel.servers;
  const { components } = await content(w, { device: deviceId(w.gladys, survival) }, 'fr');
  const values = components.filter((c) => c.type === 'value');
  assert.deepEqual(
    values.map((c) => [c.label, c.value]),
    [
      ['État', 'Démarré'],
      ['CPU', 12],
      ['Mémoire', '512 MB'],
      ['En marche depuis', '3 h 00'],
    ],
  );
  const [limits] = components.find((c) => c.type === 'status').items;
  assert.equal(limits.value, '2,0 GB · CPU 200 % · disque 10,0 GB');
  const buttons = components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.action.key, b.action.confirm]),
    [
      ['Redémarrer', 'restart', true],
      ['Arrêter', 'stop', true],
    ],
  );
  assert.deepEqual(buttons[0].action.params, { server: survival.uuid });
});

test('one stopped server: a Start button; its tap starts it and says so', async (t) => {
  const w = await world(t);
  const creative = w.panel.servers[1];
  const { components } = await content(w, { device: deviceId(w.gladys, creative) });
  const buttons = components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.action.key),
    ['start'],
  );
  const ack = await w.fake.widgetAction(WIDGET_KEY, 'start', buttons[0].action.params, {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.message, {
    en: 'Start sent to Creative',
    fr: 'Démarrage envoyé à Creative',
    de: 'Start an Creative gesendet',
    es: 'Arranque enviado a Creative',
  });
  assert.equal(creative.state, 'running');
});

test('the Kill button only when allowed, for a server stuck stopping', async (t) => {
  for (const allowKill of [false, true]) {
    const w = await world(t, { config: { allow_kill: allowKill } });
    const [survival] = w.panel.servers;
    survival.state = 'stopping';
    await tick(w);
    const { components } = await content(w, { device: deviceId(w.gladys, survival) });
    const keys = components.filter((c) => c.type === 'button').map((b) => b.action.key);
    assert.deepEqual(keys, allowKill ? ['kill'] : []);
    const ack = await w.fake.widgetAction(WIDGET_KEY, 'kill', { server: survival.uuid }, {});
    assert.equal(ack.success, allowKill);
  }
});

test('the empty and error states are messages', async (t) => {
  const missing = await createWorld({ config: { language: 'en' } });
  t.after(() => missing.app.stop());
  let { components } = await content(missing);
  assert.match(components[0].text, /Enter the address of your panel/);

  const w = await world(t);
  ({ components } = await content(w, { device: 'ext:test-integration:server:gone' }));
  assert.match(components[0].text, /no longer on the panel/);

  w.panel.down = true;
  await tick(w);
  await tick(w);
  ({ components } = await content(w));
  assert.equal(
    components[0].text,
    'panel.example.com: panel unreachable (address, port, network?)',
  );
});

test('the uptime, short', () => {
  assert.equal(formatUptime(12 * 60_000, 'en'), '12 min');
  assert.equal(formatUptime(185 * 60_000, 'en'), '3 h 05');
  assert.equal(formatUptime((2 * 24 + 3) * 3_600_000, 'fr'), '2 j 3 h');
});
