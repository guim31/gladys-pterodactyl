// -----------------------------------------------------------------------------
// Client of the Pterodactyl (and Pelican) client API: the API every user of a
// panel has, with a client key (`ptlc_…`, Account → API Credentials). Five
// calls, all checked against a real Pterodactyl 1.15 panel and Wings:
//
//   GET  /api/client                          the servers of the user (pages of 50)
//   GET  /api/client/servers/<id>/resources   state, CPU, memory, disk, uptime
//   GET  /api/client/servers/<id>/activity    who started or stopped it (crash detection)
//   POST /api/client/servers/<id>/power       { signal: start | stop | restart | kill }
//   POST /api/client/servers/<id>/command     a console command
//
// The panel caches `resources` about 20 s; it answers 409 while a server is
// installing, suspended or transferred, and 502 for a console command sent to
// a stopped server. Errors keep no detail that could hold the key.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  /** No answer: wrong address, panel down, DNS, timeout. */
  UNREACHABLE: 'unreachable',
  /** The HTTPS certificate does not verify. */
  TLS: 'tls',
  /** 401: wrong or deleted key. */
  AUTH: 'auth',
  /** 403: the key or the subuser lacks a permission. */
  FORBIDDEN: 'forbidden',
  /** 404: unknown server (deleted, or no longer shared with the user). */
  NOT_FOUND: 'not_found',
  /** 409: installing, suspended, transferred, restoring a backup. */
  CONFLICT: 'conflict',
  /** 502 to a console command: the server is not running. */
  NOT_RUNNING: 'not_running',
  /** 5xx: the panel cannot reach the node (Wings) of the server. */
  NODE: 'node',
  /** 429: the panel rate limit (720 requests a minute by default). */
  RATE_LIMITED: 'rate_limited',
  /** An answer that is not the API of a panel. */
  PROTOCOL: 'protocol',
});

export const POWER_SIGNALS = ['start', 'stop', 'restart', 'kill'];

// One page of the list holds 50 servers: four pages at most.
export const MAX_SERVERS = 200;
const PER_PAGE = 50;

export class PanelError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message safe to log: never the key
   * @param {number} [status] HTTP status
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'PanelError';
    this.kind = kind;
    this.status = status;
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);

/**
 * The panel address as typed (`panel.example.com`, `http://192.168.1.20:8080/`)
 * made absolute, without its trailing slash. HTTPS when no scheme is given.
 * @returns {string|null} null when it is not an address
 */
export function normalizePanelUrl(typed) {
  const text = typeof typed === 'string' ? typed.trim() : '';
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username) {
    return null;
  }
  // A panel served under a path (`/panel`) keeps it; the API path is added after.
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api(\/client)?$/i, '');
  return `${url.protocol}//${url.host}${path}`;
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** A server of the list, kept to what the integration uses. */
export function parseServer(item) {
  const a = item?.attributes ?? {};
  if (typeof a.uuid !== 'string' || typeof a.identifier !== 'string') {
    return null;
  }
  const limits = a.limits ?? {};
  // Pelican drops some booleans of Pterodactyl and keeps `status`.
  const status = typeof a.status === 'string' ? a.status : null;
  return {
    uuid: a.uuid,
    identifier: a.identifier,
    name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : a.identifier,
    node: typeof a.node === 'string' ? a.node : '',
    limits: {
      memoryMb: Math.max(0, finite(limits.memory)),
      diskMb: Math.max(0, finite(limits.disk)),
      cpuPercent: Math.max(0, finite(limits.cpu)),
    },
    status:
      a.is_suspended === true
        ? 'suspended'
        : a.is_installing === true && status === null
          ? 'installing'
          : a.is_transferring === true
            ? 'transferring'
            : status,
    nodeMaintenance: a.is_node_under_maintenance === true,
  };
}

/** The `resources` of a server, in the units of the integration. */
export function parseResources(body) {
  const a = body?.attributes;
  const state = a?.current_state;
  if (!['running', 'starting', 'stopping', 'offline'].includes(state)) {
    throw new PanelError(ERROR_KINDS.PROTOCOL, 'Unexpected resources answer');
  }
  const r = a.resources ?? {};
  return {
    state,
    suspended: a.is_suspended === true,
    cpuPercent: Math.max(0, finite(r.cpu_absolute)),
    memoryBytes: Math.max(0, finite(r.memory_bytes)),
    diskBytes: Math.max(0, finite(r.disk_bytes)),
    rxBytes: Math.max(0, finite(r.network_rx_bytes)),
    txBytes: Math.max(0, finite(r.network_tx_bytes)),
    uptimeMs: Math.max(0, finite(r.uptime)),
  };
}

