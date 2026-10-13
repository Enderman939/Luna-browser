(() => {
  const bridge = window.modalLayer; let snapshot, seq = 0, rendering = false, dragSource = null, composing = false, deferred = null;
  const fieldState = dialog => [...dialog.querySelectorAll('input,textarea,select')].map(element => ({ key: element.dataset.modalNode, value: element.value, ...(element instanceof HTMLInputElement ? { checked: element.checked } : {}) }));
  function event(type, element, extra = {}) {
    const dialog = element?.closest('dialog') || [...document.querySelectorAll('dialog[open]')].at(-1), entry = snapshot?.dialogs.find(entry => entry.id === dialog?.id);
    if (!entry || rendering) return;
    bridge.event({ session: snapshot.session, seq: ++seq, dialogId: entry.id, generation: entry.generation, node: element?.dataset.modalNode, type, fields: fieldState(dialog), ...extra }).catch(() => {});
  }
  const identity = element => element?.id ? '#' + element.id : element?.dataset.permission ? '[data-permission="' + element.dataset.permission + '"]' : element?.dataset.modalNode ? '[data-modal-node="' + element.dataset.modalNode + '"]' : null;
  function renderSnapshot(value) {
    if (composing || dragSource) { deferred = value; return; }
    if (snapshot && value.session === snapshot.session && value.ack < seq) return;
    if (!snapshot || value.session !== snapshot.session) seq = value.ack || 0;
    const focus = document.activeElement, focusKey = identity(focus), selection = focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement ? { start: focus.selectionStart, end: focus.selectionEnd } : null;
    const scroll = [...document.querySelectorAll('dialog,dialog *')].filter(element => element.scrollTop).map(element => [identity(element), element.scrollTop]);
    const previous = snapshot?.dialogs.map(entry => entry.id + ':' + entry.generation).join(','); snapshot = value; rendering = true;
    document.body.dataset.ownerWindow = String(value.windowId);
    try {
      window.lunaAppearance.apply(value.appearance, value.dark);
      for (const dialog of document.querySelectorAll('dialog')) dialog.remove();
      for (const entry of value.dialogs) {
        const template = document.createElement('template'); template.innerHTML = entry.html;
        const dialog = template.content.firstElementChild; if (!(dialog instanceof HTMLDialogElement)) continue;
        document.body.append(dialog); dialog.showModal();
        dialog.addEventListener('cancel', action => { action.preventDefault(); event('cancel', dialog); });
      }
      for (const details of document.querySelectorAll('details')) details.dataset.modalToggle = String(details.open);
      for (const [key, top] of scroll) { if (key) { const element = document.querySelector(key); if (element) { element.dataset.modalScroll = String(top); element.scrollTo({ top }); } } }
      const target = focusKey && document.querySelector(focusKey);
      if (target && !target.disabled) { target.focus({ preventScroll: true }); if (selection && selection.start !== null) { try { target.setSelectionRange(selection.start, selection.end); } catch {} } }
      else if (previous !== value.dialogs.map(entry => entry.id + ':' + entry.generation).join(',')) {
        const top = [...document.querySelectorAll('dialog[open]')].at(-1); (top?.querySelector('[id$="cancel"],input:not([type="checkbox"]),button') || top)?.focus();
      }
    } finally { rendering = false; }
  }
  bridge.onSnapshot(renderSnapshot);
  document.addEventListener('compositionstart', () => { composing = true; });
  document.addEventListener('compositionend', () => { composing = false; if (deferred) { const latest = deferred; deferred = null; renderSnapshot(latest); } });
  document.addEventListener('click', action => {
    const button = action.target.closest('button,a');
    if (button) { action.preventDefault(); if (!button.disabled && (button.type !== 'submit' || !button.form || button.form.reportValidity())) event('click', button); }
    // Native checkbox/radio changes are forwarded by the change listener.
  });
  document.addEventListener('input', action => event('input', action.target));
  document.addEventListener('change', action => event('change', action.target));
  document.addEventListener('submit', action => { action.preventDefault(); event('submit', action.target); });
  document.addEventListener('toggle', action => { if (action.target instanceof HTMLDetailsElement && !rendering && action.target.dataset.modalToggle !== String(action.target.open)) { action.target.dataset.modalToggle = String(action.target.open); event('toggle', action.target, { open: action.target.open }); } }, true);
  document.addEventListener('scroll', action => { if (!rendering && action.target.closest?.('dialog') && action.target.dataset.modalScroll !== String(action.target.scrollTop)) { action.target.dataset.modalScroll = String(action.target.scrollTop); event('scroll', action.target, { scrollTop: action.target.scrollTop }); } }, true);
  document.addEventListener('dragstart', action => { dragSource = action.target.closest('[draggable="true"]')?.dataset.modalNode; if (dragSource) action.dataTransfer.setData('application/x-luna-dialog-drag', dragSource); });
  document.addEventListener('dragover', action => { if (dragSource) action.preventDefault(); });
  document.addEventListener('drop', action => { if (!dragSource) return; action.preventDefault(); const target = action.target.closest('[draggable="true"]'); if (target) event('drag', target, { source: dragSource }); dragSource = null; });
  document.addEventListener('dragend', () => { dragSource = null; if (deferred) { const latest = deferred; deferred = null; renderSnapshot(latest); } });
  bridge.onCancel(() => event('cancel', [...document.querySelectorAll('dialog[open]')].at(-1)));
  bridge.ready().catch(() => {});
})();
