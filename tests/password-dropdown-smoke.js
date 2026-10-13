const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { closeApp } = require('./app-helpers');
const { popupPage } = require('./popover-helpers');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-password-dropdown-'));
const artifacts = path.join(root, 'artifacts'), errors = [], checks = [];
let application, page, base, webId;
const form = '<form onsubmit="event.preventDefault();document.body.dataset.submitted=\'yes\'"><strong>Login</strong><div class="login-row"><input id="user" autocomplete="username" aria-label="Account"><input id="pass" type="password" autocomplete="current-password" aria-label="Password"><button>Login</button></div></form><p>Forgot Password?</p>';
const server = http.createServer((request, response) => {
  const route = new URL(request.url, 'http://localhost').pathname;
  let body = form;
  if (route === '/iframe') body = '<iframe src="/login" style="position:absolute;left:130px;top:85px;width:760px;height:380px;border:7px solid #65747d;transform:scale(.9);transform-origin:top left"></iframe>';
  if (route === '/edge') body = '<div style="position:fixed;right:10px;bottom:10px">' + form + '</div>';
  if (route === '/nested') body = '<div id="scroller" style="overflow:auto;height:260px;width:800px"><div style="height:1000px">' + form + '</div></div>';
  response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  response.end('<!doctype html><title>Password dropdown fixture</title><style>body{margin:34px;background:#2b3843;color:#fff;font:13px "Segoe UI",sans-serif;min-height:1500px}form>strong{display:block;margin-bottom:4px}p{font-size:11px;margin:4px 0}.login-row{display:flex;gap:8px;align-items:center}input{box-sizing:border-box;width:222px;height:38px;padding:0 12px;border:0;border-radius:2px;background:#eee;color:#142c43;font:13px "Segoe UI",sans-serif}button{border:0;border-radius:2px;background:#298ad0;color:#fff;padding:9px 22px;font-weight:bold;font-size:16px}#outside{display:inline-block;padding:10px;margin-top:15px;background:#eee;color:#23323d}</style>' + body + '<div id="outside" tabindex="0">Other page content</div>');
});
async function wait(fn,label) { const start=Date.now(); while(Date.now()-start<15000){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw new Error('Timed out: '+label); }
const command=(action,payload)=>page.evaluate(({action,payload})=>window.browser.command(action,payload),{action,payload});
const remote=code=>application.evaluate(({webContents},{id,code})=>webContents.fromId(id).executeJavaScript(code,true),{id:webId,code});
async function bounds() { return application.evaluate(({BrowserWindow,webContents},id)=>{
  const parent=BrowserWindow.getAllWindows().find(win=>win.getTitle()==='luna');
  const popup=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('popover=passwords'));
  const view=parent.contentView.children.find(view=>view.webContents?.id===id);
  return {parent:parent.getContentBounds(),popup:popup?.getContentBounds(),view:view.getBounds(),zoom:webContents.fromId(id).getZoomFactor(),focused:webContents.fromId(id).isFocused()};
},webId); }
async function navigate(route) {
  await command('popover-close'); await command('navigate',base+route);
  const current=await command('state'); webId=current.tabs.find(tab=>tab.id===current.activeId).webContentsId;
  await wait(async()=>await remote('location.pathname')===route&&await remote('document.readyState')==='complete','page '+route);
  await new Promise(r=>setTimeout(r,250));
}
async function rect(selector,iframe=false) {
  return application.evaluate(async({webContents},{id,selector,iframe})=>{
    const web=webContents.fromId(id),code=`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`;
    if(!iframe)return web.executeJavaScript(code);
    const local=await web.mainFrame.frames[0].executeJavaScript(code);
    const frame=await web.executeJavaScript('(()=>{const f=document.querySelector("iframe"),r=f.getBoundingClientRect();return {x:r.x,y:r.y,sx:r.width/f.offsetWidth,sy:r.height/f.offsetHeight,left:f.clientLeft,top:f.clientTop}})()');
    return {x:frame.x+(local.x+frame.left)*frame.sx,y:frame.y+(local.y+frame.top)*frame.sy,width:local.width*frame.sx,height:local.height*frame.sy};
  },{id:webId,selector,iframe});
}
async function click(selector,iframe=false) {
  const field=await rect(selector,iframe),zoom=(await bounds()).zoom;
  await application.evaluate(({webContents},{id,x,y})=>{const web=webContents.fromId(id);web.focus();web.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});web.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x,y});},{id:webId,x:Math.round((field.x+field.width/2)*zoom),y:Math.round((field.y+field.height/2)*zoom)});
  return field;
}
async function key(keyCode) { await application.evaluate(({webContents},{id,keyCode})=>{const web=webContents.fromId(id);web.sendInputEvent({type:'keyDown',keyCode});web.sendInputEvent({type:'keyUp',keyCode});},{id:webId,keyCode}); }
async function open(selector='#user',iframe=false) { const field=await click(selector,iframe),popup=await popupPage(application,'passwords');await popup.waitForSelector('#password-popup[data-presentation="fill"]');await wait(async()=>!!(await bounds()).popup&&(await bounds()).popup.height<390,'popup fitted');await new Promise(r=>setTimeout(r,180));return {field,popup}; }
async function checkBelow(field) {
  const value=await bounds();assert.ok(Math.abs(value.popup.x+12-value.parent.x-value.view.x-field.x*value.zoom)<=2,'card left aligns with input');
  assert.ok(Math.abs(value.popup.y+12-value.parent.y-value.view.y-(field.y+field.height)*value.zoom-8)<=2,'card sits immediately below the input');
}
async function composite(name) {
  const images=await application.evaluate(async({BrowserWindow,webContents},id)=>{
    const parent=BrowserWindow.getAllWindows().find(win=>win.getTitle()==='luna'),popup=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('popover=passwords'));
    const view=parent.contentView.children.find(view=>view.webContents?.id===id),pb=parent.getContentBounds(),fb=popup.getContentBounds();
    return {ui:(await parent.capturePage()).toDataURL(),web:(await webContents.fromId(id).capturePage()).toDataURL(),popup:(await popup.capturePage()).toDataURL(),view:view.getBounds(),popupRect:{x:fb.x-pb.x,y:fb.y-pb.y,width:fb.width,height:fb.height},width:pb.width,height:pb.height};
  },webId);
  const encoded=await page.evaluate(async images=>{
    const canvas=document.createElement('canvas');canvas.width=images.width;canvas.height=images.height;const ctx=canvas.getContext('2d');
    for(const [key,box] of [['ui',{x:0,y:0,width:images.width,height:images.height}],['web',images.view],['popup',images.popupRect]]){const image=new Image();image.src=images[key];await image.decode();ctx.drawImage(image,box.x,box.y,box.width,box.height);}
    return canvas.toDataURL('image/png').split(',')[1];
  },images);fs.writeFileSync(path.join(artifacts,name),Buffer.from(encoded,'base64'));
}
async function run() {
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;fs.mkdirSync(artifacts,{recursive:true});
  const env={...process.env,LUNA_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  application=await electron.launch({executablePath:process.env.LUNA_EXECUTABLE||require('electron'),args:process.env.LUNA_EXECUTABLE?['--disable-gpu']:[root,'--disable-gpu'],env,timeout:30000});
  page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.tab.selected');
  await command('password-save',{origin:base,username:'songyuanbo',password:'DropdownFixture123!'});await command('update-settings',{theme:'dark'});await navigate('/login');
  let {field,popup}=await open();await checkBelow(field);assert.equal((await bounds()).focused,true,'suggestions leave the login field focused');
  assert.equal(await popup.locator('#password-popup-title').textContent(),'已保存的密码');assert.equal(await popup.locator('.password-account-choice').count(),1);assert.equal(await popup.locator('.password-choice-mask').textContent(),'••••••••');
  assert.equal(await popup.locator('.password-account-choice').textContent(),'songyuanbo••••••••');assert.equal((await popup.locator('#password-manage').textContent()).trim(),'管理密码');
  assert.equal(await popup.locator('#password-manage [data-glyph="key"]').count(),1);await popup.screenshot({path:path.join(artifacts,'password-dropdown-dark.png')});await composite('password-dropdown-in-page.png');
  await key('Escape');await wait(()=>popup.isClosed(),'Escape dismiss');checks.push('reference layout, single-account suggestions, input anchoring, preserved focus and fixed masks');
  await command('password-save',{origin:base,username:'bob',password:'BobDropdownFixture123!'});await command('password-save',{origin:base,username:'alice',password:'AliceDropdownFixture123!'});await navigate('/login');
  ({field,popup}=await open());await key('Down');await wait(async()=>await popup.locator('.password-account-choice.selected strong').textContent()==='bob','keyboard choice');await key('Return');await wait(()=>popup.isClosed(),'Enter fills');assert.equal(await remote('document.getElementById("user").value'),'bob');assert.equal(await remote('document.getElementById("pass").value'),'BobDropdownFixture123!');assert.equal(await remote('document.body.dataset.submitted'),undefined);checks.push('arrow/Enter fills without submitting login');
  ({popup}=await open('#user'));await remote('document.getElementById("user").value=""');await application.evaluate(({webContents},id)=>webContents.fromId(id).insertText('ali'),webId);await wait(async()=>await popup.locator('.password-account-choice').count()===1,'typing filters');assert.equal(await popup.locator('.password-account-choice strong').textContent(),'alice');await key('Return');await wait(()=>popup.isClosed(),'filtered choice');assert.equal(await remote('document.getElementById("user").value'),'alice');checks.push('typing filters while field retains focus');
  ({popup}=await open('#pass'));await popup.locator('.password-account-choice').filter({hasText:'songyuanbo'}).click();await wait(()=>popup.isClosed(),'mouse choice');assert.equal(await remote('document.getElementById("user").value'),'songyuanbo');assert.equal(await remote('document.activeElement.id'),'pass');checks.push('password-field suggestions and mouse fill restore focus');
  ({popup}=await open('#user'));await click('#outside');await wait(()=>popup.isClosed(),'outside click');({popup}=await open('#user'));await remote('window.scrollTo(0,80)');await wait(()=>popup.isClosed(),'scroll dismiss');await navigate('/nested');({popup}=await open('#user'));await remote('document.getElementById("scroller").scrollTop=20');await wait(()=>popup.isClosed(),'nested scroll dismiss');checks.push('outside click and page/nested scrolling dismiss stale cards');
  await navigate('/login');({popup}=await open('#pass'));await remote('document.getElementById("pass").style.display="none"');await wait(()=>popup.isClosed(),'hidden focused field dismiss');
  await navigate('/login');({popup}=await open('#user'));const focusWindow=await application.evaluate(async({BrowserWindow})=>{const other=new BrowserWindow({width:240,height:160,show:false,title:'Focus fixture',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await other.loadURL('data:text/html,<title>Focus fixture</title><p>Other window</p>');other.show();other.focus();return other.id;});await wait(()=>popup.isClosed(),'switching windows dismiss');await application.evaluate(({BrowserWindow},id)=>{BrowserWindow.fromId(id).destroy();BrowserWindow.getAllWindows().find(win=>win.getTitle()==='luna').focus();},focusWindow);checks.push('removed/hidden fields and application focus changes dismiss');
  await navigate('/login');await application.evaluate(({webContents},id)=>webContents.fromId(id).setZoomFactor(1.25),webId);await new Promise(r=>setTimeout(r,200));({field,popup}=await open());await checkBelow(field);await command('popover-close');
  await navigate('/iframe');({field,popup}=await open('#user',true));await checkBelow(field);assert.equal(await popup.locator('.password-account-choice').count(),3);await command('popover-close');checks.push('zoom and transformed same-origin iframe field coordinates');
  await application.evaluate(({webContents},id)=>webContents.fromId(id).setZoomFactor(1),webId);await navigate('/edge');({field,popup}=await open('#pass'));const edge=await bounds();assert.equal(await popup.locator('#password-popup').getAttribute('data-edge'),'bottom');assert.ok(edge.popup.x+edge.popup.width<=edge.parent.x+edge.parent.width);assert.ok(edge.popup.y+edge.popup.height-12<=edge.parent.y+edge.view.y+field.y-6);await popup.screenshot({path:path.join(artifacts,'password-dropdown-edge.png')});checks.push('below/above placement and right window edge clamping');
  await command('update-settings',{theme:'light'});await wait(async()=>await popup.locator('html').getAttribute('data-theme')==='light','live light theme');await popup.screenshot({path:path.join(artifacts,'password-dropdown-light.png')});await popup.locator('#password-manage').click();await page.waitForSelector('[data-group="passwords"]:visible');checks.push('live themes and manage-passwords navigation');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(artifacts,'password-dropdown-result.json'),JSON.stringify({passed:true,version:(await command('state')).version,checks,testedAt:new Date().toISOString()},null,2));console.log('PASS: '+checks.join('; '));await closeApp(application,page,false);application=null;
}
run().catch(async error=>{console.error(error);if(page&&!page.isClosed())await page.screenshot({path:path.join(artifacts,'password-dropdown-failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(application)await closeApp(application,page,false).catch(()=>application.process().kill());await new Promise(r=>server.close(r));fs.rmSync(profile,{recursive:true,force:true});});
