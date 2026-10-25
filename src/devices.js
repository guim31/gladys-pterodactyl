// -----------------------------------------------------------------------------
// One Gladys device per server of the panel.
//
// Identity: the UUID the panel gives the server, never its name. Features
// (category/type couples of the core table, see test/gladys-rules.test.js):
//   - power: switch/binary, 1 while the server runs or starts, 0 when it is
//     stopped or stopping; turning it on starts the server, off stops it
//     (a clean stop, never a kill);
//   - state: text/text, the state the panel shows (running, starting,
//     stopping, stopped, suspended, installing...);
//   - CPU: level-sensor/liquid-level-percent, as the panel counts it: 100 %
//     is one core. The bound is the CPU limit of the server, 400 % (four
//     cores) without a limit; a reading above it is published as the bound;
//   - memory, disk: data/size in megabytes;
//   - uptime: duration/decimal in hours, 0 when stopped.
//
// Published with should_poll: false: the integration reads the panel on its
// own timer (src/hub.js), Gladys never polls these devices
// (GladysAssistant/Gladys#3198).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { stateText } from './texts.js';

export const DEVICE_TYPE = 'server';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  POWER: 'power',
  STATE: 'state',
  CPU: 'cpu',
  MEMORY: 'memory',
  DISK: 'disk',
  UPTIME: 'uptime',
});

// Features whose value moves at every reading: published at most once a
// minute (src/hub.js), every state counts in the 300 a minute of the core.
export const NOISY_KEYS = [FEATURE_KEYS.CPU, FEATURE_KEYS.MEMORY];

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.POWER]: 'Power',
    [FEATURE_KEYS.STATE]: 'State',
    [FEATURE_KEYS.CPU]: 'CPU',
    [FEATURE_KEYS.MEMORY]: 'Memory',
    [FEATURE_KEYS.DISK]: 'Disk',
    [FEATURE_KEYS.UPTIME]: 'Uptime',
  },
  fr: {
    [FEATURE_KEYS.POWER]: 'Marche',
    [FEATURE_KEYS.STATE]: 'État',
    [FEATURE_KEYS.CPU]: 'CPU',
    [FEATURE_KEYS.MEMORY]: 'Mémoire',
    [FEATURE_KEYS.DISK]: 'Disque',
    [FEATURE_KEYS.UPTIME]: 'Durée de fonctionnement',
  },
  de: {
    [FEATURE_KEYS.POWER]: 'Betrieb',
    [FEATURE_KEYS.STATE]: 'Zustand',
    [FEATURE_KEYS.CPU]: 'CPU',
    [FEATURE_KEYS.MEMORY]: 'Arbeitsspeicher',
    [FEATURE_KEYS.DISK]: 'Speicherplatz',
    [FEATURE_KEYS.UPTIME]: 'Laufzeit',
  },
  es: {
    [FEATURE_KEYS.POWER]: 'Encendido',
    [FEATURE_KEYS.STATE]: 'Estado',
    [FEATURE_KEYS.CPU]: 'CPU',
    [FEATURE_KEYS.MEMORY]: 'Memoria',
    [FEATURE_KEYS.DISK]: 'Disco',
    [FEATURE_KEYS.UPTIME]: 'Tiempo en marcha',
  },
};

// Display bounds (the core never applies them on write).
export const BOUNDS = Object.freeze({
  CPU_DEFAULT_PERCENT: 400,
  // 1 TB in MB: memory and disk have no useful upper bound.
  SIZE_MAX_MB: 1_048_576,
  // Ten years.
  UPTIME_MAX_HOURS: 87_600,
});

const MB = 1024 * 1024;

/** External ids of a server's device and features. */
export const deviceIds = (gladys, uuid) => gladys.externalIds(DEVICE_TYPE, uuid);

/** The UUID of a device external id, null when it is not one of ours. */
export function uuidOf(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (!externalId.startsWith(prefix)) {
    return null;
  }
  const uuid = externalId.slice(prefix.length);
  return /^[0-9a-f-]{36}$/i.test(uuid) ? uuid : null;
}

/** The CPU bound of a server: its limit, or four cores. */
export const cpuMax = (server) => server.limits.cpuPercent || BOUNDS.CPU_DEFAULT_PERCENT;

const sensor = { read_only: true, has_feedback: false };

