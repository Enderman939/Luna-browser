const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCookie, matchesHost, cookieDetails, cookieKey, sanitizeStorage, storageScript } = require('../src/compatibility-model');
const { sanitizeLayout } = require('../src/workspace-model');
test('IE cookie sync enforces host boundaries, host-only and partitioned-cookie isolation',()=>{
  const cookie={name:'login',value:'v',domain:'.example.com',path:'/',hostOnly:false};
  assert.equal(matchesHost(cookie,'https://app.example.com'),true);assert.equal(matchesHost(cookie,'https://evil-example.com'),false);assert.equal(matchesHost({...cookie,hostOnly:true},'https://app.example.com'),false);
  assert.equal(matchesHost({...cookie,partitionKey:{topLevelSite:'https://other.example'}},'https://example.com'),false);
  assert.equal(normalizeCookie(cookie,'file:///secret'),null);assert.equal(normalizeCookie({...cookie,name:'bad\r\nCookie'},'https://example.com'),null);
});
test('cookie round trips preserve HttpOnly, Secure, path, expiry, domain scope and distinguish same-name paths',()=>{
  const cookie={name:'login',value:'a=b;c',domain:'app.example.com',path:'/auth',hostOnly:true,secure:true,httpOnly:true,sameSite:'strict',expirationDate:1900000000};
  const details=cookieDetails(cookie,'http://app.example.com/page');assert.equal(details.url,'https://app.example.com/auth/');assert.equal(details.domain,undefined);assert.equal(details.httpOnly,true);assert.equal(details.secure,true);assert.equal(details.sameSite,'strict');assert.equal(details.expirationDate,1900000000);
  assert.notEqual(cookieKey(cookie),cookieKey({...cookie,path:'/'}));assert.equal(cookieDetails({...cookie,hostOnly:false,domain:'.example.com'},'https://app.example.com').domain,'.example.com');
});
test('storage transfers require exact origins, preserve unusual keys and reject oversized or malformed data',()=>{
  const local=JSON.parse('{"__proto__":"literal-value","token":"abc"}');
  const value=sanitizeStorage({origin:'https://example.com',local,session:{test:'1'}},'https://example.com');assert.ok(value);assert.equal(value.local.__proto__,'literal-value');assert.equal(Object.getPrototypeOf(value.local),null);assert.ok(storageScript(value).includes('location.origin!==d.origin'));
  assert.equal(sanitizeStorage({origin:'https://example.com',local,session:{}},'http://example.com'),null);assert.equal(sanitizeStorage({origin:'https://example.com',local:{token:'x'.repeat(1024*1024+1)},session:{}},'https://example.com'),null);
});
test('IE restoration follows safe URL indexes and excludes internal or discarded URL slots',()=>{
  const value=sanitizeLayout({urls:['file:///secret','https://example.com','luna://settings'],ie:[0,1,2]});assert.deepEqual(value.ie,[0]);
});
