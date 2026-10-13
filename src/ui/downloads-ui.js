(() => {
  const rows = new Map();
  const statuses = { waiting: '等待保存', checking: '正在检查服务器', connecting: '正在连接', progressing: '正在下载', paused: '已暂停', interrupted: '下载中断', merging: '正在合并文件', completed: '下载完成', cancelled: '已取消' };
  const duration = seconds => seconds == null ? '—' : seconds < 60 ? seconds + ' 秒' : seconds < 3600 ? Math.floor(seconds / 60) + ' 分 ' + seconds % 60 + ' 秒' : Math.floor(seconds / 3600) + ' 小时';
  window.downloadUI = {
    render(list, entries, tools) {
      const { el, setIcon, setImage, bytes, command } = tools;
      if (list.querySelector('.empty-state,.entry-open')) list.replaceChildren();
      const ids = new Set(entries.map(entry => entry.id));
      for (const [id, row] of rows) if (!ids.has(id)) { row.root.remove(); rows.delete(id); }
      for (const entry of entries) {
        let row = rows.get(entry.id);
        if (!row) {
          row = { root: el('article', 'list-entry download-entry'), parts: new Map(), buttons: {} }; row.root.dataset.id = entry.id; row.root.dataset.created = entry.createdAt;
          const top = el('div', 'download-top'); row.icon = el('span', 'entry-icon file-preview');
          const text = el('span', 'entry-text'); row.name = el('strong'); row.status = el('span'); text.append(row.name, row.status); top.append(row.icon, text); row.root.append(top);
          row.progress = el('progress', 'download-overall'); row.root.append(row.progress);
          row.error = el('p', 'download-error'); row.root.append(row.error);
          const actions = el('div', 'download-actions');
          for (const [action, title] of [['pause', '暂停'], ['resume', '继续'], ['cancel', '取消'], ['open', '打开文件'], ['reveal', '所在文件夹']]) {
            const button = el('button', '', title); button.dataset.action = action;
            button.onclick = () => command('download-action', { id: entry.id, action: button.dataset.action }); row.buttons[action] = button; actions.append(button);
          }
          row.details = el('details', 'download-details'); row.details.append(el('summary', '', '下载详情'));
          row.url = el('div', 'download-source'); row.details.append(row.url);
          const stats = el('dl', 'download-statistics'); row.stats = {};
          for (const [key, label] of [['status', '下载状态'], ['total', '文件大小'], ['received', '已经下载'], ['speed', '传输速度'], ['eta', '剩余时间'], ['resume', '断点续传'], ['mode', '连接方式']]) {
            const value = el('dd'); row.stats[key] = value; stats.append(el('dt', '', label), value);
          }
          row.details.append(stats);
          const controls = el('div', 'download-detail-controls');
          const speedLabel = el('label', '', '速度限制'); row.speed = el('input'); row.speed.type = 'number'; row.speed.min = '0'; row.speed.max = '1048576'; row.speed.placeholder = '不限'; row.speed.setAttribute('aria-label', '下载限速 KB/s');
          row.speed.onchange = () => command('download-action', { id: entry.id, action: 'speed-limit', value: Number(row.speed.value) || 0 });
          speedLabel.append(row.speed, el('span', '', 'KB/s')); controls.append(speedLabel); row.speedLabel = speedLabel;
          const completionLabel = el('label', '', '下载完成后'); row.completion = el('select'); row.completion.setAttribute('aria-label', '下载完成后操作');
          for (const [value, label] of [['none', '不执行操作'], ['open', '打开文件'], ['reveal', '显示所在文件夹']]) { const option = el('option', '', label); option.value = value; row.completion.append(option); }
          row.completion.onchange = () => command('download-action', { id: entry.id, action: 'completion', value: row.completion.value }); completionLabel.append(row.completion); controls.append(completionLabel);
          const options = el('details', 'download-options'); options.append(el('summary', '', '速度限制与完成后选项'), controls); row.details.append(options);
          row.band = el('div', 'thread-band'); row.details.append(el('div', 'thread-heading', '各线程的起始位置及下载进度'), row.band);
          row.table = el('table', 'thread-table');
          const thead = el('thead'), header = el('tr'); ['#', '范围', '已经下载', '状态'].forEach(label => header.append(el('th', '', label))); thead.append(header); row.body = el('tbody'); row.table.append(thead, row.body); row.details.append(row.table);
          row.root.append(actions, row.details); rows.set(entry.id, row);
        }
        if (row.root.parentElement !== list) list.insertBefore(row.root, [...list.children].find(child => Number(child.dataset.created) < entry.createdAt) || null);
        row.name.textContent = entry.name;
        const percent = entry.total ? (entry.received * 100 / entry.total).toFixed(1) : null;
        row.status.textContent = (statuses[entry.status] || entry.status) + ' · ' + bytes(entry.received) + (entry.total ? ' / ' + bytes(entry.total) + ' (' + percent + '%)' : '') + (entry.status === 'progressing' && entry.speed ? ' · ' + bytes(entry.speed) + '/s' : '');
        if (row.iconSource !== entry.icon) { setImage(row.icon, entry.icon, 'file'); row.iconSource = entry.icon; }
        row.progress.max = entry.total || 1;
        if (entry.total) row.progress.value = entry.received; else row.progress.removeAttribute('value');
        row.progress.hidden = ['completed', 'cancelled'].includes(entry.status);
        row.error.textContent = entry.error || ''; row.error.hidden = !entry.error;
        row.buttons.pause.hidden = !['checking', 'progressing'].includes(entry.status);
        row.buttons.resume.hidden = !['paused', 'interrupted'].includes(entry.status);
        row.buttons.resume.textContent = entry.status === 'interrupted' ? '重试' : entry.resumable ? '继续' : '重新开始';
        row.buttons.resume.dataset.action = !entry.managed && entry.status === 'interrupted' ? 'retry' : 'resume';
        row.buttons.cancel.hidden = ['completed', 'cancelled', 'merging'].includes(entry.status);
        row.buttons.open.hidden = row.buttons.reveal.hidden = entry.status !== 'completed';
        row.url.textContent = entry.url; row.url.title = entry.url;
        row.stats.status.textContent = statuses[entry.status] || entry.status;
        row.stats.total.textContent = entry.total ? bytes(entry.total) : '未知';
        row.stats.received.textContent = bytes(entry.received) + (percent ? ' (' + percent + '%)' : '');
        row.stats.speed.textContent = bytes(entry.speed || 0) + '/s'; row.stats.eta.textContent = duration(entry.eta);
        row.stats.resume.textContent = entry.status === 'completed' ? '已完成' : entry.resumable ? '支持' : entry.mode === 'checking' ? '正在检查' : entry.mode === 'native' ? '由 Chromium 管理' : '不支持';
        row.stats.mode.textContent = entry.mode === 'range' ? entry.threads.length + ' 个分段线程' : entry.mode === 'native' ? 'Chromium 单连接' : entry.mode === 'single' ? '单连接（服务器不支持分段）' : '正在检查';
        row.speedLabel.hidden = !entry.managed;
        if (document.activeElement !== row.speed) row.speed.value = entry.speedLimit || '';
        if (document.activeElement !== row.completion) row.completion.value = entry.completion || 'none';
        row.completion.disabled = ['completed', 'cancelled'].includes(entry.status);
        const partIds = new Set((entry.threads || []).map(part => part.id));
        for (const [id, part] of row.parts) if (!partIds.has(id)) { part.tr.remove(); part.progress.remove(); row.parts.delete(id); }
        for (const part of entry.threads || []) {
          let elements = row.parts.get(part.id);
          if (!elements) {
            elements = { tr: el('tr'), progress: el('progress'), cells: [] };
            for (let index = 0; index < 4; index++) { const cell = el('td'); elements.cells.push(cell); elements.tr.append(cell); }
            row.body.append(elements.tr); row.band.append(elements.progress); row.parts.set(part.id, elements);
          }
          const size = part.end == null ? 0 : part.end - part.start + 1;
          elements.progress.max = size || 1; if (size) elements.progress.value = part.received; else elements.progress.removeAttribute('value');
          elements.progress.style.flexGrow = String(size || 1);
          elements.progress.title = '线程 ' + part.id + ' · ' + bytes(part.received) + (size ? ' / ' + bytes(size) : '');
          elements.cells[0].textContent = part.id; elements.cells[1].textContent = bytes(part.start) + ' – ' + (part.end == null ? '未知' : bytes(part.end + 1));
          elements.cells[2].textContent = bytes(part.received); elements.cells[3].textContent = statuses[part.status] || part.status;
        }
      }
    },
  };
})();
