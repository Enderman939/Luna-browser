const { isWebUrl, SEARCH_ENGINES } = require('./core');

function highlightLink(url, text) {
  const target = new URL(url);
  const selection = String(text).trim().replace(/\s+/g, ' ');
  if (!selection) throw new Error('请先选择网页文字');
  const encode = value => encodeURIComponent(value).replace(/-/g, '%2D');
  const directive = selection.length > 1000 ? encode(selection.slice(0, 120)) + ',' + encode(selection.slice(-120)) : encode(selection);
  target.hash = target.hash.split(':~:')[0] + ':~:text=' + directive;
  return target.href;
}

function contextMenuItems(params, { canBack, canForward, pageURL, engine = 'baidu', extensions = [] }) {
  const items = [], selection = params.selectionText?.trim(), page = isWebUrl(pageURL);
  const item = (id, label, shortcut, enabled = true) => ({ id, label, shortcut, enabled });
  const section = list => { if (!list.length) return; if (items.length) items.push({ type: 'separator' }); items.push(...list); };
  if (params.isEditable) {
    const flags = params.editFlags || {};
    section([
      item('undo', '撤销', 'Ctrl+Z', !!flags.canUndo), item('redo', '重做', 'Ctrl+Shift+Z', !!flags.canRedo),
    ]);
    section([
      item('cut', '剪切', 'Ctrl+X', !!flags.canCut), item('copy', '复制', 'Ctrl+C', !!flags.canCopy),
      item('paste', '粘贴', 'Ctrl+V', !!flags.canPaste), item('paste-plain', '粘贴为纯文本', 'Ctrl+Shift+V', !!flags.canPaste),
      item('select-all', '全选', 'Ctrl+A', !!flags.canSelectAll),
    ]);
  } else if (selection) section([item('copy', '复制', 'Ctrl+C')]);
  if (selection && params.formControlType !== 'input-password') {
    const name = (SEARCH_ENGINES[engine] || SEARCH_ENGINES.baidu).name;
    const preview = selection.replace(/\s+/g, ' ').slice(0, 26) + (selection.length > 26 ? '…' : '');
    section([
      ...(!params.isEditable && page ? [item('highlight-link', '复制指向高亮文字的链接')] : []),
      { ...item('search-selection', `使用 ${name} 搜索“${preview}”`), symbol: 'search' },
      item('reading-selection', '在阅读模式中打开选中文字'), item('translate-selection', '将选中文字翻译成简体中文'),
    ]);
  }
  if (params.linkURL) section([
    ...(isWebUrl(params.linkURL) ? [item('open-link', '在新标签页打开链接'), item('open-link-background', '在后台标签页打开链接'), item('save-link', '链接另存为…')] : []),
    item('copy-link', '复制链接地址'),
  ]);
  if (['image', 'canvas'].includes(params.mediaType)) section([
    ...(isWebUrl(params.srcURL) ? [item('open-image', '在新标签页打开图片')] : []),
    item('save-image', '图片另存为…', undefined, !!params.srcURL || !!params.hasImageContents),
    item('copy-image', '复制图片', undefined, !!params.hasImageContents),
    ...(params.srcURL ? [item('copy-image-link', '复制图片地址')] : []),
  ]);
  if (['audio', 'video'].includes(params.mediaType) && params.srcURL) section([
    ...(isWebUrl(params.srcURL) ? [item('open-media', '在新标签页打开媒体')] : []),
    item('save-media', '媒体另存为…'), item('copy-media-link', '复制媒体地址'),
  ]);
  if (!selection && !params.isEditable && !params.linkURL && params.mediaType === 'none') section([
    item('back', '后退', 'Alt+←', canBack), item('forward', '前进', 'Alt+→', canForward), item('reload', '刷新', 'Ctrl+R'),
  ]);
  if (!params.isEditable) {
    section([...(selection ? [] : [item('save-page', '网页另存为…', 'Ctrl+S', page)]), item('print', '打印…', 'Ctrl+P')]);
    if (!selection) section([item('qr', '为此页面创建二维码', undefined, page), item('translate-page', '将此页面翻译成简体中文', undefined, page)]);
    section([item('screenshot', '截图…', 'Ctrl+Shift+S')]);
  }
  section(extensions);
  section([{
    id: 'more-tools', label: '更多工具', submenu: [
      item('reading-page', '阅读模式', undefined, page), item('find', '在网页中查找', 'Ctrl+F'),
      item('copy-page-link', '复制网页地址'), item('bookmark', '收藏此页面', 'Ctrl+D', page),
      item('screenshot-full', '整页截图…', undefined, page),
    ],
  }]);
  section([item('source', '查看网页源代码', 'Ctrl+U', page), item('inspect', '检查元素', 'Ctrl+Shift+I')]);
  return items;
}

module.exports = { contextMenuItems, highlightLink };
