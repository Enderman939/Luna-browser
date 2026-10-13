// Browser-window coordinates are DIP; the page reports CSS pixels.
function fieldAnchor(rect, viewport, zoom = 1) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height, zoom].every(Number.isFinite) || rect.width < 5 || rect.height < 5 || zoom <= 0) return null;
  const left = Math.max(0, rect.x * zoom), top = Math.max(0, rect.y * zoom);
  const right = Math.min(viewport.width, (rect.x + rect.width) * zoom), bottom = Math.min(viewport.height, (rect.y + rect.height) * zoom);
  if (right - left < 5 || bottom - top < 5) return null;
  return { x: viewport.x + left, y: viewport.y + top, width: right - left, height: bottom - top, field: true, viewport: { ...viewport } };
}
function fieldPlacement(anchor, parent, popup, area) {
  const viewport = anchor.viewport || { x: 0, y: 0, width: parent.width, height: parent.height };
  const left = Math.max(parent.x, area.x), right = Math.min(parent.x + parent.width, area.x + area.width);
  const top = Math.max(parent.y + viewport.y, area.y), bottom = Math.min(parent.y + viewport.y + viewport.height, area.y + area.height);
  const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));
  const x = clamp(parent.x + anchor.x - 12, left, right - popup.width);
  const below = parent.y + anchor.y + anchor.height - 4, above = parent.y + anchor.y + 4 - popup.height;
  const edge = bottom - below >= popup.height || bottom - below >= parent.y + anchor.y - top ? 'top' : 'bottom';
  const y = clamp(edge === 'top' ? below : above, top, bottom - popup.height);
  const pointer = clamp(parent.x + anchor.x + Math.min(anchor.width / 2, 28) - x - 12, 20, popup.width - 44);
  return { x: Math.round(x), y: Math.round(y), edge, pointer: Math.round(pointer) };
}
module.exports = { fieldAnchor, fieldPlacement };
