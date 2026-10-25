// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

import { normalizePanelUrl } from './panel.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Reading intervals, in seconds. The panel caches the resources of a server
// about 20 s: reading faster shows nothing new.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  panel_url: '',
  api_key: '',
  allow_self_signed: false,
  poll_interval: '30',
  allow_kill: false,
  allow_console: false,
  language: 'fr',
};

const bool = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typedUrl = typeof source.panel_url === 'string' ? source.panel_url.trim() : '';
  const url = normalizePanelUrl(typedUrl);
  // A key is kept as typed, without the spaces of a copy and paste.
  const apiKey = typeof source.api_key === 'string' ? source.api_key.trim() : '';
  const interval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  return {
    url,
    /** Something typed that is not an address. */
    invalidUrl: typedUrl !== '' && url === null,
    apiKey,
    /** An application key (ptla_) cannot read the client API. */
    applicationKey: apiKey.startsWith('ptla_'),
    allowSelfSigned: bool(source.allow_self_signed),
    pollIntervalMs: Number(interval) * 1000,
    allowKill: bool(source.allow_kill),
    allowConsole: bool(source.allow_console),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
