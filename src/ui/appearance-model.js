(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.lunaAppearanceModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const REGIONS = {
    chrome: { name: '工具栏与收藏栏', detail: '浏览器 UI 背景、导航按钮和地址栏周围', image: true },
    titlebar: { name: '标签栏', detail: '窗口顶部、标签页和窗口控制区', image: true },
    home: { name: '新标签页', detail: '搜索框和网站入口后面的背景', image: true },
    settings: { name: '设置与扩展页', detail: '设置内容区和扩展管理页的背景', image: true },
    sidebar: { name: '设置侧栏', detail: '外观、下载、隐私等分类所在的侧栏', image: true },
    surface: { name: '卡片与输入框', detail: '设置卡片、地址框和新标签页搜索框', image: false },
    menu: { name: '菜单与弹窗', detail: '主菜单、右键菜单、资料面板和确认弹窗', image: false },
    tools: { name: '页面工具', detail: '阅读模式、截图预览和页面二维码', image: true },
  };
  const ICONS = {
    brand: '浏览器标识', plus: '新建', left: '后退', right: '前进', reload: '刷新', home: '主页', star: '收藏',
    download: '下载', history: '历史', puzzle: '扩展', menu: '主菜单', settings: '设置', search: '搜索',
    close: '关闭', globe: '网站', lock: '连接安全', sidebar: '收藏面板', folder: '文件夹', pin: '固定', unpin: '取消固定',
    more: '更多', shield: '隐私', palette: '外观', power: '启动', info: '关于', file: '文件', moon: '新标签页标识',
    pencil: '编辑', arrow: '打开', up: '向上', down: '向下', square: '最大化', minus: '最小化', grid: '网站网格', leaf: '叶片', key: '密码管理器',
    newtab: '菜单新标签页', private: '无痕窗口', zoom: '缩放', fullscreen: '全屏', groups: '标签页组', trash: '删除', print: '打印', translate: '翻译', split: '分屏', camera: '截图', reading: '阅读模式', code: '源码', tools: '工具', keyboard: '键盘',
  };
  const EMPTY_REGION = Object.freeze({ color: '', image: '', imageName: '', imageOpacity: 60 });
  const DEFAULT_APPEARANCE = Object.freeze({
    regions: Object.freeze(Object.fromEntries(Object.keys(REGIONS).map(key => [key, EMPTY_REGION]))),
    icons: Object.freeze({ color: '', size: 18, weight: 1.6, shape: 'round', custom: Object.freeze({}) }),
  });
  const isColor = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
  const isAsset = value => typeof value === 'string' && /^[a-f\d]{64}\.png$/.test(value);
  const assetURL = value => isAsset(value) ? 'luna-asset://image/' + value : '';
  function sanitizeAppearance(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const regions = {};
    for (const [key, spec] of Object.entries(REGIONS)) {
      const input = value.regions && Object.hasOwn(value.regions, key) ? value.regions[key] || {} : {};
      regions[key] = {
        color: isColor(input.color) ? input.color.toLowerCase() : '',
        image: spec.image && isAsset(input.image) ? input.image : '',
        imageName: spec.image && isAsset(input.image) && typeof input.imageName === 'string' ? input.imageName.slice(0, 160) : '',
        imageOpacity: Number.isFinite(input.imageOpacity) ? Math.max(10, Math.min(100, Math.round(input.imageOpacity))) : 60,
      };
    }
    const input = value.icons || {}, custom = {};
    for (const key of Object.keys(ICONS)) if (input.custom && Object.hasOwn(input.custom, key) && isAsset(input.custom[key])) custom[key] = input.custom[key];
    return { regions, icons: {
      color: isColor(input.color) ? input.color.toLowerCase() : '', size: [16, 18, 20, 22, 24].includes(input.size) ? input.size : 18,
      weight: [1.2, 1.6, 2, 2.4].includes(input.weight) ? input.weight : 1.6, shape: ['round', 'square'].includes(input.shape) ? input.shape : 'round', custom,
    } };
  }
  function patchAppearance(current, { section, key, values } = {}) {
    const result = sanitizeAppearance(current);
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('外观设置无效');
    if (section === 'regions' && Object.hasOwn(REGIONS, key)) result.regions[key] = { ...result.regions[key], ...values };
    else if (section === 'icons') result.icons = { ...result.icons, ...values, custom: result.icons.custom };
    else throw new Error('未知的外观区域');
    return sanitizeAppearance(result);
  }
  const palettes = {
    light: { bg: '#ffffff', surface: '#ffffff', chrome: '#f9f9f9', titlebar: '#ececec', soft: '#f1f1f1', hover: '#e7e7e7', ink: '#191919', muted: '#777777', line: '#e6e6e6', accent: '#111111', onAccent: '#ffffff' },
    dark: { bg: '#292929', surface: '#333333', chrome: '#242424', titlebar: '#191919', soft: '#3c3c3c', hover: '#464646', ink: '#f1f1f1', muted: '#aaaaaa', line: '#454545', accent: '#080808', onAccent: '#ffffff' },
  };
  const rgb = color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  function luminance(color) { return rgb(color).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0); }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function foreground(color) {
    const soft = contrast(color, '#191919') >= contrast(color, '#f1f1f1') ? '#191919' : '#f1f1f1';
    if (contrast(color, soft) >= 4.5) return soft;
    return contrast(color, '#000000') >= contrast(color, '#ffffff') ? '#000000' : '#ffffff';
  }
  function mix(a, b, amount) { const first = rgb(a), second = rgb(b); return '#' + first.map((value, index) => Math.round(value * (1 - amount) + second[index] * amount).toString(16).padStart(2, '0')).join(''); }
  function appearanceTokens(value, dark) {
    const appearance = sanitizeAppearance(value), base = palettes[dark ? 'dark' : 'light'], vars = {}, regions = {};
    for (const key of Object.keys(REGIONS)) {
      const entry = appearance.regions[key], fallback = key === 'chrome' || key === 'titlebar' ? base[key] : key === 'surface' || key === 'menu' ? base.surface : key === 'tools' ? dark ? '#242424' : '#ffffff' : base.bg;
      const color = entry.color || fallback, ink = entry.color ? foreground(color) : base.ink;
      const custom = !!entry.color;
      const area = { bg: color, ink, muted: custom ? mix(ink, color, .25) : base.muted, line: custom ? mix(color, ink, .15) : base.line,
        soft: custom ? mix(color, ink, .055) : base.soft, hover: custom ? mix(color, ink, .11) : base.hover,
        image: entry.image ? 'linear-gradient(rgba(' + rgb(color).join(',') + ',' + (1 - entry.imageOpacity / 100 * .7) + '),rgba(' + rgb(color).join(',') + ',' + (1 - entry.imageOpacity / 100 * .7) + ')),url("' + assetURL(entry.image) + '")' : 'none' };
      regions[key] = area;
      for (const [name, color] of Object.entries(area)) vars['--' + key + '-' + name] = color;
    }
    Object.assign(vars, { '--bg': base.bg, '--surface': regions.surface.bg, '--chrome': regions.chrome.bg, '--titlebar': regions.titlebar.bg,
      '--ink': base.ink, '--muted': base.muted, '--line': base.line, '--soft': base.soft, '--hover': base.hover, '--accent': base.accent, '--on-accent': base.onAccent,
      '--icon-color': appearance.icons.color || 'currentColor', '--icon-size': appearance.icons.size + 'px', '--icon-weight': String(appearance.icons.weight),
      '--icon-cap': appearance.icons.shape === 'square' ? 'butt' : 'round', '--icon-join': appearance.icons.shape === 'square' ? 'miter' : 'round' });
    return { appearance, vars, regions };
  }
  return { REGIONS, ICONS, DEFAULT_APPEARANCE, sanitizeAppearance, patchAppearance, appearanceTokens, assetURL, isAsset, isColor, contrast };
});
