(() => {
  if (new URLSearchParams(location.search).has('popover')) return;
  const bridge = window.browser, registry = new Map(), keys = new WeakMap(), generations = new WeakMap();
  let counter = 0, generation = 0, session = crypto.randomUUID(), seq = 0, queued = false, applying = false;
  const key = element => { if (!keys.has(element)) { const id = 'n' + (++counter); keys.set(element, id); registry.set(id, element); } return keys.get(element); };
  const nativeShow = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (...args) { const result = nativeShow.apply(this, args); generations.set(this, ++generation); schedule(); return result; };
  function snapshot() {
    const open = [...document.querySelectorAll('dialog[open]')].sort((a, b) => (generations.get(a) || 0) - (generations.get(b) || 0));
    document.documentElement.toggleAttribute('data-modal-source', !!open.length);
    const dialogs = open.map(dialog => {
      if (!generations.has(dialog)) generations.set(dialog, ++generation);
      const copy = dialog.cloneNode(true), originals = [dialog, ...dialog.querySelectorAll('*')], copies = [copy, ...copy.querySelectorAll('*')];
      originals.forEach((element, index) => {
        const target = copies[index]; target.dataset.modalNode = key(element);
        if (element instanceof HTMLInputElement) { target.setAttribute('value', element.value); target.toggleAttribute('checked', element.checked); }
        if (element instanceof HTMLTextAreaElement) target.textContent = element.value;
        if (element instanceof HTMLSelectElement) [...target.options].forEach((option, i) => option.toggleAttribute('selected', element.options[i].selected));
        // Only attributes produced by the trusted UI are displayed. Inline code
        // has no role in the mirror; the real handlers stay in this document.
        for (const attr of [...target.attributes]) if (/^on/i.test(attr.name)) target.removeAttribute(attr.name);
      });
      copy.removeAttribute('open');
      return { id: dialog.id, generation: generations.get(dialog) || 0, html: copy.outerHTML };
    });
    const live = new Set([...document.querySelectorAll('dialog *'), ...document.querySelectorAll('dialog')]);
    for (const [id, element] of registry) if (!live.has(element)) registry.delete(id);
    bridge.command('dialog-snapshot', { session, ack: seq, dialogs, dark: document.documentElement.dataset.theme === 'dark', appearance: window.lunaAppearance.current }).catch(() => {});
  }
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; snapshot(); }); }
  function valid(element, packet) { const dialog = element?.closest('dialog'); return !!dialog?.open && dialog.id === packet.dialogId && (generations.get(dialog) || 0) === packet.generation; }
  function values(packet) {
    for (const field of packet.fields || []) {
      const element = registry.get(field.key); if (!valid(element, packet) || element.disabled) continue;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        if (typeof field.value === 'string' && field.value.length <= 32768) element.value = field.value;
        if (element instanceof HTMLInputElement && typeof field.checked === 'boolean') element.checked = field.checked;
      }
    }
  }
  bridge.onDialogEvent(packet => {
    if (packet.session !== session || packet.seq <= seq) return;
    seq = packet.seq;
    const element = registry.get(packet.node), dialog = document.getElementById(packet.dialogId);
    if (!dialog?.open || (generations.get(dialog) || 0) !== packet.generation || packet.type !== 'cancel' && !valid(element, packet)) { schedule(); return; }
    applying = true;
    try {
      values(packet);
      if (packet.type === 'cancel') { const event = new Event('cancel', { cancelable: true }); if (dialog.dispatchEvent(event)) dialog.close(); }
      else if (packet.type === 'submit') { if (element instanceof HTMLFormElement) element.requestSubmit(); }
      else if (packet.type === 'click') { if (!element.disabled) element.click(); }
      else if (packet.type === 'input' || packet.type === 'change') element.dispatchEvent(new Event(packet.type, { bubbles: true }));
      else if (packet.type === 'toggle' && element instanceof HTMLDetailsElement) element.open = packet.open === true;
      else if (packet.type === 'scroll') { if (Number.isFinite(packet.scrollTop)) element.scrollTop = packet.scrollTop; }
      else if (packet.type === 'drag') {
        const source = registry.get(packet.source); if (valid(source, packet) && source.draggable) {
          const transfer = new DataTransfer(); source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
          element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
        }
      }
    } finally { applying = false; schedule(); }
  });
  const observer = new MutationObserver(() => { if (!applying) schedule(); });
  for (const dialog of document.querySelectorAll('dialog')) { observer.observe(dialog, { subtree: true, childList: true, attributes: true, characterData: true }); dialog.addEventListener('close', schedule); }
  for (const type of ['input', 'change', 'toggle', 'focusin']) document.addEventListener(type, event => { if (event.target.closest?.('dialog')) schedule(); }, true);
  window.modalSource = { schedule };
})();
