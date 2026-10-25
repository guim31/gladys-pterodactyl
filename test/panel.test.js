// -----------------------------------------------------------------------------
// The client of the panel on the real answers of Pterodactyl 1.15.2 and Wings
// (test/fixtures/real, recorded on a test panel: addresses anonymized), and
// the address and key checks of the configuration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import {
  ERROR_KINDS,
  PanelClient,
  PanelError,
  normalizePanelUrl,
  parseActivity,
  parseResources,
  parseServer,
} from '../src/panel.js';
import { fixture } from './helpers/fakePanel.js';

const KEY = 'ptlc_RealLookingButFakeKey000000000000000000';

/** A client whose every request answers this fixture. */
const replay = (name, calls = []) =>
  new PanelClient({
    url: 'https://panel.example.com',
    apiKey: KEY,
    request: async (url, options) => {
      calls.push({ url, options });
      const { status, body } = fixture(name);
      return { status, headers: {}, body: JSON.stringify(body) };
    },
  });

test('the server list: identity, node, limits, statuses', async () => {
  const calls = [];
  const servers = await replay('list-suspended', calls).listServers();
  assert.deepEqual(servers, [
    {
      uuid: '88e742d1-3b8c-499e-9a05-394edd56083c',
      identifier: '88e742d1',
      name: 'Survival',
      node: 'node1',
      limits: { memoryMb: 256, diskMb: 1024, cpuPercent: 50 },
      status: null,
      nodeMaintenance: false,
    },
    {
      uuid: '5e23fe4c-4632-4c07-99fa-5f0128ab00d3',
      identifier: '5e23fe4c',
      name: 'Creative',
      node: 'node1',
      limits: { memoryMb: 0, diskMb: 0, cpuPercent: 0 },
      status: 'suspended',
      nodeMaintenance: false,
    },
  ]);
  assert.equal(calls[0].url, 'https://panel.example.com/api/client?page=1&per_page=50');
  assert.equal(calls[0].options.headers.authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].options.headers.accept, 'Application/vnd.pterodactyl.v1+json');
});

test('the resources of a server running, starting, stopped, restarted by Wings', () => {
  assert.deepEqual(parseResources(fixture('res-running').body), {
    state: 'running',
    suspended: false,
    cpuPercent: 0.002,
    memoryBytes: 561152,
    diskBytes: 129,
    rxBytes: 6077,
    txBytes: 1120,
    uptimeMs: 24389,
  });
  assert.equal(parseResources(fixture('res-starting').body).state, 'starting');
  assert.equal(parseResources(fixture('res-offline').body).uptimeMs, 0);
  // Recorded around a real crash: Wings restarted the process, the state
  // stayed "running" and only the uptime went back.
  const before = parseResources(fixture('res-before-crash').body);
  const after = parseResources(fixture('res-after-crash-restart').body);
  assert.equal(before.state, 'running');
  assert.equal(after.state, 'running');
  assert.ok(after.uptimeMs < before.uptimeMs);
  assert.throws(() => parseResources({ attributes: { current_state: 'weird' } }), PanelError);
});

test('the activity log: power orders and console commands, newest first', () => {
  const entries = parseActivity(fixture('activity-after-crash').body);
  assert.deepEqual(
    entries.map((e) => [e.event, e.command]),
    [
      ['server:console.command', 'crash'],
      ['server:power.start', null],
      ['server:power.stop', null],
      ['server:console.command', 'say hello'],
      ['server:power.start', null],
    ],
  );
  assert.equal(entries[0].at, Date.parse('2026-10-25T11:01:41+00:00'));
});

test('every error of the panel has its kind, and never the key', async () => {
  const cases = [
    ['bad-key', ERROR_KINDS.AUTH, (c) => c.listServers()],
    ['not-found', ERROR_KINDS.NOT_FOUND, (c) => c.resources('deadbeef')],
    ['res-suspended', ERROR_KINDS.CONFLICT, (c) => c.resources('5e23fe4c')],
    ['res-node-down', ERROR_KINDS.NODE, (c) => c.resources('5e23fe4c')],
    ['command-offline', ERROR_KINDS.NOT_RUNNING, (c) => c.command('5e23fe4c', 'say hi')],
    ['power-bad', ERROR_KINDS.PROTOCOL, (c) => c.resources('88e742d1')],
  ];
  for (const [name, kind, call] of cases) {
    await assert.rejects(call(replay(name)), (err) => {
      assert.ok(err instanceof PanelError, name);
      assert.equal(err.kind, kind, name);
      assert.ok(!err.message.includes(KEY));
      return true;
    });
  }
});

