(() => {
  const $ = selector => document.querySelector(selector), bridge = window.browser;
  let state, editingGroup = null, targetTab = null;
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  const windowShortcuts = node('div'); windowShortcuts.append(node('span','新窗口／无痕窗口'),node('kbd','Ctrl+N / Ctrl+Shift+N')); $('.shortcut-help').prepend(windowShortcuts);
  $('#private-protection-button').onclick = () => call('private-protection-toggle', !state.privateProtection?.enabled).catch(() => {});
  async function call(action, payload) { try { return await bridge.command(action, payload); } catch (error) { window.lunaNotify?.(error.message.replace(/^Error invoking remote method .*?:\s*(?:Error: )?/, '')); throw error; } }
  function show(dialog) { dialog.showModal(); window.browserDialogs.overlays(); }
  async function dismiss(dialog) { dialog.close(); await bridge.command('modal-state', false); await bridge.command('overlay', false); }
  for (const id of ['split','groups','tab-group']) {
    const dialog = $('#'+id+'-dialog'); dialog.addEventListener('close', () => window.browserDialogs.overlays());
    $('#'+(id === 'tab-group' ? 'tab-group-close' : id+'-dialog-close')).onclick = () => dialog.close();
  }
  $('#split-dialog-cancel').onclick = () => $('#split-dialog').close();
  function splitChoices() {
    const pages = state.tabs.filter(tab => /^https?:\/\//.test(tab.url));
    for (const side of ['left','right']) {
      const select = $('#split-'+side+'-choice'); select.replaceChildren();
      for (const tab of pages) { const option = node('option', tab.title || tab.url); option.value = tab.id; select.append(option); }
      const fresh = node('option', '输入新地址'); fresh.value = ''; select.append(fresh);
      select.value = String(side === 'left' ? pages.find(tab => tab.id === state.activeId)?.id || pages[0]?.id || '' : pages.find(tab => tab.id !== Number($('#split-left-choice').value))?.id || '');
      const url = $('#split-'+side+'-url'); url.value = ''; url.hidden = select.value !== '';
      select.onchange = () => { url.hidden = select.value !== ''; if (!url.hidden) url.focus(); };
    }
    $('#split-form-error').textContent = '';
  }
  $('#split-form').onsubmit = async event => {
    event.preventDefault(); const payload = { leftId: $('#split-left-choice').value, rightId: $('#split-right-choice').value, leftURL: $('#split-left-url').value, rightURL: $('#split-right-url').value };
    if ((!payload.leftId && !payload.leftURL.trim()) || (!payload.rightId && !payload.rightURL.trim())) { $('#split-form-error').textContent = '请选择网页或填写地址'; return; }
    if (payload.leftId && payload.leftId === payload.rightId) { $('#split-form-error').textContent = '请选择不同的标签页'; return; }
    await dismiss($('#split-dialog'));
    try { await call('split-start', payload); } catch { show($('#split-dialog')); }
  };
  $('#split-left').onclick = () => call('activate', state.split.leftId).catch(() => {});
  $('#split-right').onclick = () => call('activate', state.split.rightId).catch(() => {});
  $('#split-swap').onclick = () => call('split-swap').catch(() => {});
  $('#split-exit').onclick = () => call('split-exit').catch(() => {});
  const divider = $('#split-divider');
  let drag = false, scheduled = false, pendingRatio;
  function setRatio(ratio) {
    pendingRatio = Math.min(.75, Math.max(.25, ratio));
    const viewport = $('#viewport'); divider.style.left = Math.round((viewport.clientWidth - 10) * pendingRatio) + 'px'; divider.setAttribute('aria-valuenow', Math.round(pendingRatio * 100));
    if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; call('split-ratio', pendingRatio).catch(() => {}); }); }
  }
  divider.onpointerdown = event => { if (event.button !== 0) return; drag = true; divider.setPointerCapture(event.pointerId); divider.classList.add('dragging'); };
  divider.onpointermove = event => { if (drag) { const rect = $('#viewport').getBoundingClientRect(); setRatio((event.clientX - rect.x - 5) / (rect.width - 10)); } };
  divider.onpointerup = divider.onlostpointercapture = () => { drag = false; divider.classList.remove('dragging'); };
  divider.ondblclick = () => setRatio(.5);
  divider.onkeydown = event => { if (!['ArrowLeft','ArrowRight','Home'].includes(event.key)) return; event.preventDefault(); setRatio(event.key === 'Home' ? .5 : state.split.ratio + (event.key === 'ArrowLeft' ? -.05 : .05)); };
  function editor(id, tabId) {
    editingGroup = id; const group = state.groups.find(group => group.id === id);
    $('#group-name').value = group?.name || '标签页组'; $('#group-color').value = group?.color || 'gray';
    $('#group-save').textContent = group ? '保存分组' : '创建分组'; $('#group-form-error').textContent = '';
    const list = $('#group-tabs'); list.replaceChildren();
    for (const tab of state.tabs) {
      const label = node('label', undefined, 'group-tab-choice'), input = node('input'); input.type = 'checkbox'; input.value = tab.id;
      input.checked = group ? tab.groupId === id : tab.id === (tabId || state.activeId);
      label.append(input, node('span', tab.title || tab.url)); list.append(label);
    }
  }
  function groupList() {
    const list = $('#group-list'); list.replaceChildren();
    if (!state.groups.length) { list.append(node('p','暂无标签页组','workspace-note')); return; }
    for (const group of state.groups) {
      const row = node('div', undefined, 'group-list-entry'); row.dataset.color = group.color;
      row.append(node('strong', group.name + ' · ' + state.tabs.filter(tab => tab.groupId === group.id).length));
      for (const [text, action] of [['编辑','edit'],[group.collapsed ? '展开' : '折叠','collapse'],['解除分组','ungroup'],['关闭组','close']]) {
        const button = node('button', text); button.dataset.groupAction = action; button.dataset.groupId = group.id;
        button.onclick = async () => { if (action === 'edit') { editor(group.id); return; } await dismiss($('#groups-dialog')); await call('group-action',{action,id:group.id}).catch(() => {}); };
        row.append(button);
      }
      list.append(row);
    }
  }
  $('#group-new').onclick = () => editor(null);
  $('#group-form').onsubmit = async event => {
    event.preventDefault(); const ids = [...$('#group-tabs').querySelectorAll('input:checked')].map(input => Number(input.value));
    if (!ids.length) { $('#group-form-error').textContent = '请选择至少一个标签页'; return; }
    const name = $('#group-name').value.trim(), color = $('#group-color').value, id = editingGroup;
    await dismiss($('#groups-dialog'));
    try {
      if (!id) await call('group-action',{action:'create',name,color,tabIds:ids});
      else {
        await call('group-action',{action:'update',id,name,color});
        for (const tabId of ids) await call('group-action',{action:'add',id,tabId});
        for (const tab of state.tabs.filter(tab => tab.groupId === id && !ids.includes(tab.id))) await call('group-action',{action:'remove',tabId:tab.id});
      }
    } catch {}
  };
  function groupsDialog(id, tabId) { groupList(); editor(id,tabId); show($('#groups-dialog')); }
  function tabDialog(tabId) {
    targetTab = tabId; const list = $('#tab-group-choices'); list.replaceChildren();
    const tab = state.tabs.find(tab => tab.id === tabId); if (!tab) return;
    $('#tab-group-title').textContent = tab.title || '标签页分组';
    function choice(text, action) { const button = node('button',text); button.onclick = async () => { await dismiss($('#tab-group-dialog')); await action(); }; list.append(button); }
    const operation = (text, action, extra) => choice(text, () => call('tab-action', { id: tabId, action, ...extra }));
    operation(tab.pinned ? '取消固定标签页' : '固定标签页', 'pin');
    if (!tab.compatibility?.enabled) operation(tab.muted ? '取消静音' : '静音标签页', 'mute');
    operation('复制标签页', 'duplicate'); operation('关闭其他未固定标签', 'close-others'); operation('关闭右侧未固定标签', 'close-right');
    operation('移动到新窗口', 'move');
    for (const target of state.windowTargets || []) operation('移动到窗口：' + target.title, 'move', { windowId: target.id });
    if (!tab.pinned) choice('添加到新组', async () => groupsDialog(null,targetTab));
    if (!tab.pinned) for (const group of state.groups) choice('添加到「'+group.name+'」', () => call('group-action',{action:'add',id:group.id,tabId}));
    if (tab.groupId) choice('移出当前组', () => call('group-action',{action:'remove',tabId}));
    show($('#tab-group-dialog'));
  }
  window.workspaceUI = {
    showSplit: () => { splitChoices(); show($('#split-dialog')); }, showGroups: () => groupsDialog(null), editGroup: id => groupsDialog(id), tabDialog,
    update(next) {
      state = next; if (window.popoverHost) return;
      document.title = state.private ? 'luna · 无痕' : 'luna'; document.body.dataset.private = String(state.private);
      $('#private-badge').hidden = $('#private-note').hidden = !state.private;
      const legacy = state.tabs.find(tab=>tab.id===state.activeId)?.compatibility?.enabled;
      $('#passwords-button').hidden = state.private || legacy;
      for (const selector of ['#extensions-button','#extension-actions']) $(selector).hidden = legacy;
      const protection = state.privateProtection, page = state.tabs.find(tab => tab.id === state.activeId);
      $('#private-protection-button').hidden = !state.private;
      $('#private-protection-button').disabled = !/^https?:/.test(page?.url || '');
      $('#private-protection-button').setAttribute('aria-pressed', String(protection?.enabled !== false));
      $('#private-protection-label').textContent = protection?.enabled === false ? '保护已暂停' : '已拦截 ' + (protection?.blocked || 0);
      $('#private-protection-button').title = '已知广告和追踪域名拦截' + (protection?.thirdPartyCookies ? ' · 第三方 Cookie 限制' : '') + '；点击' + (protection?.enabled === false ? '恢复' : '暂停') + '当前标签的拦截并刷新';
      if (state.private) $('#private-note').textContent = '无痕保护：自动拦截已知广告和追踪域名，发送隐私偏好并限制 WebRTC 地址暴露。关闭全部无痕窗口后清除网站数据。' + (protection?.extensionStorage ? '已授权扩展使用独立临时目录，关闭后清理；异常退出的残留在下次启动时补清。' : '网站会话使用内存存储，扩展默认不运行。') + '下载文件和主动收藏会保留；无痕不会隐藏网络地址。';
      $('[data-settings-section="passwords"]').disabled = state.private;
      $('#split-toolbar').hidden = divider.hidden = !state.split;
      for (const side of ['left','right']) {
        const tab = state.tabs.find(tab => tab.id === state.split?.[side+'Id']), button = $('#split-'+side), error = $('#split-'+side+'-error');
        error.hidden = !tab?.error;
        if (tab) { button.textContent = (side === 'left' ? '左侧 · ' : '右侧 · ') + tab.title; button.classList.toggle('active',state.activeId === tab.id); button.setAttribute('aria-pressed',String(state.activeId === tab.id)); }
        if (tab?.error) { error.querySelector('p').textContent = '无法打开 '+tab.url; error.querySelector('button').onclick = async () => { await call('activate',tab.id); await call('reload'); }; }
      }
      if (state.split && !drag) { const x = Math.round(($('#viewport').clientWidth - 10) * state.split.ratio); divider.style.left = x+'px'; divider.setAttribute('aria-valuenow',Math.round(state.split.ratio*100)); $('#split-left-error').style.cssText = 'left:0;width:'+x+'px'; $('#split-right-error').style.cssText = 'left:'+(x+10)+'px;right:0'; }
    }
  };
})();
