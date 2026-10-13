const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

function protobufFields(buffer) {
  const fields = []; let offset = 0;
  const varint = () => {
    let value = 0, shift = 0;
    while (offset < buffer.length && shift <= 49) {
      const byte = buffer[offset++]; value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
    }
    throw new Error('CRX 头部无效');
  };
  while (offset < buffer.length) {
    const tag = varint(), wire = tag & 7;
    if (wire === 0) { varint(); continue; }
    if (wire === 1) { offset += 8; continue; }
    if (wire === 5) { offset += 4; continue; }
    if (wire !== 2) throw new Error('CRX 头部无效');
    const length = varint();
    if (length < 0 || offset + length > buffer.length) throw new Error('CRX 头部截断');
    fields.push({ field: Math.floor(tag / 8), data: buffer.subarray(offset, offset + length) }); offset += length;
  }
  return fields;
}
function unpackContainer(buffer) {
  if (buffer.length < 4) throw new Error('扩展安装包为空');
  if (buffer.subarray(0, 2).toString() === 'PK') return { zip: buffer, key: '' };
  if (buffer.subarray(0, 4).toString() !== 'Cr24' || buffer.length < 12) throw new Error('无效的 CRX / ZIP 安装包');
  const version = buffer.readUInt32LE(4);
  if (version === 2 && buffer.length >= 16) {
    const keyLength = buffer.readUInt32LE(8), signatureLength = buffer.readUInt32LE(12);
    const start = 16 + keyLength + signatureLength;
    if (start >= buffer.length || keyLength > 1024 * 1024 || signatureLength > 1024 * 1024) throw new Error('CRX2 头部无效');
    const key = buffer.subarray(16, 16 + keyLength), signature = buffer.subarray(16 + keyLength, start), zip = buffer.subarray(start);
    if (!crypto.verify('sha1', zip, { key, format: 'der', type: 'spki' }, signature)) throw new Error('CRX 签名校验失败');
    return { zip, key: key.toString('base64') };
  }
  if (version === 3) {
    const length = buffer.readUInt32LE(8), start = 12 + length;
    if (start >= buffer.length || length > 4 * 1024 * 1024) throw new Error('CRX3 头部无效');
    const fields = protobufFields(buffer.subarray(12, start));
    const signed = fields.find(item => item.field === 10000)?.data;
    if (!signed) throw new Error('CRX3 缺少签名数据');
    const id = protobufFields(signed).find(item => item.field === 1)?.data;
    const size = Buffer.alloc(4); size.writeUInt32LE(signed.length);
    const zip = buffer.subarray(start);
    const payload = Buffer.concat([Buffer.from('CRX3 SignedData\0'), size, signed, zip]);
    for (const proof of fields.filter(item => item.field === 2 || item.field === 3)) {
      const proofFields = protobufFields(proof.data);
      const key = proofFields.find(item => item.field === 1)?.data, signature = proofFields.find(item => item.field === 2)?.data;
      if (!key || !signature || !id || !crypto.createHash('sha256').update(key).digest().subarray(0, 16).equals(id)) continue;
      if (crypto.verify('sha256', payload, { key, format: 'der', type: 'spki' }, signature)) return { zip, key: key.toString('base64') };
    }
    throw new Error('CRX3 签名校验失败');
  }
  throw new Error('不支持此 CRX 版本');
}
function readManifest(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (![2, 3].includes(manifest.manifest_version) || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') throw new Error('扩展 manifest.json 无效');
  return manifest;
}
function extractExtension(buffer, directory) {
  if (buffer.length > 64 * 1024 * 1024) throw new Error('扩展安装包超过 64 MB');
  const { zip, key } = unpackContainer(buffer);
  const archive = new AdmZip(zip);
  const entries = archive.getEntries();
  if (entries.length > 10000) throw new Error('扩展文件数量过多');
  let total = 0;
  const seen = new Set();
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name || name.includes('\0') || name.startsWith('/') || name.includes(':') || name.split('/').includes('..') || ((entry.header.attr >>> 16) & 0xf000) === 0xa000) throw new Error('扩展安装包包含无效路径');
    const folded = name.toLowerCase();
    if (seen.has(folded)) throw new Error('扩展安装包包含重复文件');
    seen.add(folded);
    total += entry.header.size;
    if (entry.header.size > 32 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new Error('扩展解压后过大（总大小上限 256 MB，单文件上限 32 MB）');
  }
  fs.mkdirSync(directory, { recursive: true });
  for (const entry of entries) {
    const destination = path.join(directory, entry.entryName.replace(/\\/g, '/'));
    if (entry.isDirectory) fs.mkdirSync(destination, { recursive: true });
    else { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, entry.getData()); }
  }
  const manifest = readManifest(directory);
  if (key) { manifest.key = key; fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2)); }
  return manifest;
}
module.exports = { extractExtension, unpackContainer, readManifest };
