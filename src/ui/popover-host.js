(() => {
  const kind = new URLSearchParams(location.search).get('popover'); if (!kind) return;
  document.body.dataset.popover = kind;
  document.title = 'luna · ' + kind;
  const targets = { extensions: '#extensions-menu', browser: '#browser-menu', downloads: '#panel', history: '#panel', bookmarks: '#panel', passwords: '#password-popup', address: '#address-suggestions' };
  document.body.appendChild(document.querySelector(targets[kind]));
  let initialized = false, closing = false;
  function fit() {
    const node = document.querySelector(targets[kind]); if (!node || closing) return;
    const list = kind === 'address' && node.querySelector('.address-candidate-list');
    // Async suggestions can grow beyond the current native window. Measure the
    // list's intrinsic content, otherwise its viewport cap prevents any growth.
    const height = list ? node.offsetHeight - list.offsetHeight + Math.min(480, list.scrollHeight) : node.offsetHeight;
    window.browser.command('popover-size', Math.ceil(height + 24)).catch(() => {});
  }
  window.popoverHost = { kind, close: () => window.browser.command('popover-close').catch(() => {}), initialized: () => {
    if (initialized) { if (kind === 'address') requestAnimationFrame(fit); return; } initialized = true;
    const node = document.querySelector(targets[kind]);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) node.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.975)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 170, easing: 'cubic-bezier(.2,.85,.25,1)' });
    new ResizeObserver(fit).observe(node); requestAnimationFrame(fit);
  } };
  window.browser.onPopoverClose(() => {
    if (closing) return; closing = true;
    const node = document.querySelector(targets[kind]);
    if (!node || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    node.animate([{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(-3px) scale(.985)' }], { duration: 110, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !(kind === 'browser' && window.browserMenu?.hasSubmenu())) { event.preventDefault(); window.popoverHost.close(); } });
})();
