const { app, screen } = require('electron');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { originOf, matchesHost, cookieKey, normalizeCookie, cookieURL, cookieDetails, fingerprint, sanitizeStorage, READ_STORAGE } = require('./compatibility-model');
const hosts = new Map();
let ledger, ledgerFile;
function cookieLedger() {
  if(ledger)return ledger;
  ledger=new Map();ledgerFile=path.join(app.getPath('userData'),'compatibility-cookies.json');
  try {const entries=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));if(Array.isArray(entries))for(const entry of entries.slice(-5000))if(entry&&typeof entry.name==='string'&&typeof entry.domain==='string'&&typeof entry.path==='string')ledger.set(cookieKey(entry),entry);}catch{}
  return ledger;
}
function remember(cookie) {
  const {value,expirationDate,...entry}=cookie,key=cookieKey(cookie),map=cookieLedger();
  if(JSON.stringify(map.get(key))===JSON.stringify(entry))return;
  map.set(key,entry);if(map.size>5000)map.delete(map.keys().next().value);
  fs.writeFileSync(ledgerFile+'.tmp',JSON.stringify([...map.values()]));fs.renameSync(ledgerFile+'.tmp',ledgerFile);
}
function executable() { return app.isPackaged ? path.join(process.resourcesPath,'luna-ie-host.exe') : path.join(__dirname,'native','luna-ie-host.exe'); }
class IEHost extends EventEmitter {
  constructor(parent, tab) {
    super(); Object.assign(this,{parent,tab});
    this.requests = new Map(); this.counter = 0; this.origins = new Set(); this.snapshots = new Map(); this.shadow = new Map(); this.ignoreNative = new Map(); this.bootstrapped = new Set(); this.writes = new Set(); this.queue = Promise.resolve(); this.closed = false;
    const handle = parent.getNativeWindowHandle();
    const hwnd = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    this.child = spawn(executable(),[hwnd],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.events=[];
    this.child.stdin.on('error',()=>{});
    const lines = createInterface({input:this.child.stdout});
    lines.on('line',line=>{ if(line.length>8*1024*1024)return; try { const value=JSON.parse(line); if(value.reply){const entry=this.requests.get(value.reply);if(entry){this.requests.delete(value.reply);clearTimeout(entry.timer);value.error?entry.reject(new Error(value.error)):entry.resolve(value.data);}}else {this.events.push({type:value.type,message:value.message,url:value.type==='state'||value.type==='loaded'?value.url:undefined});if(this.events.length>100)this.events.shift();this.emit('message',value);} }catch(error){this.emit('failure',error);} });
    this.child.on('error',error=>this.emit('failure',error));
    this.child.on('exit',()=>{this.closed=true;hosts.delete(tab.id);for(const entry of this.requests.values()){clearTimeout(entry.timer);entry.reject(new Error('IE 组件已退出'));}this.requests.clear();this.emit('exit');});
    // stderr is drained, never forwarded into UI or a persistent log; cookies and
    // website storage only travel through the private process pipes.
    this.child.stderr.resume();
    this.ready = new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('IE 组件启动超时')),10000);this.on('message',value=>{if(value.type==='ready'){clearTimeout(timer);resolve();}if(value.type==='fatal'){clearTimeout(timer);reject(new Error(value.message));}});this.once('failure',error=>{clearTimeout(timer);reject(error);});this.once('exit',()=>{clearTimeout(timer);reject(new Error('IE 组件未能启动'));});});
    hosts.set(tab.id,this);
  }
  request(op,payload={}) {
    if(this.closed || this.child.stdin.destroyed) return Promise.reject(new Error('IE 组件已退出'));
    const id=++this.counter;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.requests.delete(id);reject(new Error('IE 操作超时'));},10000);this.requests.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,op,...payload})+'\n');});
  }
  layout(rect,visible) {
    this.visible=visible;
    const scale=screen.getDisplayMatching(this.parent.getBounds()).scaleFactor;
    const parentBounds=this.parent.getContentBounds();
    const next={x:Math.round(rect.x*scale),y:Math.round(rect.y*scale),width:Math.round(rect.width*scale),height:Math.round(rect.height*scale),visible,parentX:parentBounds.x,parentY:parentBounds.y};
    const signature=JSON.stringify(next);if(this.lastLayout===signature || this.closed)return;this.lastLayout=signature;this.request('layout',next).catch(()=>{});
  }
  async close() { if(this.closed)return;await this.request('close').catch(()=>{});if(!this.closed){this.child.stdin.end();const timer=setTimeout(()=>{if(!this.closed)this.child.kill();},1000);timer.unref();} }
}
class Compatibility {
  constructor({parent,session,tabs,activeId,changed,navigate,notice,shortcut,newTab,visit,layout,isPrivate}) {
    Object.assign(this,{parent,session,tabs,activeId,changed,navigate,notice,shortcut,newTab,visit,layout,isPrivate});
    this.available=process.platform==='win32'&&fs.existsSync(executable());
    this.writes=new Set();
    this.cookieChanged=(_,cookie,cause,removed)=>{for(const host of hosts.values())if(host.manager===this){const task=this.pushChange(host,cookie,removed).catch(error=>this.syncError(host,error));this.writes.add(task);task.finally(()=>this.writes.delete(task));}};
    session.cookies.on('changed',this.cookieChanged);
    parent.once('closed',()=>{session.cookies.removeListener('changed',this.cookieChanged);for(const host of hosts.values())if(host.manager===this)host.close().catch(()=>{});});
  }
  status(tab) { return {available:this.available&&!this.isPrivate,enabled:!!tab?.ie,documentMode:tab?.ie?.documentMode||null,syncError:tab?.ie?.syncError||'',reason:this.isPrivate?'无痕窗口不使用 Windows IE 网站存储':!this.available?'系统 IE 组件或兼容宿主不可用':''}; }
  syncError(host,error) { if(host.tab.ie!==host)return;host.syncError=error.message;this.changed(); }
  async pushChange(host,cookie,removed) {
    const site=[...host.origins].find(origin=>matchesHost(cookie,origin));if(!site)return;
    const clean=normalizeCookie(cookie,site);if(!clean)return;const key=cookieKey(clean),hash=fingerprint(clean);
    if(!removed&&host.shadow.get(key)===hash)return;
    host.writes.add(key);host.shadow.set(key,removed?null:hash);
    try { await host.request('cookies',{cookies:[{...clean,url:cookieURL(clean,site),...(removed?{value:'',expirationDate:1}:{})}]}); }
    finally { host.writes.delete(key); }
  }
  async cookiesFor(host,url) {
    await host.queue;
    host.origins.add(originOf(url));
    const cookies=(await this.session.cookies.get({})).map(cookie=>normalizeCookie(cookie,url)).filter(Boolean);
    const keys=new Set(cookies.map(cookieKey));
    const removed=[...cookieLedger().values()].filter(cookie=>matchesHost(cookie,url)&&!keys.has(cookieKey(cookie)));
    if(removed.length)await host.request('cookies',{cookies:removed.map(cookie=>({...cookie,value:'',expirationDate:1,url:cookieURL(cookie,url)}))});
    for(const cookie of cookies){host.shadow.set(cookieKey(cookie),fingerprint(cookie));host.origins.add(originOf(cookieURL(cookie,url)));remember(cookie);}
    if(!host.bootstrapped.has(originOf(url))){host.bootstrapped.add(originOf(url));await host.request('cookie-baseline',{url});}
    return cookies.map(cookie=>({...cookie,url:cookieURL(cookie,url)}));
  }
  nativeCookies(host,value) {
    const origin=originOf(value.url);if(!origin||!host.origins.has(origin)||!Array.isArray(value.cookies))return;
    host.queue=host.queue.then(async()=>{
      if(host.clearing)return;
      const current=new Map(value.cookies.map(cookie=>normalizeCookie(cookie,value.url)).filter(Boolean).map(cookie=>[cookieKey(cookie),cookie]));
      const previous=host.snapshots.get(value.url)||new Map();
      for(const [key,cookie] of current) {
        if(host.writes.has(key))continue;
        const hash=fingerprint(cookie);if(host.ignoreNative.get(key)===hash||host.shadow.get(key)===hash)continue;
        host.ignoreNative.delete(key);remember(cookie);
        host.shadow.set(key,hash);await this.session.cookies.set(cookieDetails(cookie,value.url));
      }
      for(const [key,cookie] of previous) {
        if(current.has(key)||host.writes.has(key)||host.shadow.get(key)!==fingerprint(cookie))continue;
        host.shadow.set(key,null);
        await this.session.cookies.set({...cookieDetails(cookie,value.url),value:'',expirationDate:1});
      }
      host.snapshots.set(value.url,current);
    }).catch(error=>this.syncError(host,error));
  }
  async enter(tab,url=tab?.url) {
    if(!this.available||this.isPrivate)throw new Error(this.status(tab).reason||'IE 兼容模式不可用');
    if(!tab||!originOf(url))throw new Error('请先打开 HTTP / HTTPS 网页');
    if(tab.ie)return;
    const web=tab.view.webContents;let storage=null;
    if(web.isLoading() && originOf(web.getURL())!==originOf(url))await new Promise(resolve=>{
      const finish=()=>{clearTimeout(timer);web.removeListener('did-finish-load',finish);web.removeListener('destroyed',finish);resolve();};
      const timer=setTimeout(finish,3000);web.once('did-finish-load',finish);web.once('destroyed',finish);
    });
    if(!this.tabs.has(tab.id)||web.isDestroyed())return;
    if(originOf(web.getURL())===originOf(url))try{storage=sanitizeStorage(await web.executeJavaScript(READ_STORAGE),originOf(url));}catch{}
    const host=new IEHost(this.parent,tab);host.manager=this;tab.ie=host;tab.url=url;tab.loading=true;tab.error=null;
    host.on('message',value=>{
      if(tab.ie!==host)return;
      if(value.type==='navigation'&&originOf(value.url)){if(tab.error){tab.error=null;this.layout();this.changed();}this.cookiesFor(host,value.url).then(cookies=>host.request('resume',{token:value.token,cookies})).catch(error=>this.syncError(host,error));}
      else if(value.type==='cookies')this.nativeCookies(host,value);
      else if(value.type==='cookie-baseline'&&host.origins.has(originOf(value.url)))for(const entry of value.cookies||[]){const cookie=normalizeCookie(entry,value.url);if(cookie&&!host.shadow.has(cookieKey(cookie))&&!cookieLedger().has(cookieKey(cookie)))host.ignoreNative.set(cookieKey(cookie),fingerprint(cookie));}
      else if(value.type==='state'&&originOf(value.url)) { if(tab.error)return;const changed=tab.url!==value.url||tab.title!==value.title||tab.loading!==value.loading||host.canBack!==value.canBack||host.canForward!==value.canForward||host.documentMode!==value.documentMode;tab.url=value.url;tab.title=value.title||new URL(value.url).hostname;tab.loading=!!value.loading;host.canBack=!!value.canBack;host.canForward=!!value.canForward;host.documentMode=value.documentMode;if(value.complete&&!value.loading&&host.visitedURL!==tab.url){host.visitedURL=tab.url;this.visit(tab);}if(changed)this.changed(); }
      else if(value.type==='loaded') {if(tab.error)return;host.documentMode=value.documentMode;tab.loading=false;this.visit(tab);this.changed();}
      else if(value.type==='navigation-error') {if(originOf(value.url))tab.url=value.url;tab.title='IE 页面未能打开';tab.loading=false;tab.error={code:'IE_NAVIGATION '+value.status,description:value.message};this.layout();this.changed();}
      else if(value.type==='focus'&&host.visible&&this.activeId()!==tab.id)this.shortcut('activate-ie',tab.id);
      else if(value.type==='shortcut'){if(host.visible&&this.activeId()!==tab.id)this.shortcut('activate-ie',tab.id);this.shortcut('native-key',value);}
      else if(value.type==='open-url'&&originOf(value.url))this.newTab(value.url);
      else if(value.type==='error'||value.type==='blocked'){host.syncError=value.message;this.changed();this.notice(value.message);}
    });
    host.on('failure',error=>this.syncError(host,error));
    host.on('exit',()=>{if(tab.ie===host){delete tab.ie;tab.loading=false;tab.error={description:'IE 兼容组件已退出，请重新打开兼容模式。',code:'IE_EXIT'};this.layout();this.changed();}});
    try {await host.ready;web.stop();await web.loadURL('about:blank').catch(()=>{});this.layout();await host.request('navigate',{url,cookies:await this.cookiesFor(host,url),storage});this.changed();}
    catch(error){delete tab.ie;await host.close();this.navigate(tab,url);throw error;}
  }
  async flush(tab) { const host=tab?.ie;if(!host)return null;const data=await host.request('export');await host.queue;return {url:data.url,storage:sanitizeStorage(data.storage,originOf(data.url))}; }
  async leave(tab) { const host=tab?.ie;if(!host)return;const data=await this.flush(tab);const url=tab.error?tab.url:originOf(data?.url)?data.url:tab.url;delete tab.ie;await host.close();tab.pendingIEStorage=data?.storage?.origin===originOf(url)?data.storage:null;this.navigate(tab,url); }
  async closeTab(tab) { const host=tab?.ie;if(!host)return;try{await this.flush(tab);}catch{}delete tab.ie;await host.close(); }
  async navigateTab(tab,url) { if(!originOf(url)){await this.closeTab(tab);this.navigate(tab,url);return;}await this.flush(tab);await tab.ie.request('navigate',{url,cookies:await this.cookiesFor(tab.ie,url)}); }
  beginClear(types) { if(types.includes('cookies'))for(const host of hosts.values())if(host.manager===this)host.clearing=true; }
  endClear() { for(const host of hosts.values())if(host.manager===this)host.clearing=false; }
  async clear(types,origins=null) {
    await Promise.all([...this.writes]);
    const surviving=types.includes('cookies')?await this.session.cookies.get({}):[];
    for(const host of hosts.values())if(host.manager===this) {
      await host.queue;
      if(types.includes('cookies')) {
        host.clearing=true;host.snapshots.clear();host.shadow.clear();
        for(const cookie of surviving){const site=[...host.origins].find(site=>matchesHost(cookie,site));const clean=site&&normalizeCookie(cookie,site);if(clean)host.shadow.set(cookieKey(clean),fingerprint(clean));}
        const origin=originOf(host.tab.url);if(origins===null||origins.includes(origin))await host.request('clear-storage',{origin});
        host.clearing=false;
      }
    }
  }
}
module.exports = { Compatibility, IEHost, hosts, executable };
