// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, server states, the "Test the connection" report,
// scene action errors. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './panel.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noPanel: {
    en: 'Enter the address of your panel and a client API key in the configuration.',
    fr: "Saisissez l'adresse de votre panneau et une clé API client dans la configuration.",
    de: 'Gib die Adresse deines Panels und einen Client-API-Schlüssel in der Konfiguration ein.',
    es: 'Introduzca la dirección de su panel y una clave API de cliente en la configuración.',
  },
  invalidUrl: {
    en: 'Panel address not understood, e.g. https://panel.example.com',
    fr: 'Adresse du panneau incomprise, ex. https://panel.example.com',
    de: 'Panel-Adresse nicht verstanden, z. B. https://panel.example.com',
    es: 'Dirección del panel no válida, p. ej. https://panel.example.com',
  },
  applicationKey: {
    en: 'This is an application key (ptla_): create a client key in Account → API Credentials.',
    fr: "C'est une clé d'application (ptla_) : créez une clé client dans Compte → Identifiants API.",
    de: 'Das ist ein Anwendungsschlüssel (ptla_): Erstelle einen Client-Schlüssel unter Konto → API-Zugangsdaten.',
    es: 'Es una clave de aplicación (ptla_): cree una clave de cliente en Cuenta → Credenciales API.',
  },
  noServer: {
    en: 'Connected, but this key sees no server.',
    fr: 'Connecté, mais cette clé ne voit aucun serveur.',
    de: 'Verbunden, aber dieser Schlüssel sieht keinen Server.',
    es: 'Conectado, pero esta clave no ve ningún servidor.',
  },
};

// One short explanation per error kind (src/panel.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'panel unreachable (address, port, network?)',
    fr: 'panneau injoignable (adresse, port, réseau ?)',
    de: 'Panel nicht erreichbar (Adresse, Port, Netzwerk?)',
    es: 'panel inaccesible (¿dirección, puerto, red?)',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate not trusted (self-signed?)',
    fr: 'certificat non reconnu (auto-signé ?)',
    de: 'Zertifikat nicht vertrauenswürdig (selbstsigniert?)',
    es: 'certificado no reconocido (¿autofirmado?)',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused',
    fr: 'clé API refusée',
    de: 'API-Schlüssel abgelehnt',
    es: 'clave API rechazada',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'not allowed for this account',
    fr: 'non autorisé pour ce compte',
    de: 'für dieses Konto nicht erlaubt',
    es: 'no permitido para esta cuenta',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'not found on the panel',
    fr: 'introuvable sur le panneau',
    de: 'im Panel nicht gefunden',
    es: 'no encontrado en el panel',
  },
  [ERROR_KINDS.CONFLICT]: {
    en: 'busy (installing, suspended or moving)',
    fr: 'occupé (installation, suspension ou transfert)',
    de: 'beschäftigt (Installation, gesperrt oder Umzug)',
    es: 'ocupado (instalación, suspensión o traslado)',
  },
  [ERROR_KINDS.NOT_RUNNING]: {
    en: 'the server is not running',
    fr: "le serveur n'est pas démarré",
    de: 'der Server läuft nicht',
    es: 'el servidor no está en marcha',
  },
  [ERROR_KINDS.NODE]: {
    en: 'the panel cannot reach the node (Wings)',
    fr: 'le panneau ne joint pas le nœud (Wings)',
    de: 'das Panel erreicht den Node (Wings) nicht',
    es: 'el panel no alcanza el nodo (Wings)',
  },
  [ERROR_KINDS.RATE_LIMITED]: {
    en: 'too many requests, slow down the readings',
    fr: 'trop de requêtes, espacez les lectures',
    de: 'zu viele Anfragen, Abfragen seltener machen',
    es: 'demasiadas solicitudes, espacie las lecturas',
  },
  [ERROR_KINDS.PROTOCOL]: {
    en: 'unexpected answer: is it a Pterodactyl panel?',
    fr: 'réponse inattendue : est-ce un panneau Pterodactyl ?',
    de: 'unerwartete Antwort: Ist das ein Pterodactyl-Panel?',
    es: 'respuesta inesperada: ¿es un panel Pterodactyl?',
  },
};

// The "State" feature, the widget and the scene variables.
export const STATE_TEXT = {
  running: { en: 'Running', fr: 'Démarré', de: 'Läuft', es: 'En marcha' },
  starting: { en: 'Starting', fr: 'Démarrage', de: 'Startet', es: 'Arrancando' },
  stopping: { en: 'Stopping', fr: "S'arrête", de: 'Stoppt', es: 'Deteniéndose' },
  offline: { en: 'Stopped', fr: 'Arrêté', de: 'Gestoppt', es: 'Detenido' },
  suspended: { en: 'Suspended', fr: 'Suspendu', de: 'Gesperrt', es: 'Suspendido' },
  installing: { en: 'Installing', fr: 'Installation', de: 'Installation', es: 'Instalando' },
  install_failed: { en: 'Setup failed', fr: 'Échec inst.', de: 'Inst. fehlg.', es: 'Fallo inst.' },
  reinstall_failed: {
    en: 'Setup failed',
    fr: 'Échec inst.',
    de: 'Inst. fehlg.',
    es: 'Fallo inst.',
  },
  transferring: { en: 'Moving', fr: 'Transfert', de: 'Umzug', es: 'Traslado' },
  restoring_backup: {
    en: 'Restoring',
    fr: 'Restauration',
    de: 'Wiederherst.',
    es: 'Restaurando',
  },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Unerreichbar',
    es: 'Inaccesible',
  },
};

