const { isSessionUrl } = require('./core');
const GROUP_COLORS = ['gray', 'blue', 'green', 'amber', 'red', 'purple'];
function splitBounds(area, ratio = 0.5) {
  const gap = 10, usable = Math.max(0, area.width - gap);
  const left = Math.round(usable * Math.min(0.75, Math.max(0.25, ratio)));
  return [{ ...area, width: left }, { ...area, x: area.x + left + gap, width: usable - left }];
}
function sanitizeLayout(value) {
  if (!value || !Array.isArray(value.urls)) return null;
  // Retain index associations while dropping unsafe persisted URLs.
  const indices = value.urls.map((url, index) => isSessionUrl(url) ? index : -1).filter(index => index >= 0).slice(0, 30);
  if (!indices.length) return null;
  const indexOf = index => indices.indexOf(index);
  const groups = Array.isArray(value.groups) ? value.groups.slice(0, 30).flatMap(group => {
    if (!group || typeof group.name !== 'string' || !Array.isArray(group.indices)) return [];
    const members = [...new Set(group.indices.map(indexOf).filter(index => index >= 0))];
    return members.length ? [{ name: group.name.trim().slice(0, 60) || '标签页组', color: GROUP_COLORS.includes(group.color) ? group.color : 'gray', collapsed: group.collapsed === true, indices: members }] : [];
  }) : [];
  const left = indexOf(value.split?.left), right = indexOf(value.split?.right);
  const split = left >= 0 && right >= 0 && left !== right && /^https?:/.test(value.urls[indices[left]]) && /^https?:/.test(value.urls[indices[right]]) ? { left, right, ratio: Number.isFinite(value.split.ratio) ? Math.min(0.75, Math.max(0.25, value.split.ratio)) : 0.5 } : null;
  const ie = Array.isArray(value.ie) ? [...new Set(value.ie.map(indexOf).filter(index=>index>=0 && /^https?:/.test(value.urls[indices[index]])))] : [];
  const mapped = key => Array.isArray(value[key]) ? [...new Set(value[key].map(indexOf).filter(index => index >= 0))] : [];
  const pinned = mapped('pinned'), muted = mapped('muted');
  return { urls: indices.map(index => value.urls[index]), activeIndex: Math.max(0, indexOf(value.activeIndex)), groups, split, ...(ie.length ? {ie} : {}), ...(pinned.length ? { pinned } : {}), ...(muted.length ? { muted } : {}) };
}
module.exports = { GROUP_COLORS, splitBounds, sanitizeLayout };
