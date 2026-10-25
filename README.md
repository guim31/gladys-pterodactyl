# Pterodactyl / Pelican for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings the game
servers of a [Pterodactyl](https://pterodactyl.io/) panel (or of its fork
[Pelican](https://pelican.dev/)) into Gladys, at home or at a game host that sells Pterodactyl
servers.

Not affiliated with Pterodactyl or Pelican.

## Features

- **One device per server** of your account: a **Power** switch (on starts the server, off stops
  it cleanly), its **State** (running, starting, stopping, stopped, suspended, installing,
  unreachable), **CPU** (as the panel counts it, 100 % per core), **Memory**, **Disk** and
  **Uptime**. Its limits and node are in the device parameters.
- **Scene triggers**: a game server **started**, **stopped** (on an order) or **crashed** (stopped
  without one, even when Wings restarted it at once).
- **Scene actions**: start, stop, restart, read a server; kill it and send a console command only
  when allowed in the configuration (both off by default).
- **Dashboard widget**: every server with its state, or one server with its figures and the
  Start / Restart / Stop buttons that fit its state.
- Four languages: English, French, German, Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- A Pterodactyl (1.8 or later) or Pelican panel that Gladys can reach.
- A **client API key** (`ptlc_…`, Account → API Credentials on the panel). Application keys
  (`ptla_`) do not work.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the address of this
   repository: `https://github.com/guim31/gladys-pterodactyl` (or install **Pterodactyl /
   Pelican** from the catalog once it is listed).
2. In **Configuration**, enter the address of your panel and your client API key. Save, then
   click **Test the connection**.
3. Open the **Discover** tab and add the servers.

The user guide is in [`docs/en.md`](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

The container reads the client API of the panel on its own timer (30 s by default): the list of
the servers (`GET /api/client`) and the resources of each one
(`GET /api/client/servers/<id>/resources`). The devices are published with `should_poll: false`.
Orders go through `POST …/power` and `POST …/command`.

A crash is recognized as a stop nobody ordered: the server is stopped, or its uptime started again
from zero (Wings restarts a crashed server at once, so the panel may never show it stopped), and
neither Gladys nor the activity log of the panel (`GET …/activity`) shows a stop, kill or restart
since the previous reading.

## Checked on a real panel, and what was not

Checked on a real **Pterodactyl 1.15.2** panel with **Wings** (Docker, on a test machine), with
light test servers: the list, the resources running, starting and stopped, the switch, the scene
actions, a console command, a suspended server (409), the node down (500), a wrong key (401), and a
**real crash**: Wings restarted the server, the state stayed "running", the uptime went back, and
the integration fired "crashed" then "started"; an ordered restart and stop fired no crash. The
answers are kept, anonymized, in [`test/fixtures/real`](test/fixtures/real), and
`npm run test:real` replays the whole scenario against a panel of your own (see
[`test/real/real-panel.test.js`](test/real/real-panel.test.js)).

Not checked: **Pelican** (same client API, untested), a panel at a commercial game host, a subuser
key with restricted permissions, and a real Gladys instance (the tests use the fake Gladys of the
SDK). Feedback welcome in the [issues](https://github.com/guim31/gladys-pterodactyl/issues).

## Limitations

- No players: the API of the panel does not have them. The
  [Game Servers (GameDig)](https://github.com/guim31/gladys-gamedig) integration reads them.
- The panel caches the resources about 20 s: the figures and the end of an order lag that much.
- A server shut down from inside the game counts as a crash; without the activity log permission,
  a stop from the panel too.
- Up to 200 servers per key. No files, backups, databases, schedules, console output.

## Development

```bash
npm install
npm test                 # node --test, against the SDK's fake Gladys and a fake panel
npm run lint
npm run format:check
PTERODACTYL_URL=https://panel.example.com PTERODACTYL_KEY=ptlc_… PTERODACTYL_SERVER=1a2b3c4d \
  npm run test:real      # a real panel: starts and stops that server
```

## Credits

- [Pterodactyl](https://github.com/pterodactyl/panel) and [Pelican](https://github.com/pelican-dev/panel),
  whose client API this integration uses (no code of theirs is included).
- Cover: the Pterodactyl mascot logo shipped with the panel (`public/assets/svgs/pterodactyl.svg`).
- The structure, tests and widget follow the other integrations of guim31, starting with
  [gladys-gamedig](https://github.com/guim31/gladys-gamedig).

## License

[Apache 2.0](LICENSE).
