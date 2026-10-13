function addressCandidates(query, { tabs = [], bookmarks = [], history = [] }, limit = 8) {
  const text = String(query || '').trim().slice(0, 8192).toLowerCase();
  const items = [], seen = new Set();
  const add = (entry, type) => {
    if (!/^https?:\/\//i.test(entry.url || '') || !entry.url.toLowerCase().includes(text) && !String(entry.title || '').toLowerCase().includes(text)) return;
    if (seen.has(entry.url)) return; seen.add(entry.url);
    items.push({ url: entry.url, title: entry.title || entry.url, type, ...(type === 'tab' ? { tabId: entry.id } : {}) });
  };
  for (const tab of tabs) add(tab, 'tab');
  for (const entry of bookmarks) add(entry, 'bookmark');
  for (const entry of history) add(entry, 'history');
  return items.slice(0, limit);
}
module.exports = { addressCandidates };
