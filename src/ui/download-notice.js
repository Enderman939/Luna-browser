(() => {
  const bridge = window.downloadNotice, $ = selector => document.querySelector(selector);
  let current;
  bridge.onState(value => {
    current = value; window.lunaAppearance.apply(value.appearance, value.dark, 'menu');
    document.body.dataset.owner = String(value.owner);
    $('#filename').textContent = value.name; $('#filename').title = value.name;
    $('#completion-count').hidden = value.count <= 1; $('#completion-count').textContent = value.count + ' 个已完成';
    $('#notice-error').textContent = value.error || ''; $('#notice-error').hidden = !value.error;
  });
  async function action(name) {
    try { await bridge.action(name, current?.id); }
    catch (error) { $('#notice-error').textContent = String(error.message).replace(/^Error invoking remote method [^:]+:\s*(?:Error:\s*)?/, ''); $('#notice-error').hidden = false; }
  }
  $('#dismiss').onclick = () => action('dismiss'); $('#open-file').onclick = () => action('open');
  $('#reveal-file').onclick = () => action('reveal'); $('#show-downloads').onclick = () => action('downloads');
  $('#download-notice').onmouseenter = () => action('pause'); $('#download-notice').onmouseleave = () => action('resume');
  document.addEventListener('keydown', event => { if (event.key === 'Escape') action('dismiss'); });
  bridge.ready();
})();
