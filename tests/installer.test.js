const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('Windows installer bundles the React UI and selected Amicro motion components', () => {
  const packageJSON = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const renderer = fs.readFileSync(path.join(root, 'scripts/installer-react/renderer.jsx'), 'utf8');
  const amicro = fs.readFileSync(path.join(root, 'scripts/installer-react/amicro.jsx'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'scripts/build-react-installer.mjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'scripts/installer-react/main.cjs'), 'utf8');
  const license = fs.readFileSync(path.join(root, 'scripts/installer-react/THIRD_PARTY_NOTICES.txt'), 'utf8');
  assert.equal(packageJSON.scripts['build:installer'], 'node scripts/build-installer.mjs');
  assert.match(renderer, /createRoot/); assert.match(renderer, /<FadeUp/); assert.match(renderer, /<MorphLoader/); assert.match(renderer, /<GlowButton/);
  assert.match(amicro, /0\.16, 1, 0\.3, 1/); assert.match(amicro, /borderRadius/); assert.match(amicro, /radial-gradient/);
  assert.match(build, /luna-setup-runtime/); assert.match(build, /Luna-Setup-/); assert.match(main, /payload\.sha256/); assert.match(license, /SYED SUBHAN UDDIN/);
});
