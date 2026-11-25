// Profile Studio controls, card styles, and the isolated HTML/CSS section or whole card.
import { hasProfileCode, normalizeProfileDesign, profileChoices, profileCodeLimit, profileScopes } from './profile-design.js';
import { element } from './ui.js';

const visualKeys = ['accent', 'surface', ...Object.keys(profileChoices)];
const presets = [
  ['Lobby', '#bb9ae5', '#251e32', 'glow'],
  ['Aurora', '#83efd0', '#102b2a', 'gradient'],
  ['Ink', '#a6bbff', '#171c35', 'flat'],
  ['Rose', '#ffabc1', '#382036', 'glow'],
  ['Cloud', '#7855a5', '#f3edf9', 'flat'],
];
const labels = { finish: 'Background finish', avatar: 'Avatar shape', banner: 'Banner height', position: 'Banner focus',
  layout: 'Header alignment', font: 'Typeface', border: 'Card border' };
const starterHtml = '<section class="welcome-note">\n  <h2>My corner of Lobby</h2>\n  <p>Write something about yourself here.</p>\n</section>';
const starterCss = '.welcome-note {\n  padding: 14px;\n  border: 1px solid var(--accent);\n  border-radius: 12px;\n}\n.welcome-note h2 { font-size: 1rem; }\n.welcome-note p { margin-bottom: 0; }';
const cardStarterHtml = '<p>Welcome to my corner of Lobby.</p>';
const cardStarterCss = '.banner {\n  height: 140px;\n  background: linear-gradient(135deg, var(--accent), #1b1030);\n}\n.avatar {\n  border-radius: 50%;\n  border-color: var(--accent);\n}\n.name { font-size: 1.6rem; letter-spacing: .02em; }\n.bio { font-style: italic; border-top: 2px dashed var(--accent); }\n.custom {\n  padding: 12px;\n  border: 1px solid var(--accent);\n  border-radius: 12px;\n}';
const cardMaxHeight = 560;
// Lobby's default look for a whole-card design. The member's CSS comes after it and can override any of it.
const cardCss = `.card{position:relative;overflow:hidden;background:var(--surface)}
.card[data-finish=glow]{background:radial-gradient(ellipse at 5% 100%,color-mix(in srgb,var(--surface) 81%,var(--accent)),transparent 76%),var(--surface)}
.card[data-finish=gradient]{background:linear-gradient(145deg,var(--surface) 32%,color-mix(in srgb,var(--surface) 76%,var(--accent)))}
.banner{height:123px;overflow:hidden;background:linear-gradient(131deg,#1a0b3190,transparent 85%),var(--accent)}
.card[data-banner=compact] .banner{height:80px}.card[data-banner=tall] .banner{height:168px}.card[data-banner=none] .banner{display:none}
.banner img{display:block;width:100%;height:100%;object-fit:cover}
.card[data-position=top] .banner img{object-position:top}.card[data-position=bottom] .banner img{object-position:bottom}
.avatar{position:relative;box-sizing:border-box;display:grid;place-items:center;width:65px;height:65px;margin:-32px 15px 0;overflow:hidden;border:3px solid var(--surface);border-radius:20px;background:var(--accent);color:#fff;font-size:20px;font-weight:700}
.card[data-banner=none] .avatar{margin-top:15px}.card[data-avatar=circle] .avatar{border-radius:50%}.card[data-avatar=square] .avatar{border-radius:4px}
.avatar img{width:100%;height:100%;object-fit:cover}
.card[data-layout=center] .avatar{margin-inline:auto}.card[data-layout=center] .body{text-align:center}
.body{padding:7px 15px 14px}
.name{margin:0;font-size:1.375rem;line-height:1.2}
.username{margin:3px 0 0;opacity:.72;font-size:.8125rem}
.status{margin:9px 0 0;padding:7px 9px;border-left:2px solid var(--accent);border-radius:4px 7px 7px 4px;background:color-mix(in srgb,var(--surface) 85%,var(--ink))}
.bio{margin:9px 0 0;padding-top:9px;border-top:1px solid color-mix(in srgb,var(--ink) 20%,transparent);font-size:.8125rem}
.card[data-font=serif] :is(.name,.bio){font-family:Georgia,serif}.card[data-font=mono] :is(.name,.bio){font-family:ui-monospace,Consolas,monospace}
.details{display:grid;gap:6px;margin:9px 0 0}.details dt{opacity:.72;font-size:.6875rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.details dd{margin:0}
.activity{display:grid;gap:6px;margin-top:10px}.activity small{display:block;opacity:.72;font-size:.75rem}
.custom{margin-top:12px}.custom:empty{display:none}`;
const approvedTags = new Set(['article', 'aside', 'blockquote', 'br', 'code', 'dd', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2',
  'h3', 'h4', 'hr', 'li', 'mark', 'ol', 'p', 'pre', 'section', 'small', 'span', 'strong', 'summary', 'ul']);
