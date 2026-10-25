// -----------------------------------------------------------------------------
// An in-memory Pterodactyl panel with its Wings, behind the `request` seam of
// src/http.js. Its answers are the real ones recorded on Pterodactyl 1.15.2
// (test/fixtures/real), with the values of the servers it holds: a server
// starts, stops, restarts and crashes on demand, the activity log records
// what the API was asked, the panel or the node can go down.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/real/${name}.json`, import.meta.url), 'utf8'));

export const KEY = 'ptlc_TestClientKeyNotARealOne0000000000000000';
export const PANEL_URL = 'https://panel.example.com';

const SERVER_TEMPLATE = fixture('list-two').body.data[1];
const RESOURCES_TEMPLATE = fixture('res-running').body;

let counter = 0;

/** A server of the fake panel. */
export function makeServer(overrides = {}) {
  counter += 1;
  const hex = counter.toString(16).padStart(8, '0');
  return {
    uuid: `${hex}-0000-4000-8000-${hex.padStart(12, '0')}`,
    identifier: hex,
    name: `Server ${counter}`,
    node: 'node1',
    limits: { memory: 2048, disk: 10240, cpu: 200 },
    status: null,
    state: 'offline',
    startedAt: null,
    cpu: 12.345,
    memoryBytes: 512 * 1024 * 1024,
    diskBytes: 300 * 1024 * 1024,
    ...overrides,
  };
}

const json = (status, body) => ({ status, headers: {}, body: JSON.stringify(body) });
const error = (status, code, detail) =>
  json(status, { errors: [{ code, status: String(status), detail }] });

export class FakePanel {
  /**
   * @param {object} options
   * @param {object[]} [options.servers] makeServer() entries
   * @param {() => number} options.now the clock of the test
   */
  constructor({ servers = [makeServer({ name: 'Survival' })], now }) {
    this.servers = servers;
    this.now = now;
    this.key = KEY;
    /** No answer at all (ECONNREFUSED). */
    this.down = false;
    /** Wings unreachable: the panel answers 500 to resources. */
    this.nodeDown = false;
    /** The HTTP status of the activity log, 200 when readable. */
    this.activityStatus = 200;
    /** by identifier: newest first */
    this.activity = new Map();
    this.requests = [];
    this.request = this.request.bind(this);
  }

  find(identifier) {
    return this.servers.find((server) => server.identifier === identifier);
  }

  /** Something done on the panel: in its activity log. */
  log(server, event, properties = {}) {
    const list = this.activity.get(server.identifier) ?? [];
    list.unshift({ event, at: this.now(), properties });
    this.activity.set(server.identifier, list);
  }

  // --- What happens on the node ------------------------------------------------

  start(server) {
    server.state = 'running';
    server.startedAt = this.now();
  }

  stop(server) {
    server.state = 'offline';
    server.startedAt = null;
  }

  /** The process exits on its own; Wings restarts it when it ran more than a minute. */
  crash(server, { restart = true } = {}) {
    if (restart) {
      this.start(server);
    } else {
      this.stop(server);
    }
  }

  // --- The HTTP API --------------------------------------------------------------

  async request(url, { method = 'GET', headers = {}, body } = {}) {
    const target = new URL(url);
    this.requests.push({ method, path: `${target.pathname}${target.search}`, headers, body });
    if (this.down) {
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      throw err;
    }
    if (headers.authorization !== `Bearer ${this.key}`) {
      return json(401, fixture('bad-key').body);
    }
    const path = target.pathname.replace(/^\/api\/client/, '');
    if (path === '' && method === 'GET') {
      return this.list(target);
    }
    const match = path.match(/^\/servers\/([^/]+)\/(resources|activity|power|command)$/);
    const server = match && this.find(decodeURIComponent(match[1]));
    if (!server) {
      return json(404, fixture('not-found').body);
    }
    const payload = body ? JSON.parse(body) : {};
    switch (match[2]) {
      case 'resources':
        return this.resources(server);
      case 'activity':
        return this.activityLog(server);
      case 'power':
        return this.power(server, payload.signal);
      default:
        return this.command(server, payload.command);
    }
  }

  list(target) {
    const perPage = Number(target.searchParams.get('per_page') ?? 50);
    const page = Number(target.searchParams.get('page') ?? 1);
    const slice = this.servers.slice((page - 1) * perPage, page * perPage);
    return json(200, {
      object: 'list',
      data: slice.map((server) => ({
        ...SERVER_TEMPLATE,
        attributes: {
          ...SERVER_TEMPLATE.attributes,
          identifier: server.identifier,
          uuid: server.uuid,
          name: server.name,
          node: server.node,
          limits: { ...SERVER_TEMPLATE.attributes.limits, ...server.limits },
          status: server.status,
          is_suspended: server.status === 'suspended',
          is_installing: server.status === 'installing',
        },
      })),
      meta: {
        pagination: {
          total: this.servers.length,
          count: slice.length,
          per_page: perPage,
          current_page: page,
          total_pages: Math.max(1, Math.ceil(this.servers.length / perPage)),
          links: {},
        },
      },
    });
  }

  resources(server) {
    if (server.status === 'suspended') {
      return json(409, fixture('res-suspended').body);
    }
    if (this.nodeDown) {
      return json(500, fixture('res-node-down').body);
    }
    const running = server.state !== 'offline';
    return json(200, {
      ...RESOURCES_TEMPLATE,
      attributes: {
        current_state: server.state,
        is_suspended: false,
        resources: {
          memory_bytes: running ? server.memoryBytes : 0,
          cpu_absolute: running ? server.cpu : 0,
          disk_bytes: server.diskBytes,
          network_rx_bytes: running ? 6077 : 0,
          network_tx_bytes: running ? 1120 : 0,
          // Wings reports no uptime while starting or stopping (checked).
          uptime:
            server.state === 'running' && server.startedAt !== null
              ? this.now() - server.startedAt
              : 0,
        },
      },
    });
  }

  activityLog(server) {
    if (this.activityStatus !== 200) {
      return error(
        this.activityStatus,
        'AccessDeniedHttpException',
        'This action is unauthorized.',
      );
    }
    const entries = this.activity.get(server.identifier) ?? [];
    return json(200, {
      object: 'list',
      data: entries.map((entry, index) => ({
        object: 'activity_log',
        attributes: {
          id: String(index),
          batch: null,
          event: entry.event,
          is_api: true,
          ip: '192.0.2.10',
          description: null,
          properties: entry.properties,
          has_additional_metadata: false,
          timestamp: new Date(entry.at).toISOString().replace(/\.\d{3}Z$/, '+00:00'),
        },
      })),
      meta: { pagination: { total: entries.length } },
    });
  }

  power(server, signal) {
    if (server.status === 'suspended') {
      return json(409, fixture('res-suspended').body);
    }
    if (!['start', 'stop', 'restart', 'kill'].includes(signal)) {
      return json(422, fixture('power-bad').body);
    }
    this.log(server, `server:power.${signal}`);
    if (signal === 'start' && server.state === 'offline') {
      this.start(server);
    } else if (signal === 'stop' || signal === 'kill') {
      this.stop(server);
    } else if (signal === 'restart') {
      this.start(server);
    }
    return { status: 204, headers: {}, body: '' };
  }

  command(server, command) {
    if (server.state === 'offline') {
      return json(502, fixture('command-offline').body);
    }
    this.log(server, 'server:console.command', { command });
    return { status: 204, headers: {}, body: '' };
  }
}
