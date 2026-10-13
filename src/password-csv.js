const { credential } = require('./password-vault');
function parsePasswordCSV(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 5 * 1024 * 1024) throw new Error('CSV 文件超过 5 MB。');
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += char; }
    else if (char === '"' && cell === '' && !closed) quoted = true;
    else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (char !== ',') { if (row.some(value => value)) rows.push(row); row = []; if (char === '\r' && text[i + 1] === '\n') i++; }
    } else { if (closed || char === '"') throw new Error('CSV 格式无效。'); cell += char; }
    if (cell.length > 16384 || row.length > 30 || rows.length > 5001) throw new Error('CSV 内容超过限制。');
  }
  if (quoted) throw new Error('CSV 引号未闭合。');
  row.push(cell); if (row.some(value => value)) rows.push(row);
  const header = rows.shift()?.map(value => value.trim().toLowerCase()) || [];
  const indexes = ['url', 'username', 'password'].map(name => header.indexOf(name));
  if (indexes.some(index => index < 0)) throw new Error('请选择 Edge 或 Chrome 导出的密码 CSV（需包含 url、username、password 列）。');
  const entries = []; let skipped = 0;
  for (const values of rows) {
    try { entries.push(credential({origin:values[indexes[0]],username:values[indexes[1]],password:values[indexes[2]]})); }
    catch { skipped++; }
  }
  return { entries, skipped };
}
module.exports = { parsePasswordCSV };
