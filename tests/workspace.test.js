const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeLayout, splitBounds } = require('../src/workspace-model');
const { sanitizeData } = require('../src/core');
const { widths } = require('../src/ui/tab-layout');
require('./page-navigation.test');
test('tab allocation fits all tabs into the available strip, including hundreds of tabs', () => {
  for (const count of [1, 5, 31, 100, 1000]) for (const available of [120, 500, 1400]) {
    const tabs = Array.from({ length: count }, (_, index) => ({ pinned: index < 2 }));
    const allocation = widths(available, tabs, [{}, {}]);
    assert.equal(allocation.tabs.length, count);
    assert.ok(allocation.tabs.every(value => Number.isFinite(value) && value > 0));
    assert.ok(allocation.tabs.reduce((sum, value) => sum + value, 0) + allocation.groups.reduce((sum, value) => sum + value, 0) <= available + .01);
  }
});
test('session restoration retains tabs and selected positions beyond the former limits', () => {
  const urls = Array.from({ length: 125 }, (_, i) => `https://example.test/${i}`);
  const layout = { urls, activeIndex: 124, groups: [{ name: 'Last tabs', indices: [100, 124] }], pinned: [2, 100] };
  const data = sanitizeData({ session: urls, sessionActive: 124, sessionWindows: Array.from({ length: 15 }, () => layout) });
  assert.equal(data.session.length, 125); assert.equal(data.sessionActive, 124); assert.equal(data.sessionWindows.length, 15);
  assert.equal(data.sessionWindows[14].urls.length, 125); assert.equal(data.sessionWindows[14].activeIndex, 124);
  assert.deepEqual(data.sessionWindows[14].groups[0].indices, [100, 124]);
});
test('split panes preserve their area and gap at clamped ratios without overlap', () => {
  for (const width of [760, 1360, 1921]) for (const ratio of [-2, .25, .5, .75, 5]) {
    const [left,right] = splitBounds({x:15,y:160,width,height:600},ratio);
    assert.equal(left.x,15); assert.equal(right.x,left.x+left.width+10);
    assert.equal(left.width+right.width+10,width); assert.equal(right.height,600);
    assert.ok(left.width>=Math.floor((width-10)*.25)&&left.width<=Math.ceil((width-10)*.75));
  }
});
test('restored group and split indexes remain attached to their URLs when unsafe URLs are removed', () => {
  const clean = sanitizeLayout({urls:['file:///secret','https://left.example/','luna://settings','https://right.example/'],activeIndex:3,groups:[{name:' Work ',color:'blue',collapsed:true,indices:[1,3,3,-1]}],split:{left:1,right:3,ratio:.65}});
  assert.deepEqual(clean,{urls:['https://left.example/','luna://settings','https://right.example/'],activeIndex:2,groups:[{name:'Work',color:'blue',collapsed:true,indices:[0,2]}],split:{left:0,right:2,ratio:.65}});
  assert.equal(sanitizeLayout({urls:['file:///secret']}),null);
  assert.equal(sanitizeLayout({urls:['luna://settings','https://right.example/'],split:{left:0,right:1}}).split,null);
});
test('window session layouts survive data normalization and reject malformed indexes and ratios', () => {
  const value = {urls:['https://a.example/','https://b.example/'],activeIndex:999,groups:[{name:'A',indices:[0],color:'javascript:bad'}],split:{left:0,right:1,ratio:Infinity}};
  const data = sanitizeData({sessionWindows:[value]});
  assert.equal(data.sessionWindows[0].activeIndex,0); assert.equal(data.sessionWindows[0].groups[0].color,'gray'); assert.equal(data.sessionWindows[0].split.ratio,.5);
  assert.deepEqual(sanitizeData(data).sessionWindows,data.sessionWindows);
});
