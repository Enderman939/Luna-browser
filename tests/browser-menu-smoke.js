const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { closeApp } = require('./app-helpers');
const { popupPage } = require('./popover-helpers');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'luna-browser-menu-')),artifacts=path.join(root,'artifacts'),checks=[],errors=[];
let application,page,base,webId;
const server=http.createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end('<!doctype html><title>Browser menu fixture</title><body style="padding:35px;font:18px sans-serif"><article><h1>Menu integration article</h1><p>'+('This article verifies the browser menu and its page tools. '.repeat(100))+'</p></article>');});
async function wait(fn,label){const start=Date.now();while(Date.now()-start<15000){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw new Error('Timed out: '+label);}
const command=(action,payload)=>page.evaluate(({action,payload})=>window.browser.command(action,payload),{action,payload});
const state=()=>command('state');
async function shortcut(keyCode,modifiers=[]){await application.evaluate(({BrowserWindow},{keyCode,modifiers})=>{const web=BrowserWindow.getAllWindows().find(win=>win.getTitle()==='luna').webContents;web.focus();web.sendInputEvent({type:'keyDown',keyCode,modifiers});web.sendInputEvent({type:'keyUp',keyCode,modifiers});},{keyCode,modifiers});}
async function open(){await command('popover-close');await page.locator('#menu-button').click();const menu=await popupPage(application,'browser');await menu.waitForSelector('#browser-menu:not([hidden])');await new Promise(r=>setTimeout(r,180));return menu;}
async function action(name){const menu=await open();await menu.locator('.browser-menu-root [data-browser-action="'+name+'"]').click();return menu;}
async function tool(actionName){const menu=await open();await menu.locator('[data-menu-submenu="tools"]').click();await menu.locator('[data-submenu-page="tools"] [data-browser-action="'+actionName+'"]').click();}
async function currentWeb(){await command('navigate',base);await wait(async()=>{const current=await state();const tab=current.tabs.find(tab=>tab.id===current.activeId);webId=tab.webContentsId;return tab.title==='Browser menu fixture'&&!tab.loading;},'fixture page');}
async function closeTool(){let tool;await wait(()=>{tool=application.context().pages().find(page=>page.url().endsWith('/page-tool.html'));return !!tool&&!tool.isClosed();},'page tool');await tool.locator('#close').click();}
async function run(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;fs.mkdirSync(artifacts,{recursive:true});
  const env={...process.env,LUNA_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  application=await electron.launch({executablePath:process.env.LUNA_EXECUTABLE||require('electron'),args:process.env.LUNA_EXECUTABLE?['--disable-gpu']:[root,'--disable-gpu'],env,timeout:30000});
  application.on('window',window=>window.on('pageerror',e=>errors.push(e.message)));page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.tab.selected');assert.equal(await page.locator('#toast').textContent(),'','startup has no state-read errors');
  await application.evaluate(({session})=>session.fromPartition('persist:luma-web').protocol.handle('https',()=>new Response('<!doctype html><title>External menu fixture</title><p>Local replacement for an external destination.</p>',{headers:{'Content-Type':'text/html'}})));
  await command('update-settings',{theme:'dark'});await currentWeb();const original=(await state()).activeId;
  let menu=await open();const names=await menu.locator('.browser-menu-root .browser-menu-row').allTextContents();
  for(const name of ['新标签页','新窗口','新建无痕窗口','收藏夹','历史记录','标签页组','下载','扩展程序','密码','删除浏览数据','打印','翻译','分屏','截图','在页面上查找','更多工具','设置','帮助与反馈','关闭 luna'])assert.ok(names.some(value=>value.includes(name)),name+' appears');
  assert.equal(await menu.locator('.browser-menu-root .browser-menu-row:disabled').count(),0);
  assert.equal(await menu.locator('#browser-menu').evaluate(node=>Math.round(node.getBoundingClientRect().width)),340);
  await menu.locator('[data-browser-action="passwords"]').hover();await menu.screenshot({path:path.join(artifacts,'browser-menu-dark.png')});
  await menu.locator('#menu-zoom-in').click();await wait(async()=>(await state()).tabs.find(t=>t.id===original).zoom===110&&await menu.locator('#menu-zoom-reset').textContent()==='110%','menu zoom in');
  await menu.locator('#menu-zoom-out').click();await wait(async()=>await menu.locator('#menu-zoom-reset').textContent()==='100%','menu zoom out');await menu.locator('#menu-zoom-in').click();await menu.locator('#menu-zoom-reset').click();await wait(async()=>(await state()).tabs.find(t=>t.id===original).zoom===100,'zoom reset');assert.equal(menu.isClosed(),false);checks.push('reference grouping/icons/shortcuts and live zoom controls');
  await menu.locator('[data-menu-submenu="tools"]').click();await menu.waitForSelector('#browser-menu-submenu:not([hidden])');
  const submenuBox=await menu.locator('#browser-menu-submenu').boundingBox(),rootBox=await menu.locator('#browser-menu').boundingBox();assert.ok(submenuBox.x+submenuBox.width<rootBox.x,'submenu opens to the left');assert.ok(submenuBox.x>=0);await menu.screenshot({path:path.join(artifacts,'browser-menu-tools.png')});
  await menu.keyboard.press('Escape');assert.equal(await menu.locator('#browser-menu-submenu').isHidden(),true);assert.equal(menu.isClosed(),false);
  await menu.locator('[data-menu-submenu="extensions"]').focus();await menu.keyboard.press('ArrowRight');await menu.waitForSelector('[data-submenu-page="extensions"]:visible');await menu.keyboard.press('ArrowLeft');assert.equal(await menu.locator('#browser-menu-submenu').isHidden(),true);checks.push('left submenus, arrows, Escape and return to root');
  await menu.locator('[data-browser-action="passwords"]').click();await page.waitForSelector('[data-group="passwords"]:visible');assert.equal(await page.locator('.password-hero').count(),0);assert.equal(await page.locator('#password-list').textContent(),'暂无已保存的密码');assert.equal((await page.locator('body').textContent()).includes('你的账号，随时就绪'),false);assert.equal(await page.locator('#setting-savePasswords').evaluate(input=>getComputedStyle(input,'::after').backgroundColor!==getComputedStyle(input).backgroundColor),true,'checked switch knob remains visible');await page.screenshot({path:path.join(artifacts,'password-settings-plain.png')});checks.push('decorative copy removed; direct password management');
  await command('activate',original);await action('clear-data');await page.waitForSelector('#clear-data-dialog[open]');await page.locator('#clear-data-cancel').click();
  await action('find');await page.waitForSelector('#findbar:not([hidden])');await page.locator('#find-close').click();
  for(const kind of ['bookmarks','history','downloads']){await action(kind);const panel=await popupPage(application,kind);await panel.waitForSelector('#panel:not([hidden])');assert.equal((await state()).popover,kind);await panel.locator('#panel-close').click();}
  checks.push('data-clear/find and independent favorite/history/download panels');
  menu=await open();await menu.locator('[data-menu-submenu="help"]').click();await menu.locator('[data-browser-action="shortcuts"]').click();await page.waitForSelector('#help-dialog[open]');await page.locator('#help-done').click();
  menu=await open();await menu.locator('[data-menu-submenu="help"]').click();await menu.locator('[data-browser-action="about"]').click();await page.waitForSelector('[data-group="about"]:visible');
  menu=await open();assert.equal(await menu.locator('[data-browser-action="print"]').isDisabled(),true);await menu.locator('[data-menu-submenu="extensions"]').click();await menu.locator('[data-submenu-page="extensions"] [data-browser-action="extensions"]').click();await page.waitForSelector('#extensions-page:not([hidden])');checks.push('help/about/extensions and disabled webpage actions on internal pages');
  await command('activate',original);
  await application.evaluate(({webContents},id)=>{webContents.fromId(id).print=(options,callback)=>{globalThis.__menuPrint=options;callback(true,'');};},webId);await action('print');assert.equal(await application.evaluate(()=>globalThis.__menuPrint.printBackground),true);
  await action('screenshot');await closeTool();await tool('qr');await closeTool();await tool('reading-page');await closeTool();
  const savedFile=path.join(profile,'menu-page.mhtml');await application.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},savedFile);await tool('save-page');await wait(()=>fs.existsSync(savedFile),'save page');
  await action('translate-page');await wait(async()=>(await state()).tabs.some(tab=>tab.url.startsWith('https://translate.google.com/translate?')),'translate destination');await command('activate',original);
  await tool('source');await wait(async()=>(await state()).tabs.some(tab=>tab.url==='view-source:'+base+'/'),'source tab');await command('activate',original);await tool('devtools');await wait(async()=>application.evaluate(({webContents},id)=>webContents.fromId(id).isDevToolsOpened(),webId),'developer tools');await application.evaluate(({webContents},id)=>webContents.fromId(id).closeDevTools(),webId);checks.push('real print/screenshot/QR/reading/save/translate/source/devtools actions');
  menu=await open();await menu.locator('#menu-fullscreen').click();await wait(async()=>(await state()).fullscreen,'fullscreen');await shortcut('F11');await wait(async()=>!(await state()).fullscreen,'F11 exits fullscreen');
  await shortcut('O',['control','shift']);await wait(async()=>(await state()).popover==='bookmarks','favorites shortcut');await command('popover-close');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='luna').setContentSize(800,600));await new Promise(r=>setTimeout(r,200));menu=await open();assert.equal(await menu.locator('.browser-menu-scroll').evaluate(node=>node.scrollHeight>node.clientHeight),true);assert.equal(await menu.locator('[data-browser-action="close"]').isVisible(),true);await menu.screenshot({path:path.join(artifacts,'browser-menu-small-window.png')});
  await command('update-settings',{theme:'light'});await wait(async()=>await menu.locator('html').getAttribute('data-theme')==='light','light menu');await menu.screenshot({path:path.join(artifacts,'browser-menu-light.png')});await command('appearance-update',{section:'regions',key:'menu',values:{color:'#15333b'}});await wait(async()=>await menu.locator('#browser-menu').evaluate(node=>getComputedStyle(node).backgroundColor)==='rgb(21, 51, 59)','custom menu color');checks.push('fullscreen/shortcut, small-window scrolling, themes and custom menu colors');
  await assert.rejects(command('browser-menu-action','untrusted-action'));
  await menu.locator('[data-browser-action="close"]').click();await page.waitForSelector('#confirmation-dialog[open]');await page.locator('#confirmation-cancel').click();assert.ok((await state()).tabs.length>1);checks.push('action allowlist and close-browser confirmation');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(artifacts,'browser-menu-result.json'),JSON.stringify({passed:true,version:(await state()).version,checks,testedAt:new Date().toISOString()},null,2));console.log('PASS: '+checks.join('; '));await closeApp(application,page,false);application=null;
}
run().catch(async error=>{console.error(error);if(page&&!page.isClosed())await page.screenshot({path:path.join(artifacts,'browser-menu-failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(application)await closeApp(application,page,false).catch(()=>application.process().kill());await new Promise(r=>server.close(r));fs.rmSync(profile,{recursive:true,force:true});});
