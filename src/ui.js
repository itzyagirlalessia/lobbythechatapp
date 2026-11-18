// Shared UI helpers: DOM shortcuts, icons, avatars, toasts, dialogs and the API client.
import { preferences } from './state.js';
import { showUsernameSetup } from './profile.js';

export function $(id) {
  return document.getElementById(id);
}

export const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });
export const narrowScreen = window.matchMedia('(max-width: 950px)');

let toastTimer;

export function icon(id) {
  return `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
}

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function updateAvatar(node, name, key, accent, picture) {
  const initials = Array.from(name.split(/\s+/).slice(0, 2), word => Array.from(word)[0]).join('').toUpperCase();
  node.dataset.color = accent ?? color(key);
  if (node.dataset.initials === initials && node.dataset.picture === (picture || '')) return;
  node.dataset.initials = initials;
  node.dataset.picture = picture || '';
  node.replaceChildren(initials);
  if (picture) node.append(pictureImage(picture, 'avatar-image'));
}

export function pictureImage(source, className) {
  const image = element('img', className);
  image.alt = '';
  image.src = source;
  image.addEventListener('error', () => { image.hidden = true; });
  return image;
}

export function avatar(name, key, accent, picture) {
  const node = element('span', 'avatar');
  updateAvatar(node, name, key, accent, picture);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

export function color(key) {
  return (key || '').split('').reduce((number, value) => number + value.charCodeAt(0), 0) % 5;
}

export function toast(message) {
  const node = $('toast');
  clearTimeout(toastTimer);
  node.textContent = message;
  node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

export function notifyAttention(title, message) {
  toast(`${title} · ${message}`);
  if (!document.hidden || !preferences.desktopNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification(title, { body: message });
    notification.onclick = () => { window.focus(); notification.close(); };
  } catch {
    // In-app reminders stay available when the browser cannot show a notification.
  }
}

export async function api(path, { access, input, keepalive = false } = {}) {
  const headers = {};
  if (access) headers.Authorization = `Bearer ${access}`;
  if (input) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api${path}`, {
    method: input ? 'POST' : 'GET', headers, keepalive, signal: AbortSignal.timeout(16_000),
    body: input ? JSON.stringify(input) : undefined,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    if (result?.code === 'username_required') showUsernameSetup();
    const error = new Error(result?.error || 'Couldn’t reach the room. Try again in a moment.');
    error.status = response.status;
    error.code = result?.code;
    throw error;
  }
  return result;
}

export function showDialog(title, markup) {
  closeMemberCard();
  $('dialog-title').textContent = title;
  $('dialog-body').innerHTML = markup;
  if (!$('dialog').open) $('dialog').showModal();
  const firstField = $('dialog-body').querySelector('input');
  (firstField ?? $('close-dialog')).focus();
}

export function dialogForm(fields, submit, intro = '', notice = '') {
  return `${intro ? `<p>${intro}</p>` : ''}<form class="dialog-form"><div class="form-error" role="alert" hidden></div>${fields}
    ${notice}
    <div class="dialog-actions"><button class="button outline" type="button" data-dismiss>Cancel</button>
    <button class="button primary" type="submit">${submit}</button></div></form>`;
}

export function handleForm(action) {
  const form = $('dialog-body').querySelector('form');
  form.querySelector('[data-dismiss]')?.addEventListener('click', closeDialog);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    const error = form.querySelector('.form-error');
    error.hidden = true;
    submit.disabled = true;
    try {
      await action(new FormData(form));
    } catch (failure) {
      error.textContent = failure.message === 'Failed to fetch' ? 'Couldn’t connect. Try again in a moment.' : failure.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}

export function closeDialog() {
  if ($('dialog').open) $('dialog').close();
}

export function closeMemberCard() {
  const popup = $('member-card');
  if (popup.matches(':popover-open')) popup.hidePopover();
}