const discardedTags = new Set(['form', 'iframe', 'object', 'script', 'style', 'template']);
const frames = new WeakMap();
const pictureUrls = new Map();

// The sandbox only loads blob: images, so Lobby copies the avatar and banner into blob URLs. Member CSS can't load images.
function pictureUrl(source) {
  if (!source) return Promise.resolve('');
  if (!pictureUrls.has(source)) {
    if (pictureUrls.size >= 40) {
      const [oldest, url] = pictureUrls.entries().next().value;
      pictureUrls.delete(oldest);
      void url.then(value => value && URL.revokeObjectURL(value));
    }
    pictureUrls.set(source, (async () => {
      const inline = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(source);
      const blob = inline ? new Blob([Uint8Array.from(atob(inline[2]), char => char.charCodeAt(0))], { type: inline[1] })
        : await fetch(source, { credentials: 'same-origin' }).then(response => response.ok ? response.blob() : null);
      return blob?.type.startsWith('image/') ? URL.createObjectURL(blob) : '';
    })().catch(() => ''));
  }
  return pictureUrls.get(source);
}

function isLight(color) {
  const components = color.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
    .map(part => part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4);
  return 0.2126 * components[0] + 0.7152 * components[1] + 0.0722 * components[2] > 0.18;
}

export function applyProfileDesign(card, source) {
  card.classList.toggle('profile-designed', Boolean(source));
  if (!source) return;
  const design = normalizeProfileDesign(source);
  card.dataset.designTone = isLight(design.surface) ? 'light' : 'dark';
  card.style.setProperty('--design-accent', design.accent);
  card.style.setProperty('--design-surface', design.surface);
  card.style.setProperty('--design-ink', isLight(design.surface) ? '#111015' : '#ffffff');
  for (const name of Object.keys(profileChoices)) card.dataset['design' + name[0].toUpperCase() + name.slice(1)] = design[name];
}

function safeMarkup(doc, html) {
  const template = doc.createElement('template');
  template.innerHTML = html;
  const output = doc.createDocumentFragment();
  let remaining = 250;
  function copy(parent, into, depth) {
    for (const node of parent.childNodes) {
      if (--remaining < 0 || depth > 24) return;
      if (node.nodeType === 3) {
        into.append(doc.createTextNode(node.textContent));
      } else if (node.nodeType === 1 && node.namespaceURI === 'http://www.w3.org/1999/xhtml' && !discardedTags.has(node.localName)) {
        if (!approvedTags.has(node.localName)) {
          copy(node, into, depth + 1);
          continue;
        }
        const clean = doc.createElement(node.localName);
        for (const name of ['class', 'id']) {
          const value = node.getAttribute(name);
          if (value && /^[a-zA-Z0-9_ -]{1,128}$/.test(value)) clean.setAttribute(name, value);
        }
        if (node.localName === 'details' && node.hasAttribute('open')) clean.open = true;
        copy(node, clean, depth + 1);
        into.append(clean);
      }
    }
  }
  copy(template.content, output, 0);
  return output;
}

function cardMarkup(doc, profile, design) {
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const card = make('article', 'card');
  for (const name of Object.keys(profileChoices)) card.dataset[name] = design[name];
  card.dataset.online = String(Boolean(profile.online));
  const banner = make('div', 'banner');
  const picture = make('div', 'avatar', (profile.name || '?').trim().charAt(0).toUpperCase());
  for (const [node, source] of [[banner, profile.banner], [picture, profile.avatar]]) {
    void pictureUrl(source).then(url => {
      if (!url || !node.isConnected) return;
      const image = make('img');
      image.alt = '';
      image.src = url;
      node.replaceChildren(image);
    });
  }
  const body = make('div', 'body');
  body.append(make('h2', 'name', profile.name));
  if (profile.username) body.append(make('p', 'username', profile.username));
  if (profile.status) body.append(make('p', 'status', profile.status));
  if (profile.bio) body.append(make('p', 'bio', profile.bio));
  const facts = (profile.details || []).filter(fact => fact.label && fact.value);
  if (facts.length) {
    const list = make('dl', 'details');
    for (const fact of facts) {
      const row = make('div');
      row.append(make('dt', '', fact.label), make('dd', '', fact.value));
      list.append(row);
    }
    body.append(list);
  }
  if (profile.activities?.length) {
    const list = make('div', 'activity');
    for (const activity of profile.activities) {
      const row = make('div', 'activity-row');
      row.append(make('small', '', activity.label), make('strong', '', activity.title));
      list.append(row);
    }
    body.append(list);
  }
  const custom = make('div', 'custom');
  custom.append(safeMarkup(doc, design.html));
  body.append(custom);
  card.append(banner, picture, body);
  return card;
}

