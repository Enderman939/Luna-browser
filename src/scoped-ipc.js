const { ipcMain } = require('electron');

// A channel is registered once. Each request is dispatched by its actual sender,
// so creating another browser window never replaces another window's handler.
const channels = new Map();
function scopedIPC(parent, accepts) {
  const entries = [];
  parent.once('closed', () => {
    for (const [routes, entry] of entries) routes.delete(entry);
  });
  return { handle(channel, callback) {
    if (!channels.has(channel)) {
      const routes = new Set(); channels.set(channel, routes);
      ipcMain.handle(channel, (event, ...args) => {
        for (const route of routes) if (route.accepts(event)) return route.callback(event, ...args);
        throw new Error('Untrusted sender');
      });
    }
    const routes = channels.get(channel), entry = { accepts, callback };
    routes.add(entry); entries.push([routes, entry]);
  } };
}
module.exports = { scopedIPC };
