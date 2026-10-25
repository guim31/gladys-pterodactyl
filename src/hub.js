// -----------------------------------------------------------------------------
// The panel hub: reads the panel on a timer of the container (the interval
// chosen in the configuration), keeps one record per server, publishes the
// states that changed (and every few hours, the heartbeat), fires the scene
// events on transitions (started, stopped, crashed), and sends the power
// orders and console commands of the switch, the scene actions and the
// widget.
//
// A crash, as Wings handles it: the server process ends without a stop
// order; Wings restarts it at once (unless it already crashed in the last
// minute), so a reading may only see the uptime start again from zero
// (checked on a real Wings). A stop happened between two readings when the
// server is now stopped, or when its uptime went back. It was ordered when
// the integration sent it, when the server was seen stopping, or when the
// activity log of the panel shows a stop, kill or restart (or a console
// `stop`) since the previous reading.
//
// Gladys never polls these devices (should_poll: false, see
// GladysAssistant/Gladys#3198): every server is read here, the scene events
// fire even for a server whose device was not added, and the states only go
// to the devices added to Gladys.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { isIP } from 'node:net';
import {
  buildDevice,
  deviceIds,
  featureStates,
  NOISY_KEYS,
  structureKey,
  uuidOf,
} from './devices.js';
import { ERROR_KINDS, PanelClient, PanelError } from './panel.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  formatBytes,
  labelled,
  pick,
  stateText,
} from './texts.js';

const logger = createLogger({ name: 'pterodactyl-hub' });

export const WIDGET_KEY = 'servers';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  SERVER_STARTED: 'server_started',
  SERVER_STOPPED: 'server_stopped',
  SERVER_CRASHED: 'server_crashed',
});

export const HUB_TIMINGS = {
  // A panel that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the panel counts as unreachable.
  downAfterFailures: 2,
  // An unchanged value is sent again this often ("no recent value" after 48 h).
  heartbeatMs: 6 * 60 * 60_000,
  // CPU and memory move at every reading: sent at most this often.
  noisyMs: 60_000,
  // Readings after a power order: the panel caches the resources about 20 s.
  followUpMs: [10_000, 30_000],
  // The state shown after an order ("Starting", "Stopping") until a reading
  // confirms it, at most this long.
  pendingMs: 90_000,
  // The resources cache of the panel and a clock difference: an order this
  // much older than the previous reading still explains a stop.
  orderMarginMs: 60_000,
  // An uptime this much below the expected one means the process restarted
  // (the cache of the panel makes the uptime lag up to 20 s).
  uptimeToleranceMs: 45_000,
  // Servers read at the same time.
  concurrency: 4,
};

// Activity log events that explain a stop.
const STOP_EVENTS = new Set(['server:power.stop', 'server:power.kill', 'server:power.restart']);
// Console commands that stop most game servers (Minecraft, Source, Rust...).
const STOP_COMMAND = /^\/?(stop|quit|exit|end|shutdown|restart)\b/i;
// Panel errors that are no blip: no retry needed to call the panel down.
const LASTING = new Set([
  ERROR_KINDS.AUTH,
  ERROR_KINDS.FORBIDDEN,
  ERROR_KINDS.TLS,
  ERROR_KINDS.PROTOCOL,
  ERROR_KINDS.NOT_FOUND,
]);

// A panel at home or on the Internet (a game host), for the transport badge.
export const isLocalHost = (host) =>
  host === 'localhost' ||
  host.endsWith('.local') ||
  host.endsWith('.lan') ||
  host.endsWith('.home.arpa') ||
  (isIP(host) === 4 &&
    /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(host)) ||
  (isIP(host) === 6 && /^(::1$|fe80:|f[cd])/iu.test(host)) ||
  (isIP(host) === 0 && !host.includes('.'));

const clientSignature = (config) =>
  JSON.stringify([config.url, config.apiKey, config.allowSelfSigned]);

