const test = require('node:test');
const assert = require('node:assert/strict');
const { blockedHost } = require('../src/private-protection');

test('privacy domain rules match complete host labels and subdomains', () => {
  for (const url of ['https://google-analytics.com/collect', 'https://stats.google-analytics.com/collect', 'http://cpro.baidu.com/a.js', 'https://ad.qq.com/a', 'https://hm.baidu.com/hm.js']) assert.equal(blockedHost(url), true, url);
  for (const url of ['https://example.com/google-analytics.com', 'https://google-analytics.com.example.com/', 'https://notgoogle-analytics.com/', 'https://google.com/', 'https://baidu.com/', 'https://qq.com/', 'https://127.0.0.1/', 'file:///google-analytics.com', 'invalid']) assert.equal(blockedHost(url), false, url);
});