/** The activity log entries, newest first: { event, at (ms), command }. */
export function parseActivity(body) {
  if (!Array.isArray(body?.data)) {
    throw new PanelError(ERROR_KINDS.PROTOCOL, 'Unexpected activity answer');
  }
  return body.data
    .map((item) => item?.attributes ?? {})
    .filter((a) => typeof a.event === 'string' && typeof a.timestamp === 'string')
    .map((a) => ({
      event: a.event,
      at: Date.parse(a.timestamp),
      command: typeof a.properties?.command === 'string' ? a.properties.command : null,
    }))
    .filter((entry) => Number.isFinite(entry.at));
}

/** A network failure, as a PanelError that keeps no detail. */
export function toPanelError(err, host) {
  if (err instanceof PanelError) {
    return err;
  }
  const code = err?.code ?? err?.cause?.code;
  if (TLS_CODES.has(code) || /certificate/i.test(String(err?.message))) {
    return new PanelError(ERROR_KINDS.TLS, `${host}: certificate not trusted`);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new PanelError(ERROR_KINDS.UNREACHABLE, `${host}: name not found`);
  }
  return new PanelError(ERROR_KINDS.UNREACHABLE, `${host}: no answer (${code ?? 'error'})`);
}

function statusError(status, body) {
  let detail = '';
  try {
    detail = JSON.parse(body)?.errors?.[0]?.detail ?? '';
  } catch {
    // Not JSON: a proxy page, a login page...
  }
  const where = `HTTP ${status}${detail ? `: ${String(detail).slice(0, 120)}` : ''}`;
  if (status === 401) {
    return new PanelError(ERROR_KINDS.AUTH, where, status);
  }
  if (status === 403) {
    return new PanelError(ERROR_KINDS.FORBIDDEN, where, status);
  }
  if (status === 404) {
    return new PanelError(ERROR_KINDS.NOT_FOUND, where, status);
  }
  if (status === 409) {
    return new PanelError(ERROR_KINDS.CONFLICT, where, status);
  }
  if (status === 429) {
    return new PanelError(ERROR_KINDS.RATE_LIMITED, where, status);
  }
  if (status === 502 && /must be online/i.test(detail)) {
    return new PanelError(ERROR_KINDS.NOT_RUNNING, where, status);
  }
  if (status >= 500) {
    return new PanelError(ERROR_KINDS.NODE, where, status);
  }
  return new PanelError(ERROR_KINDS.PROTOCOL, where, status);
}

export class PanelClient {
  /**
   * @param {object} options
   * @param {string} options.url normalized panel URL (normalizePanelUrl)
   * @param {string} options.apiKey client API key
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {number} [options.timeoutMs]
   * @param {Function} [options.request] httpRequest seam (tests)
   */
  constructor({ url, apiKey, insecure = false, timeoutMs = 10_000, request = httpRequest }) {
    this.url = url;
    this.host = new URL(url).host;
    this.apiKey = apiKey;
    this.insecure = insecure;
    this.timeoutMs = timeoutMs;
    this.request = request;
  }

  async call(method, path, payload) {
    let response;
    try {
      response = await this.request(`${this.url}/api/client${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: 'Application/vnd.pterodactyl.v1+json',
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw toPanelError(err, this.host);
    }
    if (response.status < 200 || response.status >= 300) {
      throw statusError(response.status, response.body);
    }
    if (response.status === 204 || response.body === '') {
      return null;
    }
    try {
      return JSON.parse(response.body);
    } catch {
      throw new PanelError(
        ERROR_KINDS.PROTOCOL,
        `HTTP ${response.status}: not the API of a panel`,
        response.status,
      );
    }
  }

  /** Every server the key can see (owned or shared), MAX_SERVERS at most. */
  async listServers() {
    const servers = [];
    for (let page = 1; page <= MAX_SERVERS / PER_PAGE; page += 1) {
      const body = await this.call('GET', `?page=${page}&per_page=${PER_PAGE}`);
      if (!Array.isArray(body?.data)) {
        throw new PanelError(ERROR_KINDS.PROTOCOL, 'Unexpected server list');
      }
      servers.push(...body.data.map(parseServer).filter(Boolean));
      const pages = body.meta?.pagination?.total_pages ?? 1;
      if (page >= pages) {
        break;
      }
    }
    return servers;
  }

  async resources(identifier) {
    return parseResources(
      await this.call('GET', `/servers/${encodeURIComponent(identifier)}/resources`),
    );
  }

  async activity(identifier) {
    return parseActivity(
      await this.call('GET', `/servers/${encodeURIComponent(identifier)}/activity?sort=-timestamp`),
    );
  }

  async power(identifier, signal) {
    if (!POWER_SIGNALS.includes(signal)) {
      throw new PanelError(ERROR_KINDS.PROTOCOL, `Unknown power signal ${signal}`);
    }
    await this.call('POST', `/servers/${encodeURIComponent(identifier)}/power`, { signal });
  }

  async command(identifier, command) {
    await this.call('POST', `/servers/${encodeURIComponent(identifier)}/command`, { command });
  }
}