function features(server) {
  return [
    {
      key: FEATURE_KEYS.POWER,
      category: CATEGORY.SWITCH,
      type: TYPE.SWITCH.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    },
    {
      key: FEATURE_KEYS.STATE,
      category: CATEGORY.TEXT,
      type: TYPE.TEXT.TEXT,
      ...sensor,
      // Gladys keeps no history of a text; min/max are NOT NULL columns: 0/0.
      keep_history: false,
      min: 0,
      max: 0,
    },
    {
      key: FEATURE_KEYS.CPU,
      category: CATEGORY.LEVEL_SENSOR,
      type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
      unit: UNIT.PERCENT,
      ...sensor,
      keep_history: true,
      min: 0,
      max: cpuMax(server),
    },
    {
      key: FEATURE_KEYS.MEMORY,
      category: CATEGORY.DATA,
      type: TYPE.DATA.SIZE,
      unit: UNIT.MEGABYTE,
      ...sensor,
      keep_history: true,
      min: 0,
      max: BOUNDS.SIZE_MAX_MB,
    },
    {
      key: FEATURE_KEYS.DISK,
      category: CATEGORY.DATA,
      type: TYPE.DATA.SIZE,
      unit: UNIT.MEGABYTE,
      ...sensor,
      keep_history: true,
      min: 0,
      max: BOUNDS.SIZE_MAX_MB,
    },
    {
      key: FEATURE_KEYS.UPTIME,
      category: CATEGORY.DURATION,
      type: TYPE.DURATION.DECIMAL,
      unit: UNIT.HOURS,
      ...sensor,
      keep_history: true,
      min: 0,
      max: BOUNDS.UPTIME_MAX_HOURS,
    },
  ];
}

/**
 * The discovery payload of a server.
 * @param {object} gladys SDK client
 * @param {object} server a server of the list (src/panel.js parseServer)
 * @param {string} language feature names language
 */
export function buildDevice(gladys, server, language = 'fr') {
  const ids = deviceIds(gladys, server.uuid);
  const names = NAMES[language] ?? NAMES.en;
  const { limits } = server;
  return {
    name: server.name,
    external_id: ids.device,
    model: 'Pterodactyl',
    should_poll: false,
    params: [
      { name: 'IDENTIFIER', value: server.identifier },
      { name: 'NODE', value: server.node || '-' },
      { name: 'MEMORY_LIMIT_MB', value: String(limits.memoryMb) },
      { name: 'DISK_LIMIT_MB', value: String(limits.diskMb) },
      { name: 'CPU_LIMIT_PERCENT', value: String(limits.cpuPercent) },
    ],
    features: features(server).map(({ key, ...definition }) => ({
      ...definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/** What makes the structure of a device: a change shows "Update" in Gladys. */
export const structureKey = (server) => `${server.name}|${cpuMax(server)}`;

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Running or about to: what the power switch shows. */
export const isOn = (state) => state === 'running' || state === 'starting';

/**
 * The value of every feature of a server record.
 * @param {object} record { server, shownState, resources } (src/hub.js)
 * @returns {Array<{ key: string, externalId: string, state?: number, text?: string }>}
 */
export function featureStates(gladys, record, language) {
  const ids = deviceIds(gladys, record.server.uuid);
  const state = record.shownState;
  const values = {};
  if (state !== null) {
    values[FEATURE_KEYS.STATE] = { text: stateText(state, language) };
    if (state !== 'unreachable') {
      values[FEATURE_KEYS.POWER] = { state: isOn(state) ? 1 : 0 };
    }
  }
  const r = record.resources;
  if (r && state !== 'unreachable') {
    const live = r.state !== 'offline';
    values[FEATURE_KEYS.CPU] = {
      state: live ? Math.min(cpuMax(record.server), round(r.cpuPercent, 1)) : 0,
    };
    values[FEATURE_KEYS.MEMORY] = {
      state: live ? Math.min(BOUNDS.SIZE_MAX_MB, round(r.memoryBytes / MB)) : 0,
    };
    // The disk is measured stopped too.
    values[FEATURE_KEYS.DISK] = { state: Math.min(BOUNDS.SIZE_MAX_MB, round(r.diskBytes / MB)) };
    values[FEATURE_KEYS.UPTIME] = {
      state: live ? Math.min(BOUNDS.UPTIME_MAX_HOURS, round(r.uptimeMs / 3_600_000, 2)) : 0,
    };
  }
  return Object.values(FEATURE_KEYS)
    .filter((key) => values[key] !== undefined)
    .map((key) => ({ key, externalId: ids.feature(key), ...values[key] }));
}
