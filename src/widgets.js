// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `servers`.
//
// The use case: the tablet of the living room shows whether the Minecraft
// server of the kids is up, and starts it with one tap. So:
//   - every server (the default): a tile "running / total", and a status
//     list of the servers (ten rows at most) with their state, CPU and memory;
//   - one server (chosen in the widget settings): tiles for its state, CPU,
//     memory and uptime, a row with its limits, and the buttons that fit its
//     state: Start, or Restart and Stop (confirmed), Kill when allowed and
//     the server is stuck stopping.
//
// Budget (8 components, 6 tiles, 1 status, 4 buttons): at most 4 tiles,
// 1 status list and 3 buttons. The values are sent as values, not bound to
// device features, so the widget works before the devices are added.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import {
  CONNECTION_TEXT,
  DONE_TEXT,
  ERROR_TEXT,
  fill,
  formatBytes,
  labelled,
  pick,
  stateText,
} from './texts.js';

export const TEXT = {
  connect: {
    en: 'Enter the address of your panel and a client API key in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre panneau et une clé API client dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Panels und einen Client-API-Schlüssel in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su panel y una clave API de cliente en la configuración de la integración.',
  },
  unknown: {
    en: 'This server is no longer on the panel: choose another one in the widget settings.',
    fr: "Ce serveur n'est plus sur le panneau : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieser Server ist nicht mehr im Panel: Wähle einen anderen in den Widget-Einstellungen.',
    es: 'Este servidor ya no está en el panel: elija otro en la configuración del widget.',
  },
  running: { en: 'Running', fr: 'Démarrés', de: 'Laufen', es: 'En marcha' },
  state: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  cpu: { en: 'CPU', fr: 'CPU', de: 'CPU', es: 'CPU' },
  memory: { en: 'Memory', fr: 'Mémoire', de: 'Speicher', es: 'Memoria' },
  uptime: { en: 'Uptime', fr: 'En marche depuis', de: 'Läuft seit', es: 'En marcha desde' },
  limits: { en: 'Limits', fr: 'Limites', de: 'Limits', es: 'Límites' },
  unlimited: { en: 'unlimited', fr: 'illimité', de: 'unbegrenzt', es: 'ilimitado' },
  disk: { en: 'disk', fr: 'disque', de: 'Platte', es: 'disco' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  start: { en: 'Start', fr: 'Démarrer', de: 'Starten', es: 'Arrancar' },
  stop: { en: 'Stop', fr: 'Arrêter', de: 'Stoppen', es: 'Detener' },
  restart: { en: 'Restart', fr: 'Redémarrer', de: 'Neu starten', es: 'Reiniciar' },
  kill: { en: 'Kill', fr: "Forcer l'arrêt", de: 'Abwürgen', es: 'Forzar' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [
      {
        type: 'text',
        variant: 'body',
        text: fit(typeof text === 'string' ? text : t(text, language), 300),
      },
    ],
  };
}

const COLORS = {
  running: WIDGET_COLORS.SUCCESS,
  starting: WIDGET_COLORS.WARNING,
  stopping: WIDGET_COLORS.WARNING,
  offline: WIDGET_COLORS.NEUTRAL,
  unreachable: WIDGET_COLORS.DANGER,
};
const colorOf = (state) => COLORS[state] ?? WIDGET_COLORS.INFO;

const ICONS = {
  running: 'check-circle',
  starting: 'loader',
  stopping: 'loader',
  offline: 'stop-circle',
  unreachable: 'x-circle',
};
const iconOf = (state) => ICONS[state] ?? 'info';

/** The running figures of a server: null when stopped or unknown. */
const live = (record) =>
  record.resources && record.state !== null && record.resources.state !== 'offline'
    ? record.resources
    : null;

/** "2 d 3 h", "3 h 20", "12 min". */
export function formatUptime(ms, language) {
  const minutes = Math.floor(ms / 60_000);
  const day = { en: 'd', fr: 'j', de: 'T', es: 'd' }[language] ?? 'd';
  if (minutes >= 24 * 60) {
    return `${Math.floor(minutes / 1440)} ${day} ${Math.floor((minutes % 1440) / 60)} h`;
  }
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
  }
  return `${minutes} min`;
}

function stateRow(record, language) {
  const state = record.shownState;
  const r = live(record);
  const text = state === null ? '…' : stateText(state, language);
  const value =
    r && state === 'running'
      ? `${text} · ${Math.round(r.cpuPercent)} % · ${formatBytes(r.memoryBytes, language)}`
      : text;
  return {
    label: fit(record.server.name, 40),
    icon: iconOf(state),
    value: fit(value, 40),
    color: colorOf(state),
  };
}

