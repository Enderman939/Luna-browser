const { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage } = require('electron');
const { scopedIPC } = require('./scoped-ipc');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const { SEARCH_ENGINES, isWebUrl } = require('./core');
const { highlightLink } = require('./context-menu-model');

const readability = fs.readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8');
function fileName(value, extension) { return String(value || '网页').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) + extension; }
class PageTools {
  constructor({ parent, settings, theme, createTab, notice, find, bookmark, reload, saveDownload }) {
    Object.assign(this, { parent, settings, theme, createTab, notice, find, bookmark, reload, saveDownload });
    this.windows = new Map();
    const ipcMain = scopedIPC(parent, event => this.windows.has(event.sender.id) && event.senderFrame === event.sender.mainFrame);
    parent.on('closed', () => { for (const tool of this.windows.values()) if (!tool.window.isDestroyed()) tool.window.destroy(); });
    const entry = event => {
      const value = this.windows.get(event.sender.id);
      if (!value || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted sender');
      return value;
    };
    ipcMain.handle('page-tool:data', event => entry(event).data);
    ipcMain.handle('page-tool:action', async (event, action, value) => {
      const tool = entry(event);
      try {
        if (action === 'close') tool.window.close();
        else if (action === 'copy-link') await clipboard.writeText(tool.data.url);
        else if (action === 'open-original') this.createTab(tool.data.url);
        else if (action === 'copy-image' && tool.data.image) await clipboard.write([new ClipboardItem({ 'image/png': new Blob([nativeImage.createFromDataURL(tool.data.image).toPNG()], { type: 'image/png' }) })]);
        else if (action === 'save-image' && tool.data.image) {
          const selected = await dialog.showSaveDialog(tool.window, { title: '保存图片', defaultPath: path.join(this.settings().downloadPath || app.getPath('downloads'), fileName(tool.data.title, '.png')), filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
          if (selected.canceled || !selected.filePath) return { cancelled: true };
          await fs.promises.writeFile(selected.filePath, nativeImage.createFromDataURL(tool.data.image).toPNG());
          this.notice('已保存：' + path.basename(selected.filePath));
        } else if (action === 'print' && tool.data.kind === 'reading') this.print(tool.window.webContents);
        else throw new Error('不支持此操作');
        return { ok: true };
      } catch (error) { return { error: error.message }; }
    });
  }
  async show(data) {
    const window = new BrowserWindow({ parent: this.parent, width: data.kind === 'reading' ? 850 : 600, height: data.kind === 'reading' ? 780 : 690,
      minWidth: 380, minHeight: 400, show: false, title: 'luna · ' + data.title, backgroundColor: this.theme() ? '#242424' : '#ffffff',
      icon: path.join(__dirname, 'ui', 'assets', 'app.png'),
      webPreferences: { preload: path.join(__dirname, 'page-tool-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.windows.set(window.webContents.id, { window, data: { ...data, dark: this.theme(), appearance: this.settings().appearance } });
    const id = window.webContents.id;
    window.on('closed', () => this.windows.delete(id));
    window.webContents.on('will-navigate', event => event.preventDefault()); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await window.loadFile(path.join(__dirname, 'ui', 'page-tool.html'));
    if (!window.isDestroyed()) window.show();
  }
  print(web, selectionOnly = false) {
    web.print({ printBackground: true, ...(selectionOnly ? { selectionOnly: true } : {}) }, (success, reason) => { if (!success && reason && !/cancel/i.test(reason)) this.notice('打印未完成：' + reason); });
  }
  updateAppearance(appearance, dark) {
    for (const tool of this.windows.values()) {
      Object.assign(tool.data, { appearance, dark });
      if (!tool.window.isDestroyed()) tool.window.webContents.send('page-tool:appearance', { appearance, dark });
    }
  }
  async savePage(tab) {
    const selected = await dialog.showSaveDialog(this.parent, { title: '网页另存为', defaultPath: path.join(this.settings().downloadPath || app.getPath('downloads'), fileName(tab.title, '.mhtml')),
      filters: [{ name: '单文件网页', extensions: ['mhtml'] }, { name: '完整网页', extensions: ['html', 'htm'] }] });
    if (selected.canceled || !selected.filePath || tab.view.webContents.isDestroyed()) return;
    await tab.view.webContents.savePage(selected.filePath, /\.mhtml?$/i.test(selected.filePath) ? 'MHTML' : 'HTMLComplete');
    this.notice('网页已保存：' + path.basename(selected.filePath));
  }
  async screenshot(tab, full = false) {
    const web = tab.view.webContents;
    let image;
    if (!full) image = (await web.capturePage()).toDataURL();
    else {
      const alreadyAttached = web.debugger.isAttached();
      if (!alreadyAttached) web.debugger.attach('1.3');
      try {
        const metrics = await web.debugger.sendCommand('Page.getLayoutMetrics');
        const { width, height } = metrics.cssContentSize || metrics.contentSize;
        if (width > 32767 || height > 32767 || width * height > 80000000) throw new Error('页面过大，请使用可见区域截图');
        const result = await web.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
        image = 'data:image/png;base64,' + result.data;
      } finally { if (!alreadyAttached && web.debugger.isAttached()) web.debugger.detach(); }
    }
    await this.show({ kind: 'screenshot', title: full ? '整页截图' : '网页截图', pageTitle: tab.title, url: tab.url, image });
  }
  async reading(tab, params, selected = false) {
    if (selected) return this.show({ kind: 'reading', title: '阅读模式', heading: tab.title, url: params.frameURL || tab.url,
      blocks: params.selectionText.trim().split(/\n+/).map(text => ({ tag: 'p', text })) });
    const frame = params.frame || tab.view.webContents.mainFrame;
    const content = await frame.executeJavaScript(`(() => {
      ${readability}
      const result = new Readability(document.cloneNode(true)).parse();
      if (!result || !result.textContent.trim()) return null;
      const doc = new DOMParser().parseFromString(result.content, 'text/html');
      const blocks = [...doc.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre')].filter(node => !node.parentElement?.closest('p,li,blockquote,pre'))
        .map(node => ({tag:node.tagName.toLowerCase(),text:node.textContent.trim()})).filter(block => block.text);
      return {heading:result.title,byline:result.byline,blocks:blocks.length ? blocks : [{tag:'p',text:result.textContent}]};
    })()`);
    if (!content) throw new Error('此页面没有可提取的正文，可以选中文字后打开阅读模式');
    await this.show({ ...content, kind: 'reading', title: '阅读模式', url: params.frameURL || tab.url });
  }
  async run(tab, action, params = {}) {
    const web = tab.view.webContents;
    if (web.isDestroyed()) return;
    switch (action) {
      case 'back': if (web.navigationHistory.canGoBack()) web.navigationHistory.goBack(); return;
      case 'forward': if (web.navigationHistory.canGoForward()) web.navigationHistory.goForward(); return;
      case 'reload': this.reload(tab); return;
      case 'undo': web.undo(); return;
      case 'redo': web.redo(); return;
      case 'cut': web.cut(); return;
      case 'copy': web.copy(); return;
      case 'paste': web.paste(); return;
      case 'paste-plain': web.pasteAndMatchStyle(); return;
      case 'select-all': web.selectAll(); return;
      case 'copy-link': await clipboard.writeText(params.linkURL); return;
      case 'copy-image-link': case 'copy-media-link': await clipboard.writeText(params.srcURL); return;
      case 'copy-page-link': await clipboard.writeText(tab.url); return;
      case 'highlight-link': await clipboard.writeText(highlightLink(params.frameURL || tab.url, params.selectionText)); this.notice('高亮链接已复制'); return;
      case 'open-link': this.createTab(params.linkURL); return;
      case 'open-link-background': this.createTab(params.linkURL, false); return;
      case 'open-image': case 'open-media': this.createTab(params.srcURL); return;
      case 'save-link': await this.saveDownload(tab, params.linkURL, params.suggestedFilename); return;
      case 'save-image': case 'save-media': {
        if (isWebUrl(params.srcURL) || /^(blob:|data:image\/)/i.test(params.srcURL || '')) await this.saveDownload(tab, params.srcURL, /^data:image\//i.test(params.srcURL || '') ? '图片.png' : undefined);
        else if (params.hasImageContents) {
          web.copyImageAt(params.x, params.y);
          const item = (await clipboard.read()).find(item => item.types.includes('image/png'));
          if (!item) throw new Error('无法读取此图片');
          const image = nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer()));
          if (image.isEmpty()) throw new Error('无法读取此图片');
          await this.show({ kind: 'screenshot', title: '保存图片', url: tab.url, image: image.toDataURL() });
        } else throw new Error('此媒体地址无法下载');
        return;
      }
      case 'copy-image': web.copyImageAt(params.x, params.y); return;
      case 'search-selection': this.createTab((SEARCH_ENGINES[this.settings().searchEngine] || SEARCH_ENGINES.baidu).prefix + encodeURIComponent(params.selectionText.trim())); return;
      case 'translate-selection':
        if (params.selectionText.length > 5000) throw new Error('请选择不超过 5000 字的文字进行翻译');
        this.createTab('https://translate.google.com/?sl=auto&tl=zh-CN&text=' + encodeURIComponent(params.selectionText) + '&op=translate'); return;
      case 'translate-page': this.createTab('https://translate.google.com/translate?sl=auto&tl=zh-CN&u=' + encodeURIComponent(tab.url)); return;
      case 'qr': await this.show({ kind: 'qr', title: '页面二维码', pageTitle: tab.title, url: tab.url, image: await QRCode.toDataURL(tab.url, { width: 320, margin: 3, errorCorrectionLevel: 'M' }) }); return;
      case 'reading-page': await this.reading(tab, params); return;
      case 'reading-selection': await this.reading(tab, params, true); return;
      case 'save-page': await this.savePage(tab); return;
      case 'print': this.print(web, !!params.selectionText?.trim()); return;
      case 'screenshot': await this.screenshot(tab); return;
      case 'screenshot-full': await this.screenshot(tab, true); return;
      case 'source': if (isWebUrl(tab.url)) this.createTab('view-source:' + tab.url); return;
      case 'inspect': web.inspectElement(params.x || 0, params.y || 0); return;
      case 'find': this.find(); return;
      case 'bookmark': this.bookmark(tab); return;
      default: throw new Error('未知的网页操作');
    }
  }
}
module.exports = { PageTools };
