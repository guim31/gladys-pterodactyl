# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One device per server of a Pterodactyl or Pelican panel (client API key):
  a power switch (start, clean stop), its state, CPU, memory, disk and uptime,
  read every 30 seconds by default.
- Scene triggers: a game server started, stopped, or crashed — a crash is a
  stop nobody ordered, recognized even when Wings restarted the server before
  the next reading.
- Scene actions: start, stop, restart and read a server; kill it and send a
  console command, both only when allowed in the configuration.
- A dashboard widget: every server with its state, or one server with its
  figures and the Start, Restart and Stop buttons.
- "Test the connection", the connection status and the device badges tell a
  wrong address, key or certificate, a panel down and a node (Wings) down.
- English, French, German and Spanish everywhere: configuration, devices,
  widget, messages and documentation.

[Unreleased]: https://github.com/guim31/gladys-pterodactyl/commits/main