function overview(records, language) {
  const running = records.filter((record) => record.state === 'running').length;
  const rows = records.map((record) => stateRow(record, language));
  const items =
    rows.length > 10
      ? [
          ...rows.slice(0, 9),
          {
            label: t(TEXT.more, language),
            icon: 'more-horizontal',
            value: `+${rows.length - 9}`,
            color: WIDGET_COLORS.NEUTRAL,
          },
        ]
      : rows;
  return {
    ttl_seconds: 60,
    components: [
      {
        type: 'value',
        value: `${running}/${records.length}`,
        label: t(TEXT.running, language),
        icon: 'server',
        color: running > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
      },
      { type: 'status', items },
    ],
  };
}

function limitsText(server, language) {
  const { memoryMb, diskMb, cpuPercent } = server.limits;
  const none = t(TEXT.unlimited, language);
  const mb = (value) => (value > 0 ? formatBytes(value * 1024 * 1024, language) : none);
  return `${mb(memoryMb)} · CPU ${cpuPercent > 0 ? `${cpuPercent} %` : none} · ${t(TEXT.disk, language)} ${mb(diskMb)}`;
}

const button = (key, record, language, extra = {}) => ({
  type: 'button',
  label: t(TEXT[key], language),
  action: { key, params: { server: record.server.uuid }, ...extra.action },
  ...extra.button,
});

function single(hub, record, language) {
  const state = record.shownState;
  const r = live(record);
  const components = [
    {
      type: 'value',
      value: fit(state === null ? '…' : stateText(state, language), 12),
      label: t(TEXT.state, language),
      icon: iconOf(state),
      color: colorOf(state),
    },
  ];
  if (r) {
    components.push(
      {
        type: 'value',
        value: Math.round(r.cpuPercent),
        unit: '%',
        label: t(TEXT.cpu, language),
        icon: 'cpu',
      },
      {
        type: 'value',
        value: fit(formatBytes(r.memoryBytes, language), 12),
        label: t(TEXT.memory, language),
        icon: 'database',
      },
      {
        type: 'value',
        value: fit(formatUptime(r.uptimeMs, language), 12),
        label: t(TEXT.uptime, language),
        icon: 'clock',
      },
    );
  }
  components.push({
    type: 'status',
    items: [
      {
        label: t(TEXT.limits, language),
        icon: 'sliders',
        value: fit(limitsText(record.server, language), 40),
        color: WIDGET_COLORS.NEUTRAL,
      },
    ],
  });
  if (state === 'offline') {
    components.push(
      button('start', record, language, { button: { icon: 'play', style: 'primary' } }),
    );
  } else if (state === 'running' || state === 'starting') {
    components.push(
      button('restart', record, language, {
        button: { icon: 'refresh-cw', style: 'secondary' },
        action: { confirm: true },
      }),
      button('stop', record, language, {
        button: { icon: 'square', style: 'danger' },
        action: { confirm: true },
      }),
    );
  } else if (record.state === 'stopping' && !record.pending && hub.config.allowKill) {
    components.push(
      button('kill', record, language, {
        button: { icon: 'zap-off', style: 'danger' },
        action: { confirm: true },
      }),
    );
  }
  return { ttl_seconds: 30, components };
}

async function get(hub, { settings, language = 'en' } = {}) {
  const status = hub.connectionStatus();
  if (!hub.client) {
    return message(status.message ?? TEXT.connect, language);
  }
  if (hub.panel.down || hub.panel.reachable !== true) {
    const error = hub.panel.error ? pick(ERROR_TEXT[hub.panel.error.kind], language) : '…';
    return message(labelled(hub.client.host, error, language), language);
  }
  if (hub.records.size === 0) {
    return message(CONNECTION_TEXT.noServer, language);
  }
  if (settings?.device) {
    const [record] = hub.view(settings.device);
    return record ? single(hub, record, language) : message(TEXT.unknown, language);
  }
  return overview(hub.view(), language);
}

/** A button of the widget: a power order, then a toast. */
async function action(hub, actionKey, params = {}) {
  if (!Object.keys(DONE_TEXT).includes(actionKey)) {
    throw new Error(`Unknown widget action ${actionKey}`);
  }
  const record = await hub.power(params.server, actionKey, 'widget');
  const toast = {};
  for (const [language, text] of Object.entries(DONE_TEXT[actionKey])) {
    toast[language] = fit(fill(text, { server: record.server.name }), 200);
  }
  return toast;
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
