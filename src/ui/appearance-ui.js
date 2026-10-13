(() => {
  const $ = id => document.getElementById(id), model = window.lunaAppearanceModel;
  let current = model.sanitizeAppearance(), tokens = model.appearanceTokens(current, false), region = 'chrome', target = 'reload', dark = false;
  async function call(action, payload) {
    try {
      const appearance = await window.browser.command(action, payload);
      if (appearance) { current = appearance; tokens = window.lunaAppearance.apply(current, dark); render(); }
      return appearance;
    } catch (error) { window.lunaNotify?.(String(error.message || '无法修改外观').replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/, '').replace(/^(?:Error|TypeError):\s*/, '')); }
  }
  const update = values => call('appearance-update', { section: 'regions', key: region, values });
  const updateIcons = values => call('appearance-update', { section: 'icons', values });
  function textValue(id, value) { if (document.activeElement !== $(id)) $(id).value = value; }
  for (const [key, spec] of Object.entries(model.REGIONS)) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = spec.name; button.dataset.region = key;
    button.setAttribute('role', 'tab'); button.onclick = () => { region = key; render(); }; $('appearance-regions').append(button);
  }
  for (const [key, label] of Object.entries(model.ICONS)) {
    const option = document.createElement('option'); option.value = key; option.textContent = label; $('appearance-icon-target').append(option);
  }
  $('appearance-icon-target').value = target;
  function render() {
    const spec = model.REGIONS[region], value = current.regions[region], color = tokens.regions[region].bg;
    for (const button of $('appearance-regions').children) {
      const selected = button.dataset.region === region; button.classList.toggle('selected', selected); button.setAttribute('aria-selected', selected); button.tabIndex = selected ? 0 : -1;
      const customized = !!(current.regions[button.dataset.region].color || current.regions[button.dataset.region].image);
      button.dataset.customized = customized; button.title = model.REGIONS[button.dataset.region].name + (customized ? ' · 已自定义' : ' · 跟随主题');
    }
    $('appearance-region-name').textContent = spec.name; $('appearance-region-detail').textContent = spec.detail;
    textValue('appearance-background-color', color); textValue('appearance-background-hex', value.color || '');
    $('appearance-background-auto').disabled = !value.color; $('appearance-image-row').hidden = !spec.image;
    $('appearance-image-name').textContent = value.imageName || (value.image ? '自定义图片' : '使用纯色背景');
    $('appearance-remove-background').disabled = !value.image; $('appearance-opacity-row').hidden = !value.image;
    textValue('appearance-image-opacity', value.imageOpacity); $('appearance-opacity-value').textContent = value.imageOpacity + '%';
    textValue('appearance-icon-color', current.icons.color || tokens.regions.chrome.ink); textValue('appearance-icon-hex', current.icons.color);
    $('appearance-icon-auto').disabled = !current.icons.color;
    for (const key of ['size', 'weight', 'shape']) textValue('appearance-icon-' + key, current.icons[key]);
    const custom = current.icons.custom[target], preview = $('appearance-icon-preview'); preview.replaceChildren();
    if (target === 'brand') { const image = document.createElement('img'); image.src = model.assetURL(custom) || 'assets/mark.svg'; image.alt = ''; preview.append(image); }
    else if (window.lunaSetIcon) window.lunaSetIcon(preview, target);
    $('appearance-reset-icon').disabled = !custom;
    const count = Object.keys(current.icons.custom).length; $('appearance-custom-icons').textContent = count ? '已自定义 ' + count + ' 个图标' : '使用默认图标';
    const lowContrast = current.icons.color && ['chrome', 'titlebar', 'sidebar', 'menu', 'surface'].some(key => model.contrast(current.icons.color, tokens.regions[key].bg) < 3);
    $('appearance-icon-note').textContent = lowContrast ? '此图标颜色在部分背景上对比度较低，可选择更清晰的颜色或使用“自动”。本地图片保留自身颜色。' : '图标颜色与线条设置应用于界面图标，本地图片保留自身颜色。';
  }
  function colorControl(picker, field, callback) {
    $(picker).oninput = () => { $(field).value = $(picker).value; callback($(picker).value); };
    $(field).onchange = () => {
      const value = $(field).value.trim();
      if (!value || model.isColor(value)) callback(value);
      else { window.lunaNotify?.('请输入六位颜色值，例如 #FFFFFF'); render(); }
    };
    $(field).onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $(field).blur(); } };
  }
  colorControl('appearance-background-color', 'appearance-background-hex', color => update({ color }));
  colorControl('appearance-icon-color', 'appearance-icon-hex', color => updateIcons({ color }));
  $('appearance-background-auto').onclick = () => { $('appearance-background-hex').value = ''; update({ color: '' }); };
  $('appearance-icon-auto').onclick = () => { $('appearance-icon-hex').value = ''; updateIcons({ color: '' }); };
  $('appearance-reset-region').onclick = () => call('appearance-reset-region', region);
  $('appearance-remove-background').onclick = () => update({ image: '', imageName: '' });
  $('appearance-image-opacity').oninput = () => { $('appearance-opacity-value').textContent = $('appearance-image-opacity').value + '%'; update({ imageOpacity: Number($('appearance-image-opacity').value) }); };
  $('appearance-choose-background').onclick = async () => { const button = $('appearance-choose-background'); button.disabled = true; try { await call('appearance-choose-background', region); } finally { button.disabled = false; } };
  for (const key of ['size', 'weight', 'shape']) $('appearance-icon-' + key).onchange = () => updateIcons({ [key]: key === 'shape' ? $('appearance-icon-' + key).value : Number($('appearance-icon-' + key).value) });
  $('appearance-icon-target').onchange = () => { target = $('appearance-icon-target').value; render(); };
  $('appearance-choose-icon').onclick = async () => { const button = $('appearance-choose-icon'); button.disabled = true; try { await call('appearance-choose-icon', target); } finally { button.disabled = false; } };
  $('appearance-reset-icon').onclick = () => call('appearance-reset-icon', target);
  $('appearance-reset-all').onclick = () => call('appearance-reset');
  $('appearance-regions').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const keys = Object.keys(model.REGIONS), index = keys.indexOf(region);
    region = event.key === 'Home' ? keys[0] : event.key === 'End' ? keys.at(-1) : keys[(index + (event.key === 'ArrowLeft' ? -1 : 1) + keys.length) % keys.length];
    render(); $('appearance-regions').querySelector('[data-region="' + region + '"]').focus();
  });
  window.appearanceControls = { update(settings, isDark) { current = model.sanitizeAppearance(settings.appearance); dark = isDark; tokens = model.appearanceTokens(current, dark); render(); } };
})();
