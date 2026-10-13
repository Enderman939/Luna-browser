const { randomUUID } = require('node:crypto');

class Prompts {
  constructor(send, changed) { this.send = send; this.changed = changed; this.queue = []; this.ready = false; }
  get active() { return this.queue[0] || null; }
  setReady() { this.ready = true; this.publish(); }
  publish() { this.changed(); if (this.ready && this.active) this.send('browser:prompt', this.active.view); }
  ask(options) {
    return new Promise(resolve => {
      this.queue.push({ view: { ...options, id: randomUUID() }, resolve });
      if (this.queue.length === 1) this.publish();
    });
  }
  reply(id, result) {
    if (this.active?.view.id !== id) return false;
    const entry = this.queue.shift();
    this.send('browser:prompt-close', { id });
    entry.resolve({ accepted: result?.accepted === true, restore: result?.restore === true });
    this.publish(); return true;
  }
  cancelAll() {
    for (const entry of this.queue.splice(0)) { this.send('browser:prompt-close', { id: entry.view.id }); entry.resolve({ accepted: false, cancelled: true }); }
    this.changed();
  }
  cancelWhere(predicate) {
    const removed = this.queue.filter(entry => predicate(entry.view));
    if (!removed.length) return;
    this.queue = this.queue.filter(entry => !removed.includes(entry));
    for (const entry of removed) { this.send('browser:prompt-close', { id: entry.view.id }); entry.resolve({ accepted: false, cancelled: true }); }
    this.publish();
  }
}
module.exports = { Prompts };
