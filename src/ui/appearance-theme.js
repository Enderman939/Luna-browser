(() => {
  let current = window.lunaAppearanceModel.sanitizeAppearance();
  function apply(value, dark, role = '') {
    const tokens = window.lunaAppearanceModel.appearanceTokens(value, dark); current = tokens.appearance;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    for (const [key, region] of Object.entries(current.regions)) document.documentElement.dataset[key + 'Image'] = String(!!region.image);
    const vars = { ...tokens.vars };
    if (role) {
      const region = tokens.regions[role];
      Object.assign(vars, { '--bg': region.bg, '--surface': region.bg, '--ink': region.ink, '--muted': region.muted, '--line': region.line, '--hover': region.hover, '--soft': region.soft });
    }
    for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(key, value);
    return tokens;
  }
  window.lunaAppearance = { apply, get current() { return current; } };
})();
