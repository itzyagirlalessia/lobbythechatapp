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
// 'section': custom HTML/CSS in its own box inside the card. 'card': the whole card is drawn in the sandbox and the CSS styles all of it.
export const profileScopes = [['section', 'Custom section only'], ['card', 'Whole profile card']];
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
  design.customScope = profileScopes.some(([key]) => value?.customScope === key) ? value.customScope : profileScopes[0][0];
  design.customHeight = Number.isInteger(value?.customHeight) ? Math.max(80, Math.min(420, value.customHeight)) : profileDesignDefaults.customHeight;
  for (const name of ['html', 'css']) {
    design[name] = typeof value?.[name] === 'string' ? value[name].slice(0, profileCodeLimit) : '';
  }
  return design;
}

// A section needs HTML to show anything; a whole-card design can be CSS only.
export function hasProfileCode(design) {
  return Boolean(design.html.trim() || (design.customScope === 'card' && design.css.trim()));
}

export function visibleProfileDesign(value, revision) {
  if (!value) return null;
  const design = normalizeProfileDesign(value);
  const { html, css, ...visual } = design;
  const hasCode = typeof value.html !== 'string' || hasProfileCode(design);
  return { ...visual, customEnabled: design.customEnabled && hasCode, revision: revision ?? 0 };
}

export function visibleProfileCode(value) {
  const design = normalizeProfileDesign(value);
  return design.customEnabled && hasProfileCode(design) ? { html: design.html, css: design.css } : null;
}
