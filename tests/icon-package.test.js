const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
function icoLayers(file) {
  const buffer = fs.readFileSync(file); assert.equal(buffer.readUInt16LE(0), 0); assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4), layers = [];
  for (let index = 0; index < count; index++) {
    const offset = 6 + index * 16, size = buffer[offset] || 256, height = buffer[offset + 1] || 256;
    assert.equal(size, height); assert.equal(buffer.readUInt16LE(offset + 4), 1); assert.equal(buffer.readUInt16LE(offset + 6), 32);
    const length = buffer.readUInt32LE(offset + 8), dataOffset = buffer.readUInt32LE(offset + 12);
    assert.equal(buffer.subarray(dataOffset, dataOffset + 8).toString('hex'), '89504e470d0a1a0a'); layers.push({ size, length, dataOffset });
  }
  return layers;
}
test('Windows application icon contains standard taskbar and title-bar PNG layers', () => {
  assert.deepEqual(icoLayers(path.join(root, 'src/ui/assets/app.ico')).map(layer => layer.size), [16, 24, 32, 48, 64, 128, 256]);
});
