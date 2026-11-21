// Profile design data shared by the editor and the Worker.
export const profileChoices = {
  finish: [['glow', 'Soft glow'], ['flat', 'Solid'], ['gradient', 'Diagonal gradient']],
  avatar: [['rounded', 'Rounded square'], ['circle', 'Circle'], ['square', 'Square']],
  banner: [['standard', 'Standard'], ['compact', 'Compact'], ['tall', 'Tall'], ['none', 'Hidden']],
  position: [['center', 'Center'], ['top', 'Top'], ['bottom', 'Bottom']],
  layout: [['left', 'Left aligned'], ['center', 'Centered']],
  font: [['lobby', 'Lobby'], ['serif', 'Serif'], ['mono', 'Monospace']],
  border: [['subtle', 'Subtle'], ['outlined', 'Accent outline'], ['none', 'None']],
};

export const profileDesignDefaults = { accent: '#bb9ae5', surface: '#251e32', customHeight: 144 };
export const profileCodeLimit = 6000;

export function normalizeProfileDesign(value) {
  const design = {};
  for (const name of ['accent', 'surface']) {
    const color = value?.[name];
    design[name] = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : profileDesignDefaults[name];
  }
  for (const [name, choices] of Object.entries(profileChoices)) {
    design[name] = choices.some(([key]) => value?.[name] === key) ? value[name] : choices[0][0];
  }
  design.customEnabled = value?.customEnabled === true;
  design.customHeight = Number.isInteger(value?.customHeight) ? Math.max(80, Math.min(420, value.customHeight)) : profileDesignDefaults.customHeight;
  for (const name of ['html', 'css']) {
    design[name] = typeof value?.[name] === 'string' ? value[name].slice(0, profileCodeLimit) : '';
  }
  return design;
}

export function visibleProfileDesign(value, revision) {
  if (!value) return null;
  const design = normalizeProfileDesign(value);
  const { html, css, ...visual } = design;
  const hasMarkup = typeof value.html !== 'string' || Boolean(html.trim());
  return { ...visual, customEnabled: design.customEnabled && hasMarkup, revision: revision ?? 0 };
}

export function visibleProfileCode(value) {
  const design = normalizeProfileDesign(value);
  return design.customEnabled && design.html.trim() ? { html: design.html, css: design.css } : null;
}