test('network failures: unreachable, unknown name, certificate', async () => {
  const failing = (code) =>
    new PanelClient({
      url: 'https://panel.example.com',
      apiKey: KEY,
      request: async () => {
        const err = new Error(`boom ${KEY}`);
        err.code = code;
        throw err;
      },
    });
  const kinds = {
    ECONNREFUSED: ERROR_KINDS.UNREACHABLE,
    ETIMEDOUT: ERROR_KINDS.UNREACHABLE,
    ENOTFOUND: ERROR_KINDS.UNREACHABLE,
    DEPTH_ZERO_SELF_SIGNED_CERT: ERROR_KINDS.TLS,
  };
  for (const [code, kind] of Object.entries(kinds)) {
    await assert.rejects(failing(code).listServers(), (err) => {
      assert.equal(err.kind, kind, code);
      assert.ok(!err.message.includes(KEY), 'the original message is dropped');
      return true;
    });
  }
});

test('a page that is not the API (a login page, a proxy)', async () => {
  const client = new PanelClient({
    url: 'https://panel.example.com',
    apiKey: KEY,
    request: async () => ({ status: 200, headers: {}, body: '<html>Login</html>' }),
  });
  await assert.rejects(client.listServers(), { kind: ERROR_KINDS.PROTOCOL });
});

test('the list is read page by page, 200 servers at most', async () => {
  const pages = [];
  const client = new PanelClient({
    url: 'https://panel.example.com',
    apiKey: KEY,
    request: async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      pages.push(page);
      const item = (i) => ({
        attributes: {
          uuid: `00000000-0000-4000-8000-${String(page * 100 + i).padStart(12, '0')}`,
          identifier: `id${page}-${i}`,
          name: 'x',
          limits: {},
        },
      });
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          data: Array.from({ length: 50 }, (_, i) => item(i)),
          meta: { pagination: { total_pages: 9 } },
        }),
      };
    },
  });
  const servers = await client.listServers();
  assert.equal(servers.length, 200);
  assert.deepEqual(pages, [1, 2, 3, 4]);
});

test('a server without uuid is dropped; a Pelican server without the booleans keeps its status', () => {
  assert.equal(parseServer({ attributes: { name: 'x' } }), null);
  const pelican = parseServer({
    attributes: { uuid: 'u'.repeat(36), identifier: 'abcd1234', name: 'P', status: 'installing' },
  });
  assert.equal(pelican.status, 'installing');
  assert.deepEqual(pelican.limits, { memoryMb: 0, diskMb: 0, cpuPercent: 0 });
});

test('the panel address as typed', () => {
  assert.equal(normalizePanelUrl('panel.example.com'), 'https://panel.example.com');
  assert.equal(normalizePanelUrl(' http://192.168.1.20:8080/ '), 'http://192.168.1.20:8080');
  assert.equal(normalizePanelUrl('https://example.com/panel/'), 'https://example.com/panel');
  assert.equal(
    normalizePanelUrl('https://panel.example.com/api/client'),
    'https://panel.example.com',
  );
  assert.equal(normalizePanelUrl('ftp://panel.example.com'), null);
  assert.equal(normalizePanelUrl('https://user:pass@panel.example.com'), null);
  assert.equal(normalizePanelUrl(''), null);
});

test('the configuration: defaults, key kinds, intervals', () => {
  const empty = normalizeConfig({});
  assert.equal(empty.url, null);
  assert.equal(empty.invalidUrl, false);
  assert.equal(empty.pollIntervalMs, 30_000);
  assert.equal(empty.language, 'fr');
  assert.equal(empty.allowKill, false);
  assert.equal(empty.allowConsole, false);
  const config = normalizeConfig({
    panel_url: 'panel.example.com',
    api_key: ` ${KEY} `,
    poll_interval: '120',
    allow_kill: 'true',
    language: 'de',
  });
  assert.equal(config.apiKey, KEY);
  assert.equal(config.pollIntervalMs, 120_000);
  assert.equal(config.allowKill, true);
  assert.equal(config.language, 'de');
  assert.equal(normalizeConfig({ api_key: 'ptla_x' }).applicationKey, true);
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollIntervalMs, 30_000);
  assert.equal(normalizeConfig({ panel_url: 'http://' }).invalidUrl, true);
});
