// Profile Studio controls, card styles, and the isolated HTML/CSS section.
import { normalizeProfileDesign, profileChoices, profileCodeLimit } from './profile-design.js';
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
const approvedTags = new Set(['article', 'aside', 'blockquote', 'br', 'code', 'dd', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2',
  'h3', 'h4', 'hr', 'li', 'mark', 'ol', 'p', 'pre', 'section', 'small', 'span', 'strong', 'summary', 'ul']);
const discardedTags = new Set(['form', 'iframe', 'object', 'script', 'style', 'template']);
const frames = new WeakMap();

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

function paintCode(frame) {
  const design = frames.get(frame);
  const doc = frame.contentDocument;
  const root = doc?.getElementById('lobby-profile-content');
  if (!design || !root) return;
  const style = doc.createElement('style');
  const light = isLight(design.surface);
  style.textContent = `:root{--accent:${design.accent};color:${light ? '#111015' : '#ffffff'};background:${design.surface};color-scheme:${light ? 'light' : 'dark'};font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}body{margin:0;padding:1px}h1,h2,h3,h4{line-height:1.2;margin:0 0 .35em}p{margin:.25em 0 .6em}`;
  const customStyle = doc.createElement('style');
  customStyle.textContent = design.css;
  doc.head.querySelectorAll('style').forEach(node => node.remove());
  doc.head.append(style, customStyle);
  root.replaceChildren(safeMarkup(doc, design.html));
}

export function renderProfileCode(container, source) {
  const design = normalizeProfileDesign(source);
  container.hidden = !design.customEnabled || !design.html.trim();
  if (container.hidden) {
    container.replaceChildren();
    return;
  }
  let frame = container.firstElementChild;
  if (!frame) {
    frame = element('iframe', 'profile-code-frame');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.title = 'Custom profile section';
    frame.referrerPolicy = 'no-referrer';
    frame.addEventListener('load', () => paintCode(frame));
    frame.src = '/profile-canvas';
    container.append(frame);
  }
  const previous = frames.get(frame);
  frame.height = design.customHeight;
  frames.set(frame, design);
  if (JSON.stringify(previous) !== JSON.stringify(design)) paintCode(frame);
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

export const codeFields = `<fieldset class="profile-section studio-code"><legend>Custom profile section</legend>
  <p>Write HTML for content, then switch to CSS to style it. The preview appears inside your profile card. Common text and layout tags are supported.</p>
  <label class="profile-share"><input type="checkbox" data-design="customEnabled"><span><strong>Show custom section</strong></span></label>
  <div class="studio-tabs studio-code-switch" role="group" aria-label="Code to edit">
    <button type="button" data-code-view="html" aria-pressed="true">HTML</button>
    <button type="button" data-code-view="css" aria-pressed="false">CSS</button>
  </div>
  <label class="field" data-code-pane="html"><span class="visually-hidden">HTML</span><textarea data-design="html" rows="10" maxlength="${profileCodeLimit}" spellcheck="false" autocapitalize="off"></textarea></label>
  <label class="field" data-code-pane="css" hidden><span class="visually-hidden">CSS</span><textarea data-design="css" rows="10" maxlength="${profileCodeLimit}" spellcheck="false" autocapitalize="off"></textarea></label>
  <label class="field">Section height<input type="number" data-design="customHeight" min="80" max="420" step="1"><small>80–420 px</small></label>
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
  const updateStarter = () => { starter.disabled = Boolean(fields.html.value.trim() || fields.css.value.trim()); };
  form.addEventListener('input', updateStarter);
  updateStarter();
  starter.addEventListener('click', () => {
    assign({ html: starterHtml, css: starterCss, customEnabled: true }, ['html', 'css', 'customEnabled']);
    changed();
    showCode('html', true);
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
