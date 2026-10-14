const { SEARCH_ENGINES, resolveWebsite } = require('./core');
const { addressCandidates } = require('./address-candidates');
function suggestionURL(engine, query) {
  const encoded = encodeURIComponent(query);
  return engine === 'google' ? 'https://suggestqueries.google.com/complete/search?client=firefox&q=' + encoded
    : engine === 'bing' ? 'https://api.bing.com/osjson.aspx?query=' + encoded
    : engine === 'duckduckgo' ? 'https://duckduckgo.com/ac/?q=' + encoded + '&type=list'
    : 'https://www.baidu.com/sugrec?prod=pc&json=1&wd=' + encoded;
}
function suggestionPhrases(value) {
  const list = Array.isArray(value) ? Array.isArray(value[1]) ? value[1] : value : Array.isArray(value?.g) ? value.g : value?.s;
  return [...new Set((Array.isArray(list) ? list : []).map(item => typeof item === 'string' ? item : item?.phrase || item?.q).filter(item => typeof item === 'string' && item.trim() && item.length <= 200 && !/[\x00-\x1f]/.test(item)).map(item => item.trim()))].slice(0, 6);
}
function searchCandidates(query, local, engine, phrases = [], filter = 'all') {
  const text = String(query || '').trim().slice(0, 8192); if (!text) return [];
  const engineInfo = SEARCH_ENGINES[engine] || SEARCH_ENGINES.baidu;
  const links = addressCandidates(text, local, 8);
  if (filter !== 'all') return links.filter(item => item.type === filter);
  const search = value => ({ title: value, url: engineInfo.prefix + encodeURIComponent(value), type: 'search', engine: engineInfo.name });
  const direct = resolveWebsite(text);
  const items = [...(direct ? [{ type: 'navigate', title: text, url: direct }] : []), search(text)];
  if (!direct) for (const value of phrases) if (value.toLowerCase() !== text.toLowerCase()) items.push(search(value));
  // Exact URL tab/bookmark matches keep their useful switch-tab action.
  for (const link of links) { const existing = items.findIndex(item => item.url === link.url && item.type === 'navigate'); if (existing >= 0) items[existing] = link; else items.push(link); }
  return items.slice(0, 12);
}
class SearchSuggestions {
  constructor(fetch) { this.fetch = fetch; this.cache = new Map(); this.controller = null; }
  cancel() { this.controller?.abort(); this.controller = null; }
  async get(query, engine) {
    this.cancel(); const text = query.trim(); if (!text || text.length > 200 || resolveWebsite(text) || /[@/:\\]|\b(?:password|token|secret)=/i.test(text)) return [];
    const key = engine + ':' + text.toLowerCase(), cached = this.cache.get(key); if (cached && Date.now() - cached.time < 60000) return cached.values;
    const controller = this.controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await this.fetch(suggestionURL(engine, text), { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok || Number(response.headers.get('content-length')) > 100 * 1024) { await response.body?.cancel(); return []; }
      let body = '', bytes = 0; const decoder = new TextDecoder();
      for await (const chunk of response.body) { controller.signal.throwIfAborted(); bytes += chunk.length; if (bytes > 100 * 1024) throw new Error('建议响应过大'); body += decoder.decode(chunk, { stream: true }); }
      body += decoder.decode(); const values = suggestionPhrases(JSON.parse(body));
      this.cache.set(key, { values, time: Date.now() }); if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value); return values;
    } catch { return []; } finally { clearTimeout(timer); if (this.controller === controller) this.controller = null; }
  }
}
module.exports = { SearchSuggestions, searchCandidates, suggestionURL, suggestionPhrases };
