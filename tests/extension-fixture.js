const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

function extensionFiles(icon) {
  return {
    'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Luna Test Extension', version: '1.0.0', description: 'Content scripts, storage, popup and tabs API verification.',
      permissions: ['storage', 'tabs', 'scripting', 'contextMenus'], host_permissions: ['http://127.0.0.1/*'],
      background: { service_worker: 'background.js' },
      action: { default_title: 'Luna extension test', default_popup: 'popup.html', default_icon: 'icon.png' }, icons: { 48: 'icon.png' },
      content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_idle' }], options_page: 'options.html',
    }),
    'content.js': 'document.documentElement.dataset.lunaExtension = chrome.runtime.id; chrome.storage.local.set({ contentWorks: true });',
    'background.js': 'chrome.runtime.onInstalled.addListener(() => { chrome.storage.local.set({ backgroundWorks: true }); chrome.contextMenus.create({ id: "luna-test", title: "Luna extension menu", contexts: ["page"] }); }); chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.kind==="luna-test"){chrome.tabs.query({}).then(tabs=>reply({backgroundWorks:true,count:tabs.length}));return true;}});',
    'popup.html': '<!doctype html><html><body style="width:300px;height:170px;padding:15px"><h2>Luna extension popup</h2><p id="result">Loading</p><button id="create-tab">Create tab</button><script src="popup.js"></script></body></html>',
    'popup.js': 'browser.tabs.query({active:true,currentWindow:true}).then(tabs=>{document.getElementById("result").textContent=tabs[0]?.title || "No active tab";}); document.getElementById("create-tab").onclick=()=>browser.tabs.create({url:"https://example.com/"});',
    'options.html': '<!doctype html><title>Extension Options</title><h1>Luna extension options</h1>',
    'icon.png': icon || Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64'),
  };
}
function createExtension(directory, icon) {
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, contents] of Object.entries(extensionFiles(icon))) fs.writeFileSync(path.join(directory, name), contents);
}
function zipExtension(files = extensionFiles()) { const archive = new AdmZip(); for (const [name, data] of Object.entries(files)) archive.addFile(name, Buffer.isBuffer(data) ? data : Buffer.from(data)); return archive.toBuffer(); }
function varint(value) { const bytes = []; do { let byte = value & 127; value = Math.floor(value / 128); if (value) byte |= 128; bytes.push(byte); } while (value); return Buffer.from(bytes); }
function field(number, buffer) { return Buffer.concat([varint(number * 8 + 2), varint(buffer.length), buffer]); }
function createCrx(version = 3) {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = pair.publicKey.export({ format: 'der', type: 'spki' });
  const zip = zipExtension();
  if (version === 2) {
    const signature = crypto.sign('sha1', zip, pair.privateKey), header = Buffer.alloc(16);
    header.write('Cr24'); header.writeUInt32LE(2, 4); header.writeUInt32LE(key.length, 8); header.writeUInt32LE(signature.length, 12);
    return Buffer.concat([header, key, signature, zip]);
  }
  const signed = field(1, crypto.createHash('sha256').update(key).digest().subarray(0, 16));
  const size = Buffer.alloc(4); size.writeUInt32LE(signed.length);
  const signature = crypto.sign('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\0'), size, signed, zip]), pair.privateKey);
  const protobuf = Buffer.concat([field(2, Buffer.concat([field(1, key), field(2, signature)])), field(10000, signed)]);
  const header = Buffer.alloc(12); header.write('Cr24'); header.writeUInt32LE(3, 4); header.writeUInt32LE(protobuf.length, 8);
  return Buffer.concat([header, protobuf, zip]);
}
module.exports = { createExtension, createCrx, zipExtension, extensionFiles };