function fitFrame(frame) {
  const height = frame.contentDocument?.body?.scrollHeight;
  if (height) frame.height = String(Math.min(cardMaxHeight, height));
}

function paintCode(frame) {
  const entry = frames.get(frame);
  const doc = frame.contentDocument;
  const root = doc?.getElementById('lobby-profile-content');
  if (!entry || !root) return;
  const { design, profile } = entry;
  const style = doc.createElement('style');
  const light = isLight(design.surface);
  const ink = light ? '#111015' : '#ffffff';
  style.textContent = `:root{--accent:${design.accent};--surface:${design.surface};--ink:${ink};color:${ink};background:${design.surface};color-scheme:${light ? 'light' : 'dark'};font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}body{margin:0;padding:${profile ? 0 : '1px'}}h1,h2,h3,h4{line-height:1.2;margin:0 0 .35em}p{margin:.25em 0 .6em}${profile ? cardCss : ''}`;
  const customStyle = doc.createElement('style');
  customStyle.textContent = design.css;
  doc.head.querySelectorAll('style').forEach(node => node.remove());
  doc.head.append(style, customStyle);
  if (!profile) {
    root.replaceChildren(safeMarkup(doc, design.html));
    return;
  }
  root.replaceChildren(cardMarkup(doc, profile, design));
  fitFrame(frame);
  entry.painted?.();
}

function codeFrame(container, title, entry) {
  let frame = container.firstElementChild;
  if (!frame) {
    frame = element('iframe', 'profile-code-frame');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.title = title;
    frame.referrerPolicy = 'no-referrer';
    frame.addEventListener('load', () => paintCode(frame));
    frame.src = '/profile-canvas';
    container.append(frame);
  }
  const previous = frames.get(frame);
  frames.set(frame, entry);
  // JSON.stringify skips the `painted` callback, so only content changes trigger a repaint.
  if (JSON.stringify(previous) !== JSON.stringify(entry)) paintCode(frame);
  return frame;
}

export function renderProfileCode(container, source) {
  const design = normalizeProfileDesign(source);
  container.hidden = !design.customEnabled || design.customScope !== 'section' || !hasProfileCode(design);
  if (container.hidden) {
    container.replaceChildren();
    return;
  }
  codeFrame(container, 'Custom profile section', { design }).height = design.customHeight;
}

// Whole-card design: Lobby draws the card inside the sandbox and the member's CSS styles all of it.
// Names, badges, links and buttons stay outside, drawn by the caller, so they can't be faked or hidden.
// Returns whether the card is shown. `painted` runs after each repaint, once the frame has its height.
export function renderProfileCard(container, source, profile, painted) {
  const design = normalizeProfileDesign(source);
  container.hidden = !design.customEnabled || design.customScope !== 'card' || !hasProfileCode(design);
  if (container.hidden) {
    container.replaceChildren();
    return false;
  }
  codeFrame(container, `Profile card for ${profile.name}`, { design, profile, painted });
  return true;
}

export function usesProfileCard(design) {
  return Boolean(design?.customEnabled && design.customScope === 'card');
}

function choiceField(name, choices) {
  return `<label class="field">${labels[name]}<select data-design="${name}">${choices.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>`;
}

export function designFields() {
  return `<fieldset class="profile-section"><legend>Color and finish</legend>
    <div class="studio-presets" aria-label="Color presets">${presets.map(([name]) => `<button class="button outline" type="button" data-preset="${name}">${name}</button>`).join('')}</div>
    <div class="profile-grid studio-colors">
      <label class="field">Accent<input type="color" data-design="accent"></label>
      <label class="field">Card background<input type="color" data-design="surface"></label>
    </div>
    ${choiceField('finish', profileChoices.finish)}
  </fieldset>
  <fieldset class="profile-section"><legend>Shape and layout</legend>
    <div class="profile-grid">${Object.entries(profileChoices).filter(([name]) => name !== 'finish').map(([name, choices]) => choiceField(name, choices)).join('')}</div>
    <button class="button subtle" id="reset-design" type="button">Reset appearance</button>
  </fieldset>`;
}