// Errors of the scene actions, the switch and the widget buttons.
export const ACTION_TEXT = {
  noPanel: {
    en: 'The integration is not connected to a panel.',
    fr: "L'intégration n'est connectée à aucun panneau.",
    de: 'Die Integration ist mit keinem Panel verbunden.',
    es: 'La integración no está conectada a ningún panel.',
  },
  unknownServer: {
    en: 'This server is no longer on the panel, or no longer shared with this key.',
    fr: "Ce serveur n'est plus sur le panneau, ou plus partagé avec cette clé.",
    de: 'Dieser Server ist nicht mehr im Panel oder nicht mehr mit diesem Schlüssel geteilt.',
    es: 'Este servidor ya no está en el panel, o ya no se comparte con esta clave.',
  },
  killDisabled: {
    en: 'Killing a server is disabled in the configuration of the integration.',
    fr: "Forcer l'arrêt est désactivé dans la configuration de l'intégration.",
    de: 'Das Erzwingen des Stopps ist in der Konfiguration der Integration deaktiviert.',
    es: 'Forzar la detención está desactivado en la configuración de la integración.',
  },
  consoleDisabled: {
    en: 'Console commands are disabled in the configuration of the integration.',
    fr: "Les commandes console sont désactivées dans la configuration de l'intégration.",
    de: 'Konsolenbefehle sind in der Konfiguration der Integration deaktiviert.',
    es: 'Los comandos de consola están desactivados en la configuración de la integración.',
  },
  emptyCommand: {
    en: 'The command is empty.',
    fr: 'La commande est vide.',
    de: 'Der Befehl ist leer.',
    es: 'El comando está vacío.',
  },
};

// Toasts of the widget buttons (≤ 200 characters).
export const DONE_TEXT = {
  start: {
    en: 'Start sent to {server}',
    fr: 'Démarrage envoyé à {server}',
    de: 'Start an {server} gesendet',
    es: 'Arranque enviado a {server}',
  },
  stop: {
    en: 'Stop sent to {server}',
    fr: 'Arrêt envoyé à {server}',
    de: 'Stopp an {server} gesendet',
    es: 'Detención enviada a {server}',
  },
  restart: {
    en: 'Restart sent to {server}',
    fr: 'Redémarrage envoyé à {server}',
    de: 'Neustart an {server} gesendet',
    es: 'Reinicio enviado a {server}',
  },
  kill: {
    en: 'Kill sent to {server}',
    fr: 'Arrêt forcé envoyé à {server}',
    de: 'Erzwungener Stopp an {server} gesendet',
    es: 'Detención forzada enviada a {server}',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    servers: (count) => `${count} server(s)`,
    cpu: (value) => `CPU ${value} %`,
    memory: (value) => `memory ${value}`,
    crashDetection: 'activity log readable: crashes told apart from stops',
    noActivity: 'activity log not readable: a crash counts when Gladys did not order the stop',
  },
  fr: {
    servers: (count) => `${count} serveur(s)`,
    cpu: (value) => `CPU ${value} %`,
    memory: (value) => `mémoire ${value}`,
    crashDetection: "journal d'activité lisible : plantages distingués des arrêts",
    noActivity:
      "journal d'activité illisible : un plantage compte quand Gladys n'a pas ordonné l'arrêt",
  },
  de: {
    servers: (count) => `${count} Server`,
    cpu: (value) => `CPU ${value} %`,
    memory: (value) => `Speicher ${value}`,
    crashDetection: 'Aktivitätsprotokoll lesbar: Abstürze von Stopps unterschieden',
    noActivity:
      'Aktivitätsprotokoll nicht lesbar: Ein Absturz zählt, wenn Gladys den Stopp nicht befohlen hat',
  },
  es: {
    servers: (count) => `${count} servidor(es)`,
    cpu: (value) => `CPU ${value} %`,
    memory: (value) => `memoria ${value}`,
    crashDetection: 'registro de actividad legible: fallos distinguidos de las paradas',
    noActivity: 'registro de actividad ilegible: un fallo cuenta cuando Gladys no ordenó la parada',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text?.[language] ?? text?.[LANGUAGE_FALLBACK];
export const fill = (text, values) =>
  text.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));

/** The text of a state key, the key itself when the panel sends a new one. */
export const stateText = (state, language) =>
  STATE_TEXT[state] ? pick(STATE_TEXT[state], language) : String(state);

/** Bytes as "512 MB" or "1.5 GB", the decimal separator of the language. */
export function formatBytes(bytes, language) {
  const mb = bytes / (1024 * 1024);
  const text = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
  return language === 'en' ? text : text.replace('.', ',');
}
