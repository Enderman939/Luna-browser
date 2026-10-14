const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
function windowsProtect(values) {
  const script = "Add-Type -AssemblyName System.Security; $values = [Console]::In.ReadToEnd() | ConvertFrom-Json; $result = @($values | ForEach-Object { [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($_), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)) }); ConvertTo-Json -InputObject $result -Compress";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: JSON.stringify(values.map(value => Buffer.from(value).toString('base64'))), encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.status !== 0) throw new Error('Synthetic Windows encryption fixture unavailable');
  return JSON.parse(result.stdout).map(value => Buffer.from(value, 'base64'));
}
function createImportFixture(directory, passwords = false) {
  const root = path.join(directory, 'edge-source'), profile = path.join(root, 'Default'); fs.mkdirSync(profile, { recursive: true });
  const now = Date.now() - 3600000, chromeTime = (now + 11644473600000) * 1000;
  fs.writeFileSync(path.join(profile, 'Preferences'), JSON.stringify({ profile: { name: 'Synthetic Edge' } }));
  fs.writeFileSync(path.join(profile, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', id: '1', name: '收藏栏', children: [{ type: 'folder', id: '2', name: '研究资料', children: [{ type: 'url', id: '3', name: 'Electron reference', url: 'https://electron.example/docs', date_added: String(chromeTime) }] }, { type: 'url', id: '4', name: 'Unsafe', url: 'javascript:alert(1)' }] } } }));
  const file = path.join(directory, 'original-download.txt'); fs.writeFileSync(file, 'synthetic downloaded bytes');
  const history = new DatabaseSync(path.join(profile, 'History'));
  history.exec('CREATE TABLE urls(url TEXT, title TEXT, last_visit_time INTEGER); CREATE TABLE downloads(id INTEGER, target_path TEXT, received_bytes INTEGER,total_bytes INTEGER,start_time INTEGER,state INTEGER); CREATE TABLE downloads_url_chains(id INTEGER, chain_index INTEGER,url TEXT)');
  const statement = history.prepare('INSERT INTO urls VALUES(?,?,?)');
  for (let index = 0; index < 650; index++) statement.run('https://history.example/' + index, 'Imported history ' + index, chromeTime + index * 1000);
  statement.run('javascript:invalid', 'Unsafe', chromeTime);
  history.prepare('INSERT INTO downloads VALUES(?,?,?,?,?,?)').run(1, file, 26, 26, chromeTime, 1);
  history.prepare('INSERT INTO downloads_url_chains VALUES(?,?,?)').run(1, 0, 'https://files.example/test.txt'); history.close();
  if (passwords) {
    const key = crypto.randomBytes(32), [wrappedKey, legacy] = windowsProtect([key, Buffer.from('Synthetic-legacy!')]);
    fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), wrappedKey]).toString('base64') } }));
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([Buffer.from('v10'), iv, cipher.update('Synthetic-AES!'), cipher.final(), cipher.getAuthTag()]); key.fill(0);
    const db = new DatabaseSync(path.join(profile, 'Login Data')); db.exec('CREATE TABLE logins(origin_url TEXT,username_value TEXT,password_value BLOB,blacklisted_by_user INTEGER)');
    const insert = db.prepare('INSERT INTO logins VALUES(?,?,?,?)'); insert.run('https://login.example/', 'legacy', legacy, 0); insert.run('https://login.example/', 'aes', encrypted, 0); insert.run('https://protected.example/', 'protected', Buffer.concat([Buffer.from('v20'), crypto.randomBytes(40)]), 0); db.close();
  }
  return { roots: [{ browser: 'Edge', root, kind: 'chromium' }], root, profile, file };
}
module.exports = { createImportFixture };
