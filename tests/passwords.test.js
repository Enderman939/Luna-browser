const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PasswordVault, credentialOrigin, generatePassword } = require('../src/password-vault');
const { sanitizeSettings } = require('../src/core');
const { parsePasswordCSV } = require('../src/password-csv');
const { fieldAnchor, fieldPlacement } = require('../src/password-popup-layout');
const key = crypto.randomBytes(32);
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: value => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const buffer = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), buffer]); },
  decryptString: buffer => { const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12)); decipher.setAuthTag(buffer.subarray(12, 28)); return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8'); },
};
function fixture(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-vault-')); t.after(() => fs.rmSync(directory, { recursive:true, force:true })); return new PasswordVault(directory, encryption); }
test('credentials match exact secure origins and reject insecure remote URLs and embedded credentials', () => {
  assert.equal(credentialOrigin('https://example.com/path?q=1'), 'https://example.com');
  assert.equal(credentialOrigin('https://example.com:444/'), 'https://example.com:444');
  for (const url of ['http://example.com', 'file:///secret', 'chrome-extension://abcd/', 'https://user:pass@example.com', 'https://example.com.evil.invalid/']) {
    assert.notEqual(credentialOrigin(url), 'https://example.com');
  }
  assert.equal(credentialOrigin('http://example.com'), null); assert.equal(credentialOrigin('http://127.0.0.1:8000/login'), 'http://127.0.0.1:8000');
  assert.equal(sanitizeSettings({}).savePasswords, true); assert.equal(sanitizeSettings({ autofillPasswords:false }).autofillPasswords, false);
});
test('encrypted vault survives restart without exposing accounts or passwords in files or list metadata', t => {
  const vault = fixture(t), id = vault.save({ origin:'https://example.com/login', username:'alice@example.com', password:'FixtureSecret123!' });
  const stored = fs.readFileSync(vault.file, 'utf8'); for (const secret of ['example.com', 'alice', 'FixtureSecret123!']) assert.equal(stored.includes(secret), false);
  assert.equal(vault.list()[0].password, undefined);
  const reopened = new PasswordVault(path.dirname(vault.file), encryption); assert.equal(reopened.get(id).password, 'FixtureSecret123!');
  assert.equal(reopened.accounts('https://example.com.evil.invalid').length, 0); assert.equal(reopened.accounts('http://example.com').length, 0);
});
test('updates deduplicate accounts, edits reject conflicts, and deletion and exceptions persist', t => {
  const vault = fixture(t), id = vault.save({origin:'https://example.com',username:'alice',password:'one'});
  assert.equal(vault.save({origin:'https://example.com',username:'alice',password:'two'}), id); assert.equal(vault.list().length, 1);
  vault.save({origin:'https://example.com',username:'bob',password:'three'});
  assert.throws(() => vault.save({origin:'https://example.com',username:'bob',password:'four'}, id));
  vault.block('https://example.com/login', true); assert.deepEqual(vault.data.blocked, ['https://example.com']);
  vault.remove(id); assert.throws(() => vault.get(id)); vault.block('https://example.com', false); assert.equal(vault.data.blocked.length, 0);
  vault.clear(0, Date.now()); assert.equal(vault.list().length, 0);
});
test('unavailable or plaintext encryption and unreadable vaults never overwrite existing data', t => {
  const vault = fixture(t); vault.save({origin:'https://example.com',username:'alice',password:'secret'});
  const before = fs.readFileSync(vault.file);
  const unavailable = new PasswordVault(path.dirname(vault.file), {...encryption,isEncryptionAvailable:()=>false});
  assert.throws(() => unavailable.save({origin:'https://example.com',username:'bob',password:'secret'})); assert.deepEqual(fs.readFileSync(vault.file), before);
  assert.equal(new PasswordVault(path.dirname(vault.file), {...encryption,getSelectedStorageBackend:()=> 'basic_text'}).available(), false);
  fs.writeFileSync(vault.file, '{corrupt'); const corrupt = new PasswordVault(path.dirname(vault.file), encryption);
  assert.throws(() => corrupt.clear()); assert.equal(fs.readFileSync(vault.file, 'utf8'), '{corrupt');
});
test('password generation uses the requested length and includes each character class', () => {
  const values = new Set(); for (let i = 0; i < 100; i++) { const value = generatePassword(); values.add(value); assert.equal(value.length, 20); for (const pattern of [/[A-Z]/,/[a-z]/,/\d/,/[!@#$%*\-_+]/]) assert.match(value, pattern); }
  assert.equal(values.size, 100); assert.equal(generatePassword(2).length, 12); assert.equal(generatePassword(100).length, 64);
});
test('Edge and Chrome CSV import supports quoted fields, skips invalid origins and preserves existing credentials', t => {
  const vault = fixture(t); vault.save({origin:'https://example.com',username:'alice',password:'keep'});
  const parsed = parsePasswordCSV('\uFEFFname,url,username,password,note\r\nExample,https://example.com/login,alice,replace,\r\nOther,https://other.example,"bob,smith","quoted""password\nline",\r\nBad,http://insecure.example,bob,secret,\r\n');
  assert.equal(parsed.entries.length,2); assert.equal(parsed.skipped,1); assert.equal(parsed.entries[1].password,'quoted"password\nline');
  assert.deepEqual(vault.import(parsed.entries),{added:1,skipped:1}); assert.equal(vault.find('https://example.com','alice').password,'keep');
  assert.throws(()=>parsePasswordCSV('url,username,password\nhttps://example.com,bob,"unclosed')); assert.throws(()=>parsePasswordCSV('a,b,c\n1,2,3'));
});
test('password field anchors convert CSS pixels to view coordinates and reject invalid or offscreen rectangles', () => {
  const viewport = {x:0,y:132,width:1000,height:600};
  assert.deepEqual(fieldAnchor({x:40,y:100,width:200,height:30},viewport,1.25),{x:50,y:257,width:250,height:37.5,field:true,viewport});
  for (const rect of [{x:0,y:900,width:100,height:30},{x:NaN,y:0,width:100,height:30},{x:0,y:0,width:0,height:30}]) assert.equal(fieldAnchor(rect,viewport),null);
});
test('password suggestions flip above low fields and fit the parent and monitor edges', () => {
  const parent={x:100,y:100,width:1000,height:700},area={x:0,y:0,width:1920,height:1080},popup={width:336,height:200};
  const viewport={x:0,y:132,width:1000,height:568};
  const low={x:850,y:650,width:140,height:32,field:true,viewport};
  const placed=fieldPlacement(low,parent,popup,area);assert.equal(placed.edge,'bottom');assert.ok(placed.x+popup.width<=parent.x+parent.width);assert.ok(placed.y+popup.height-12<=parent.y+low.y-6);
  assert.equal(fieldPlacement({...low,x:40,y:190},parent,popup,area).edge,'top');
});
