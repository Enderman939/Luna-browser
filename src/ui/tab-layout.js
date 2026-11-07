(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.lunaTabLayout = api;
})(globalThis, function () {
  function widths(available, tabs, groups = []) {
    available = Math.max(0, available);
    const desired = tabs.map(tab => tab.pinned ? 52 : 218);
    const groupDesired = groups.map(() => 90);
    const total = [...desired, ...groupDesired].reduce((sum, width) => sum + width, 0);
    const width = Math.max(0, Math.min(available, total) - 1);
    const groupSpace = Math.min(width * .2, groupDesired.length * 90);
    const tabSpace = Math.max(0, width - groupSpace);
    // Every tab gets a slice even when the strip is narrower than its icons.
    const base = tabs.length ? Math.min(34, tabSpace / tabs.length) : 0;
    const extra = Math.max(0, tabSpace - base * tabs.length);
    const weights = desired.map(value => Math.max(0, value - base));
    const sum = weights.reduce((a, b) => a + b, 0);
    return {
      width,
      tabs: desired.map((value, i) => base + (sum ? extra * weights[i] / sum : 0)),
      groups: groups.map(() => groupSpace / groups.length),
    };
  }
  return { widths };
});
