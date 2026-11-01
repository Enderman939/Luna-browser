const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
// Application archives are ordinary files while installing or rolling back.
const fs = require('original-fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');

const version = app.getVersion();
app.setName('Luna Browser Setup');
app.setPath('userData', process.env.LUNA_USER_DATA || path.join(app.getPath('appData'), 'Luna Browser Setup'));
if (process.platform === 'win32') app.setAppUserModelId('luna.browser.setup');
const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('appData'), '..', 'Local');
const defaultInstallPath = path.join(localAppData, 'Programs', 'Luna Browser');
let windowRef = null;
let lastInstallPath = defaultInstallPath;
const silent = process.argv.some(value => value.toLowerCase() === '--silent');
let installing = false;
const manifestName = '.luna-install-files';
const uninstallKey = process.env.LUNA_INSTALLER_TEST === '1'
  ? (/^Luna Browser Test [a-z0-9-]+$/i.test(process.env.LUNA_INSTALLER_TEST_REGISTRY || '') ? 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + process.env.LUNA_INSTALLER_TEST_REGISTRY : null)
  : 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Luna Browser';
if (!app.requestSingleInstanceLock()) app.exit(1);
app.on('before-quit', event => { if (installing) event.preventDefault(); });

function sendProgress(event, text) { if (event?.sender && !event.sender.isDestroyed()) event.sender.send('installer:progress', text); }
function resource(name) { return path.join(process.resourcesPath, name); }
async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function writeUninstallCommand(target) {
  if (!uninstallKey) return;
  const uninstall = path.join(target, 'Luna-Uninstall.exe');
  const command = '"' + uninstall + '"';
  const result = spawnSync('reg.exe', ['ADD', uninstallKey, '/v', 'QuietUninstallString', '/t', 'REG_SZ', '/d', command + ' --silent', '/f'], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('无法写入 Windows 静默卸载信息。');
}
function createShortcut(file, target, workingDirectory) {
  if (!shell.writeShortcutLink(file, 'create', { target, cwd: workingDirectory, description: 'Luna Browser', appUserModelId: 'luna.browser', icon: path.join(workingDirectory, 'resources', 'app.ico'), iconIndex: 0 })) throw new Error('无法创建 Luna 快捷方式。');
}
function registryAdd(name, value) {
  const result = spawnSync('reg.exe', ['ADD', uninstallKey, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('无法写入 Windows 卸载信息。');
}
function installShortcuts(target, options) {
  const exe = path.join(target, 'luna.exe');
  const desktopPath = process.env.LUNA_INSTALLER_TEST === '1' ? process.env.LUNA_INSTALLER_TEST_DESKTOP : app.getPath('desktop');
  const startMenuPath = process.env.LUNA_INSTALLER_TEST === '1' ? process.env.LUNA_INSTALLER_TEST_STARTMENU : path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  if (options.desktop && desktopPath) { fs.mkdirSync(desktopPath, { recursive: true }); createShortcut(path.join(desktopPath, 'Luna Browser.lnk'), exe, target); }
  if (options.startMenu && startMenuPath) {
    const menu = path.join(startMenuPath, 'Luna Browser');
    fs.mkdirSync(menu, { recursive: true }); createShortcut(path.join(menu, 'Luna Browser.lnk'), exe, target);
  }
}
async function installPayload(target, options, event) {
  if (!target || !path.isAbsolute(target)) throw new Error('安装位置无效。');
  target = path.resolve(target);
  if (target === path.parse(target).root || target.includes('"') || target.startsWith('\\\\')) throw new Error('请选择本机磁盘上的专用安装文件夹。');
  let oldFiles = null;
  if (fs.existsSync(target)) {
    if ((await fsp.lstat(target)).isSymbolicLink()) throw new Error('安装位置不能是目录链接。');
    const entries = await fsp.readdir(target);
    if (entries.length) {
      try { oldFiles = new Set((await fsp.readFile(path.join(target, manifestName), 'utf8')).split(/\r?\n/).filter(Boolean)); }
      catch { throw new Error('该文件夹包含其他文件，请选择空文件夹或已有 Luna 安装目录。'); }
      if (!oldFiles.has('luna.exe') || !oldFiles.has('Luna-Uninstall.exe')) throw new Error('已有安装记录无效，请选择空文件夹。');
      const processes = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process -Name luna -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }'], { windowsHide: true, encoding: 'utf8' });
      if (processes.error) throw processes.error;
      if ((processes.stdout || '').split(/\r?\n/).some(file => file.trim().toLowerCase() === path.join(target, 'luna.exe').toLowerCase())) throw new Error('请先关闭此目录中的 Luna Browser，再重新安装。');
    }
  }
  const payload = resource('payload.zip'), uninstaller = resource('Luna-Uninstall.exe');
  const expectedHashFile = resource('payload.sha256');
  if (!fs.existsSync(payload) || !fs.existsSync(uninstaller) || !fs.existsSync(expectedHashFile)) throw new Error('安装包数据不完整，请重新下载 Luna Setup。');
  const expectedHash = (await fsp.readFile(expectedHashFile, 'utf8')).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || await sha256File(payload) !== expectedHash) throw new Error('浏览器安装数据校验失败，请重新下载 Luna Setup。');
  sendProgress(event, 'Preparing Luna…');
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temp = await fsp.mkdtemp(path.join(path.dirname(target), '.luna-installer-')), stage = path.join(temp, 'stage'), backup = target + '.luna-backup-' + token;
  let movedTarget = false, activated = false, registrationChanged = false, registryExisted = false;
  const shortcutBackups = new Map(), registryBackup = path.join(temp, 'uninstall.reg');
  await fsp.mkdir(stage, { recursive: true });
  try {
    sendProgress(event, 'Unpacking Luna…');
    const extractor = spawn('tar.exe', ['-xf', payload, '-C', stage], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    await new Promise((resolve, reject) => {
      let stderr = ''; extractor.stderr.setEncoding('utf8'); extractor.stderr.on('data', data => { stderr = (stderr + data).slice(-8192); });
      extractor.once('error', reject); extractor.once('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || '无法展开 Luna 安装数据。')));
    });
    const extracted = path.join(stage, 'luna-win32-x64'); if (!fs.existsSync(path.join(extracted, 'luna.exe'))) throw new Error('安装数据缺少 Luna 浏览器文件。');
    await fsp.copyFile(uninstaller, path.join(extracted, 'Luna-Uninstall.exe'));
    async function filesUnder(directory, prefix = '') {
      const files = [];
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name;
        if (entry.isSymbolicLink()) throw new Error('安装目录包含文件链接，请先移除链接。');
        if (entry.isDirectory()) files.push(...await filesUnder(path.join(directory, entry.name), relative + '/'));
        else files.push(relative);
      }
      return files;
    }
    const installedFiles = await filesUnder(extracted);
    await fsp.writeFile(path.join(extracted, manifestName), installedFiles.join('\n') + '\n', 'utf8');
    if (oldFiles) {
      const owned = new Set(installedFiles.map(file => file.toLowerCase()));
      const previous = new Set([...oldFiles, manifestName].map(file => file.toLowerCase()));
      for (const file of await filesUnder(target)) {
        if (previous.has(file.toLowerCase())) continue;
        if (owned.has(file.toLowerCase())) throw new Error('新版本文件与安装目录中的个人文件重名，请先移动该文件：' + file);
        await fsp.mkdir(path.dirname(path.join(extracted, file)), { recursive: true });
        await fsp.copyFile(path.join(target, file), path.join(extracted, file), fs.constants.COPYFILE_EXCL);
      }
    }
    const desktopPath = process.env.LUNA_INSTALLER_TEST === '1' ? process.env.LUNA_INSTALLER_TEST_DESKTOP : app.getPath('desktop');
    const menuPath = process.env.LUNA_INSTALLER_TEST === '1' ? process.env.LUNA_INSTALLER_TEST_STARTMENU : path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    for (const file of [options.desktop && desktopPath && path.join(desktopPath, 'Luna Browser.lnk'), options.startMenu && menuPath && path.join(menuPath, 'Luna Browser', 'Luna Browser.lnk')].filter(Boolean)) shortcutBackups.set(file, fs.existsSync(file) ? await fsp.readFile(file) : null);
    if (uninstallKey) {
      registryExisted = spawnSync('reg.exe', ['QUERY', uninstallKey], { windowsHide: true }).status === 0;
      if (registryExisted && spawnSync('reg.exe', ['EXPORT', uninstallKey, registryBackup, '/y'], { windowsHide: true }).status !== 0) throw new Error('无法备份已有卸载信息。');
    }
    if (fs.existsSync(target)) { sendProgress(event, 'Updating existing Luna…'); await fsp.rename(target, backup); movedTarget = true; }
    await fsp.rename(extracted, target); activated = true;
    installShortcuts(target, options);
    if (uninstallKey) { registrationChanged = true; registryAdd('DisplayName', 'Luna Browser'); registryAdd('DisplayVersion', version); registryAdd('Publisher', 'Enderman939'); registryAdd('InstallLocation', target); registryAdd('DisplayIcon', path.join(target, 'luna.exe')); registryAdd('UninstallString', '"' + path.join(target, 'Luna-Uninstall.exe') + '"'); writeUninstallCommand(target); }
    if (movedTarget) await fsp.rm(backup, { recursive: true, force: true }).catch(() => {});
    lastInstallPath = target; sendProgress(event, 'Luna is ready.');
  } catch (error) {
    for (const [file, contents] of shortcutBackups) {
      try {
        if (contents) await fsp.writeFile(file, contents);
        else await fsp.rm(file, { force: true });
      } catch {}
    }
    if (registrationChanged) {
      spawnSync('reg.exe', ['DELETE', uninstallKey, '/f'], { windowsHide: true });
      if (registryExisted) spawnSync('reg.exe', ['IMPORT', registryBackup], { windowsHide: true });
    }
    if (activated) await fsp.rm(target, { recursive: true, force: true });
    if (movedTarget) await fsp.rename(backup, target);
    throw error;
  } finally { await fsp.rm(temp, { recursive: true, force: true }).catch(() => {}); }
}
async function launchInstalled() {
  if (installing) throw new Error('请等待安装完成。');
  const exe = path.join(lastInstallPath, 'luna.exe');
  if (!fs.existsSync(exe)) throw new Error('找不到已安装的 Luna。');
  const child = spawn(exe, [], { cwd: lastInstallPath, detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref(); app.quit();
}
async function install(target, options, event) {
  if (installing) throw new Error('安装正在进行，请稍候。');
  installing = true;
  try { await installPayload(target, options, event); }
  finally { installing = false; }
}

ipcMain.on('installer:version', event => { event.returnValue = version; });
ipcMain.on('installer:default-path', event => { event.returnValue = defaultInstallPath; });
ipcMain.on('installer:ui-ready', event => { if (windowRef && event.sender === windowRef.webContents && !windowRef.isDestroyed()) windowRef.show(); });
ipcMain.handle('installer:choose-folder', async (_, current) => { const result = await dialog.showOpenDialog(windowRef, { title: '选择 Luna 的安装位置', defaultPath: current || defaultInstallPath, properties: ['openDirectory', 'createDirectory'] }); return result.canceled || !result.filePaths[0] ? null : path.join(result.filePaths[0], 'Luna Browser'); });
ipcMain.handle('installer:install', async (event, options) => { await install(options.installPath, options, event); if (options.launch) setTimeout(() => launchInstalled().catch(error => dialog.showErrorBox('Luna Browser', error.message)), 350); return true; });
ipcMain.handle('installer:close', () => { if (!installing) app.quit(); });
ipcMain.handle('installer:launch', () => launchInstalled());

async function start() {
  if (silent) {
    try {
      const index = process.argv.findIndex(value => value.toLowerCase() === '--install-dir');
      await install(index >= 0 ? process.argv[index + 1] : defaultInstallPath, { desktop: false, startMenu: false, launch: false }, null); app.exit(0);
    } catch (error) { console.error(error.message); app.exit(1); }
    return;
  }
  windowRef = new BrowserWindow({ width: 860, height: 558, minWidth: 860, minHeight: 558, maxWidth: 860, maxHeight: 558, frame: false, resizable: false, transparent: false, backgroundColor: '#16161b', title: 'Luna Browser Setup', show: false, icon: path.join(__dirname, 'app.ico'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (process.platform === 'win32') {
    const icon = require('electron').nativeImage.createFromPath(path.join(__dirname, 'app.ico'));
    if (!icon.isEmpty()) windowRef.setIcon(icon);
  }
  windowRef.on('close', event => { if (installing) event.preventDefault(); });
  windowRef.on('closed', () => { windowRef = null; }); await windowRef.loadFile(path.join(__dirname, 'ui', 'index.html'));
}
app.whenReady().then(start).catch(() => app.exit(1));
