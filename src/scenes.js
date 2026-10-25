// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// Start, stop, restart a server; kill it and send a console command only when
// the configuration allows it (off by default: a kill loses what the game did
// not save, a command can do anything an admin can). And read a server now,
// to hand its state to the next actions ("{{1.0.state}}, {{1.0.cpu}} % CPU")
// or to a "Continue only if" condition on `running`.
// -----------------------------------------------------------------------------

const power =
  (signal) =>
  async (hub, { fields = {} }) => {
    await hub.power(fields.device || null, signal, 'scene');
  };

export const SCENE_ACTIONS = {
  start_server: power('start'),
  stop_server: power('stop'),
  restart_server: power('restart'),
  kill_server: power('kill'),
  async send_command(hub, { fields = {} }) {
    await hub.command(fields.device || null, fields.command);
  },
  async read_server(hub, { fields = {} }) {
    return hub.readForScene(fields.device || null);
  },
};