export class PanelHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {Function} [options.request] httpRequest seam (tests)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} server records, by UUID */
    this.records = new Map();
    this.panel = this.newPanelState();
    this.devicesKey = null;
    this.transports = new Map();
    this.connection = null;
    this.pollTimer = null;
    this.followUps = new Set();
    this.cycle = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  newPanelState() {
    return {
      reachable: null,
      down: false,
      failures: 0,
      error: null,
      downSince: null,
      retryTimer: null,
      /** Whether the activity log can be read: null until tried. */
      activity: null,
    };
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only: panel connected, lost, back; servers
  // added, removed, crashed; the orders of the user. A problem that repeats
  // is logged once, then at debug until it clears.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key) {
    this.warned.delete(key);
  }

  label(record) {
    return `Server "${record.server.name}" (${record.server.identifier})`;
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.connection = null;
    this.devicesKey = null;
    for (const record of this.records.values()) {
      record.noisyAt = null;
    }
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config !== null && this.config.language !== config.language;
    this.config = config;
    const signature = clientSignature(config);
    if (signature !== this.signature) {
      // Another panel or another key: other servers, a fresh start.
      this.signature = signature;
      clearTimeout(this.panel.retryTimer);
      this.panel = this.newPanelState();
      this.records.clear();
      this.devicesKey = null;
      this.client =
        config.url && config.apiKey && !config.applicationKey
          ? new PanelClient({
              url: config.url,
              apiKey: config.apiKey,
              insecure: config.allowSelfSigned,
              request: this.request,
            })
          : null;
    }
    if (languageChanged) {
      // The state text is worded in the configured language.
      this.gladys.forgetPublishedStates();
      this.devicesKey = null;
    }
    // The timer starts whatever happens: a refused discovery must not stop
    // the readings and the scene events.
    try {
      await this.pollAll();
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.panel.retryTimer);
    for (const timer of this.followUps) {
      clearTimeout(timer);
    }
    this.followUps.clear();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Reading cycle failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  later(ms, fn) {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    const timer = setTimeout(() => {
      this.followUps.delete(timer);
      fn().catch((err) => this.problem('follow-up', 'Reading failed', err, 'error'));
    }, ms);
    timer.unref?.();
    this.followUps.add(timer);
  }

  // --- Reading the panel -------------------------------------------------------

  /** One reading of the panel and of every server. Concurrent calls share it. */
  pollAll() {
    this.cycle ??= this.readAll().finally(() => {
      this.cycle = null;
    });
    return this.cycle;
  }

  async readAll() {
    if (!this.client) {
      await this.publishDevices([]);
      await this.publishConnectionStatus();
      return;
    }
    let servers;
    try {
      servers = await this.client.listServers();
    } catch (err) {
      if (!(err instanceof PanelError)) {
        throw err;
      }
      await this.panelFailure(err);
      return;
    }
    const changed = this.panelSuccess(servers.length);
    const synced = this.syncRecords(servers);
    let widget = changed || synced;
    const records = [...this.records.values()];
    for (let i = 0; i < records.length; i += this.timings.concurrency) {
      const results = await Promise.all(
        records.slice(i, i + this.timings.concurrency).map((record) => this.readServer(record)),
      );
      widget ||= results.some(Boolean);
    }
    await this.publishDevices();
    await this.afterChanges(widget);
  }

  panelSuccess(count) {
    const { panel } = this;
    clearTimeout(panel.retryTimer);
    const wasDown = panel.down;
    const changed = panel.reachable !== true;
    if (wasDown) {
      const minutes = Math.round((this.now() - panel.downSince) / 60_000);
      logger.info(`Panel ${this.client.host} answers again after ${minutes} min`);
    } else if (panel.error) {
      logger.info(`Panel ${this.client.host} answers again`);
    } else if (panel.reachable === null) {
      logger.info(`Connected to the panel ${this.client.host}: ${count} server(s)`);
    }
    this.resolved('panel');
    Object.assign(panel, {
      reachable: true,
      down: false,
      failures: 0,
      error: null,
      downSince: null,
    });
    return changed;
  }

  async panelFailure(err) {
    const { panel } = this;
    const kindChanged = panel.error?.kind !== err.kind;
    panel.error = { kind: err.kind, message: err.message };
    panel.reachable = false;
    if (kindChanged) {
      this.resolved('panel');
    }
    this.problem('panel', `Panel ${this.client.host}: ${err.message}`);
    panel.failures += 1;
    if (panel.failures === 1) {
      panel.downSince = this.now();
      if (!LASTING.has(err.kind)) {
        clearTimeout(panel.retryTimer);
        if (this.timersEnabled && !this.stopped) {
          panel.retryTimer = setTimeout(() => {
            this.pollAll().catch((e) => this.problem('retry', 'Retry failed', e, 'error'));
          }, this.timings.retryMs);
          panel.retryTimer.unref?.();
        }
      }
    }
    let changed = kindChanged;
    if (
      !panel.down &&
      (panel.failures >= this.timings.downAfterFailures || LASTING.has(err.kind))
    ) {
      panel.down = true;
      changed = true;
    }
    if (panel.down) {
      for (const record of this.records.values()) {
        record.shownState = 'unreachable';
        await this.publishStates(record);
      }
    }
    await this.afterChanges(changed);
  }

  /** The records follow the list of the panel. @returns {boolean} a server came or went */
  syncRecords(servers) {
    let changed = false;
    const seen = new Set();
    for (const server of servers) {
      seen.add(server.uuid);
      const record = this.records.get(server.uuid);
      if (record) {
        record.server = server;
      } else {
        this.records.set(server.uuid, this.newRecord(server));
        if (this.devicesKey !== null) {
          logger.info(`${this.label({ server })}: new on the panel`);
        }
        changed = true;
      }
    }
    for (const [uuid, record] of this.records) {
      if (!seen.has(uuid)) {
        logger.info(`${this.label(record)}: no longer on the panel`);
        this.records.delete(uuid);
        changed = true;
      }
    }
    return changed;
  }

  newRecord(server) {
    return {
      server,
      /** The last state read (running, starting, stopping, offline), null: no starting point. */
      state: null,
      uptimeMs: 0,
      readAt: null,
      resources: null,
      /** What the device and the widget show (a panel status, or "unreachable"). */
      shownState: null,
      error: null,
      /** The last order sent from Gladys: { signal, at }. */
      order: null,
      /** An order not confirmed yet: { signal, shown, until }. */
      pending: null,
      noisyAt: null,
      runUptimeMs: 0,
    };
  }

  /** Read one server and apply what changed. @returns {Promise<boolean>} the widget changed */
  async readServer(record) {
    const before = record.shownState;
    const { status } = record.server;
    if (status && status !== 'restoring_backup') {
      // Installing, suspended, transferred: the panel refuses the resources
      // (409) and Wings does not run the server. No starting point either.
      record.state = null;
      record.resources = null;
      record.pending = null;
      record.shownState = status;
      record.error = null;
    } else {
      let resources;
      try {
        resources = await this.client.resources(record.server.identifier);
      } catch (err) {
        if (!(err instanceof PanelError)) {
          throw err;
        }
        return this.serverFailure(record, err, before);
      }
      if (record.error) {
        logger.info(`${this.label(record)}: readable again`);
        record.error = null;
      }
      this.resolved(`server-${record.server.uuid}`);
      await this.applyResources(record, resources);
    }
    await this.publishStates(record);
    return record.shownState !== before;
  }

  async serverFailure(record, err, before) {
    record.error = { kind: err.kind, message: err.message };
    this.problem(`server-${record.server.uuid}`, `${this.label(record)}: ${err.message}`);
    if (err.kind === ERROR_KINDS.NODE) {
      // Wings is down: whatever happens meanwhile, the next reading is a new start.
      record.state = null;
      record.shownState = 'unreachable';
    } else if (err.kind === ERROR_KINDS.CONFLICT) {
      record.state = null;
      record.shownState = 'installing';
    }
    await this.publishStates(record);
    return record.shownState !== before;
  }

  async applyResources(record, resources) {
    const now = this.now();
    const previous = record.state;
    const previousUptime = record.uptimeMs;
    const previousAt = record.readAt;
    const runUptime = record.runUptimeMs;
    record.state = resources.state;
    record.uptimeMs = resources.uptimeMs;
    record.readAt = now;
    record.resources = resources;

    const running = resources.state !== 'offline';
    const restarted =
      previous !== null &&
      previous !== 'offline' &&
      running &&
      (resources.uptimeMs + this.timings.uptimeToleranceMs < previousUptime + (now - previousAt) ||
        (previous === 'running' && resources.state === 'starting') ||
        // A restart sent from here: any uptime that went back is it.
        (record.order?.signal === 'restart' &&
          record.order.at > previousAt - this.timings.orderMarginMs &&
          resources.uptimeMs < previousUptime));
    if (previous !== null) {
      const ended = (previous !== 'offline' && !running) || restarted;
      if (ended) {
        const ordered =
          previous === 'stopping' ||
          (await this.orderedSince(record, previousAt - this.timings.orderMarginMs));
        const ran = { uptime_minutes: Math.round(runUptime / 60_000) };
        if (!ordered) {
          logger.info(`${this.label(record)}: crashed${restarted ? ', restarted by Wings' : ''}`);
          await this.fire(TRIGGERS.SERVER_CRASHED, record, ran);
        } else if (!running) {
          await this.fire(TRIGGERS.SERVER_STOPPED, record, ran);
        }
      }
      if (resources.state === 'running' && (previous !== 'running' || restarted)) {
        await this.fire(TRIGGERS.SERVER_STARTED, record, {});
      }
    }
    // How long the current run lasts, for the events of its end (a server
    // seen stopping already reports no uptime).
    record.runUptimeMs = running ? Math.max(resources.uptimeMs, restarted ? 0 : runUptime) : 0;
    record.shownState = this.shown(record, resources, previousUptime, now);
  }

  /** The state to show: the reading, or the order sent while the panel does not show it yet. */
  shown(record, resources, previousUptime, now) {
    const { pending } = record;
    if (!pending) {
      return resources.state;
    }
    const done =
      now >= pending.until ||
      (pending.signal === 'start' && resources.state !== 'offline') ||
      (['stop', 'kill'].includes(pending.signal) &&
        ['offline', 'stopping'].includes(resources.state)) ||
      (pending.signal === 'restart' &&
        (resources.state !== 'running' || resources.uptimeMs < previousUptime));
    if (done) {
      record.pending = null;
      return resources.state;
    }
    return pending.shown;
  }

  /** A stop, kill or restart sent since `since` (ms), by Gladys or seen in the activity log. */
  async orderedSince(record, since) {
    const { order } = record;
    if (order && order.signal !== 'start' && order.at >= since) {
      return true;
    }
    let entries;
    try {
      entries = await this.client.activity(record.server.identifier);
      this.panel.activity = true;
    } catch (err) {
      if (!(err instanceof PanelError)) {
        throw err;
      }
      // A subuser without the activity permission, an older panel.
      this.panel.activity = false;
      this.problem('activity', `Activity log not readable: ${err.message}`);
      return false;
    }
    return entries.some(
      (entry) =>
        entry.at >= since &&
        (STOP_EVENTS.has(entry.event) ||
          (entry.event === 'server:console.command' && STOP_COMMAND.test(entry.command ?? ''))),
    );
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.server.uuid).device,
        server: record.server.name,
        node: record.server.node,
        ...data,
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Devices -----------------------------------------------------------------

  /** The devices of the Discovery tab, sent again when a server comes, goes or changes. */
  async publishDevices(list) {
    const servers = list ?? [...this.records.values()].map((record) => record.server);
    const key = JSON.stringify([this.language, servers.map(structureKey)]);
    if (key === this.devicesKey) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(
        servers.map((server) => buildDevice(this.gladys, server, this.language)),
      );
      this.devicesKey = key;
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Devices refused by Gladys: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the panel, send the devices again. */
  async rediscover() {
    this.devicesKey = null;
    await this.pollAll();
  }

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  recordOf(externalId) {
    const uuid = uuidOf(this.gladys, externalId);
    return uuid === null ? null : (this.records.get(uuid) ?? null);
  }

  /** The user added (or updated) a device: the SDK forgot its states, send them again now. */
  async onDeviceCreated(device) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      return;
    }
    await this.publishStates(record, { created: true });
    this.transports.delete(device.external_id);
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, a fallback): read the panel now. */
  async pollDevice(device) {
    if (this.recordOf(device.external_id)) {
      await this.pollAll();
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  async publishStates(record, { created = false } = {}) {
    const externalId = deviceIds(this.gladys, record.server.uuid).device;
    if (!created && !this.createdDevices().has(externalId)) {
      return;
    }
    const now = this.now();
    const noisy =
      created || record.noisyAt === null || now - record.noisyAt >= this.timings.noisyMs;
    const entries = featureStates(this.gladys, record, this.language).filter(
      (entry) => noisy || !NOISY_KEYS.includes(entry.key),
    );
    if (entries.length === 0) {
      return;
    }
    if (noisy && entries.some((entry) => NOISY_KEYS.includes(entry.key))) {
      record.noisyAt = now;
    }
    const states = entries.map(({ externalId: id, state, text }) =>
      text === undefined
        ? { device_feature_external_id: id, state }
        : { device_feature_external_id: id, text },
    );
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${this.label(record)} refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    if (!this.client) {
      return;
    }
    const local = isLocalHost(new URL(this.client.url).hostname.replace(/^\[|\]$/g, ''));
    const entries = [];
    for (const record of this.records.values()) {
      if (record.shownState === null) {
        continue;
      }
      const externalId = deviceIds(this.gladys, record.server.uuid).device;
      const transport =
        this.panel.down || record.shownState === 'unreachable'
          ? DEVICE_TRANSPORTS.UNREACHABLE
          : local
            ? DEVICE_TRANSPORTS.LOCAL
            : DEVICE_TRANSPORTS.CLOUD;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    const config = this.config;
    const text = (table) => ({ connected: false, message: { ...table } });
    if (config.invalidUrl) {
      return text(CONNECTION_TEXT.invalidUrl);
    }
    if (config.applicationKey) {
      return text(CONNECTION_TEXT.applicationKey);
    }
    if (!this.client) {
      return text(CONNECTION_TEXT.noPanel);
    }
    if (this.panel.reachable === null) {
      return { connected: false };
    }
    if (this.panel.down || (this.panel.reachable === false && this.records.size === 0)) {
      const message = {};
      for (const language of Object.keys(CONNECTION_TEXT.noPanel)) {
        message[language] = labelled(
          this.client.host,
          pick(ERROR_TEXT[this.panel.error.kind], language),
          language,
        );
      }
      return { connected: false, message };
    }
    if (this.records.size === 0) {
      return { connected: true, message: { ...CONNECTION_TEXT.noServer } };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Orders: switch, scene actions, widget ----------------------------------------

  /** The record of a device, or a localized error. */
  require(deviceExternalId) {
    const language = this.language;
    if (!this.client || this.panel.reachable === null) {
      throw new Error(pick(ACTION_TEXT.noPanel, language));
    }
    const record = this.recordOf(deviceExternalId) ?? this.records.get(deviceExternalId);
    if (!record) {
      throw new Error(pick(ACTION_TEXT.unknownServer, language));
    }
    return record;
  }

  /** A panel error, worded for the user. */
  orderError(record, err) {
    if (!(err instanceof PanelError)) {
      return err;
    }
    const language = this.language;
    const text = ERROR_TEXT[err.kind] ? pick(ERROR_TEXT[err.kind], language) : err.message;
    return new Error(labelled(record.server.name, text, language));
  }

  /**
   * Send a power signal to a server (switch, scene action, widget button).
   * @param {string} id the device external id (or the server UUID)
   * @param {'start'|'stop'|'restart'|'kill'} signal
   * @param {string} source who asked, for the log
   */
  async power(id, signal, source) {
    const record = this.require(id);
    if (signal === 'kill' && !this.config.allowKill) {
      throw new Error(pick(ACTION_TEXT.killDisabled, this.language));
    }
    try {
      await this.client.power(record.server.identifier, signal);
    } catch (err) {
      throw this.orderError(record, err);
    }
    const now = this.now();
    logger.info(`${this.label(record)}: ${signal} sent (${source})`);
    record.order = { signal, at: now };
    const shown = signal === 'stop' || signal === 'kill' ? 'stopping' : 'starting';
    record.pending = { signal, shown, until: now + this.timings.pendingMs };
    record.shownState = shown;
    await this.publishStates(record);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    for (const ms of this.timings.followUpMs) {
      this.later(ms, () => this.pollAll());
    }
    return record;
  }

  /** Send a console command (scene action), if the configuration allows it. */
  async command(id, command) {
    const record = this.require(id);
    if (!this.config.allowConsole) {
      throw new Error(pick(ACTION_TEXT.consoleDisabled, this.language));
    }
    const text = typeof command === 'string' ? command.trim() : '';
    if (!text) {
      throw new Error(pick(ACTION_TEXT.emptyCommand, this.language));
    }
    try {
      await this.client.command(record.server.identifier, text);
    } catch (err) {
      throw this.orderError(record, err);
    }
    // The command itself may hold a password (`op`, `rcon`...): not logged.
    logger.info(`${this.label(record)}: console command sent`);
    if (STOP_COMMAND.test(text)) {
      record.order = { signal: 'stop', at: this.now() };
    }
    return record;
  }

  /** "Read a server": read the panel now, and return what a scene message needs. */
  async readForScene(deviceExternalId) {
    this.require(deviceExternalId);
    await this.pollAll();
    const record = this.require(deviceExternalId);
    const language = this.language;
    const r = record.resources;
    const live = r && record.state !== null && r.state !== 'offline';
    return {
      running: record.state === 'running',
      state: record.shownState === null ? '' : stateText(record.shownState, language),
      cpu: live ? Math.round(r.cpuPercent * 10) / 10 : 0,
      memory_mb: live ? Math.round(r.memoryBytes / (1024 * 1024)) : 0,
      disk_mb: r ? Math.round(r.diskBytes / (1024 * 1024)) : 0,
      uptime_minutes: live ? Math.floor(r.uptimeMs / 60_000) : 0,
      server: record.server.name,
    };
  }

  /** "Test the connection": read the panel now, one line per server. */
  async testConnection() {
    await this.pollAll();
    const [first] = this.records.values();
    if (first && this.panel.activity === null) {
      // Tells whether crashes can be told apart from stops (see orderedSince).
      await this.orderedSince(first, this.now());
    }
    const message = {};
    for (const [language, words] of Object.entries(REPORT_TEXT)) {
      const status = this.connectionStatus();
      if (!this.client || this.panel.reachable !== true) {
        message[language] = pick(status.message, language) ?? '';
        continue;
      }
      const lines = [labelled(this.client.host, words.servers(this.records.size), language)];
      for (const record of this.records.values()) {
        const parts = [
          record.error
            ? pick(ERROR_TEXT[record.error.kind], language)
            : stateText(record.shownState, language),
        ];
        const r = record.resources;
        if (r && r.state !== 'offline' && !record.error) {
          parts.push(
            words.cpu(Math.round(r.cpuPercent)),
            words.memory(formatBytes(r.memoryBytes, language)),
          );
        }
        lines.push(labelled(record.server.name, parts.join(', '), language));
      }
      if (this.panel.activity !== null) {
        lines.push(this.panel.activity ? words.crashDetection : words.noActivity);
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** What the widget shows, for one server or all of them. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const record = this.recordOf(deviceExternalId);
    return record ? [record] : [];
  }
}