export const codeFields = `<fieldset class="profile-section studio-code"><legend>Custom HTML / CSS</legend>
  <label class="profile-share"><input type="checkbox" data-design="customEnabled"><span><strong>Use my HTML / CSS</strong></span></label>
  <label class="field">What it styles<select data-design="customScope">${profileScopes.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
  <p data-scope-hint="section">Your HTML appears in its own box inside your profile card, and your CSS styles that box. Write HTML for content, then switch to CSS to style it. Common text and layout tags are supported.</p>
  <p data-scope-hint="card" hidden>Your CSS styles the whole card. Lobby draws it with these classes: <code>.card</code> <code>.banner</code> <code>.avatar</code> <code>.body</code> <code>.name</code> <code>.username</code> <code>.status</code> <code>.bio</code> <code>.details</code> <code>.activity</code>, and <code>.custom</code> holds your HTML. Your real name, badges and buttons always show below the card.</p>
  <div class="studio-tabs studio-code-switch" role="group" aria-label="Code to edit">
    <button type="button" data-code-view="html" aria-pressed="true">HTML</button>
    <button type="button" data-code-view="css" aria-pressed="false">CSS</button>
  </div>
  <label class="field" data-code-pane="html"><span class="visually-hidden">HTML</span><textarea data-design="html" rows="10" maxlength="${profileCodeLimit}" spellcheck="false" autocapitalize="off"></textarea></label>
  <label class="field" data-code-pane="css" hidden><span class="visually-hidden">CSS</span><textarea data-design="css" rows="10" maxlength="${profileCodeLimit}" spellcheck="false" autocapitalize="off"></textarea></label>
  <label class="field" data-scope-only="section">Section height<input type="number" data-design="customHeight" min="80" max="420" step="1"><small>80–420 px</small></label>
  <button class="button outline" type="button" id="studio-code-example">Insert starter</button>
</fieldset>`;

export function bindProfileStudio(form, initial) {
  const tabs = [...form.querySelectorAll('[role=tab]')];
  function selectTab(tab, focus = false) {
    for (const item of tabs) {
      const selected = tab === item;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      form.querySelector('#' + item.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      const next = { ArrowLeft: (index - 1 + tabs.length) % tabs.length, ArrowRight: (index + 1) % tabs.length,
        Home: 0, End: tabs.length - 1 }[event.key];
      if (!Number.isInteger(next)) return;
      event.preventDefault();
      selectTab(tabs[next], true);
    });
  }
  form.addEventListener('invalid', event => {
    const panel = event.target.closest('[role=tabpanel]');
    const tab = tabs.find(item => item.getAttribute('aria-controls') === panel?.id);
    if (tab) selectTab(tab);
  }, true);
  const fields = Object.fromEntries([...form.querySelectorAll('[data-design]')].map(node => [node.dataset.design, node]));
  function assign(design, keys = Object.keys(fields)) {
    for (const key of keys) {
      if (fields[key].type === 'checkbox') fields[key].checked = design[key];
      else fields[key].value = design[key];
    }
  }
  const changed = () => form.dispatchEvent(new Event('input'));
  assign(normalizeProfileDesign(initial));
  selectTab(tabs[0]);
  for (const [name, accent, surface, finish] of presets) {
    form.querySelector('[data-preset="' + name + '"]').addEventListener('click', () => {
      assign({ accent, surface, finish }, ['accent', 'surface', 'finish']);
      changed();
    });
  }
  form.querySelector('#reset-design').addEventListener('click', () => {
    assign(normalizeProfileDesign(), visualKeys);
    changed();
  });
  const codeViews = [...form.querySelectorAll('[data-code-view]')];
  function showCode(view, focus = false) {
    for (const button of codeViews) button.setAttribute('aria-pressed', String(button.dataset.codeView === view));
    for (const pane of form.querySelectorAll('[data-code-pane]')) pane.hidden = pane.dataset.codePane !== view;
    if (focus) fields[view].focus();
  }
  for (const button of codeViews) button.addEventListener('click', () => showCode(button.dataset.codeView, true));
  const starter = form.querySelector('#studio-code-example');
  const updateCodeFields = () => {
    starter.disabled = Boolean(fields.html.value.trim() || fields.css.value.trim());
    const scope = fields.customScope.value;
    for (const node of form.querySelectorAll('[data-scope-hint]')) node.hidden = node.dataset.scopeHint !== scope;
    for (const node of form.querySelectorAll('[data-scope-only]')) node.hidden = node.dataset.scopeOnly !== scope;
  };
  form.addEventListener('input', updateCodeFields);
  form.addEventListener('change', updateCodeFields);
  updateCodeFields();
  starter.addEventListener('click', () => {
    const card = fields.customScope.value === 'card';
    assign({ html: card ? cardStarterHtml : starterHtml, css: card ? cardStarterCss : starterCss, customEnabled: true }, ['html', 'css', 'customEnabled']);
    changed();
    showCode(card ? 'css' : 'html', true);
  });
  return () => normalizeProfileDesign(Object.fromEntries(Object.entries(fields).map(([key, field]) => [
    key, field.type === 'checkbox' ? field.checked : field.type === 'number' ? field.valueAsNumber : field.value,
  ])));
}

export function profileFacts(details) {
  const facts = element('dl', 'profile-facts');
  for (const { label, value } of details) {
    if (!label || !value) continue;
    const fact = element('div');
    fact.append(element('dt', '', label), element('dd', '', value));
    facts.append(fact);
  }
  return facts;
}
