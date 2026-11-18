// Creating, joining and restoring rooms, and room invite links.
import { saveStorage, saved, state } from './state.js';
import { $, api, closeDialog, dialogForm, element, handleForm, icon, showDialog, toast } from './ui.js';
import { openRoom, renderNav } from './app.js';

export function inviteCode(value) {
  const text = (value || '').trim();
  return text.match(/^[a-f0-9]{48}$/)?.[0] ?? text.match(/(?:^|#)join=([a-f0-9]{48})$/)?.[1];
}

export function removeInviteFragment() {
  if (location.hash.startsWith('#join=')) history.replaceState(null, '', location.pathname + location.search);
}

export function showRoomForm({ title, invite, joining = false } = {}) {
  const displayName = '<label class="field">Your display name<input name="name" maxlength="32" required placeholder="e.g. Alex" autocomplete="nickname"></label>';
  const roomName = '<label class="field">Room name<input name="title" maxlength="60" required placeholder="e.g. Friday game night" autocomplete="off"></label><label class="field">Description <small>Optional</small><textarea name="description" rows="2" maxlength="260" placeholder="What is this room for?"></textarea></label>';
  const inviteField = '<label class="field">Invite link<input name="invite" maxlength="600" required placeholder="Paste the link you received" autocomplete="off"></label>';
  const action = joining ? 'Join room' : 'Create room';
  showDialog(action, dialogForm(
    (joining ? (invite ? '' : inviteField) : roomName) + displayName,
    action,
    joining ? 'Choose the name people in this room will see.' : 'Create a room and share its invite link with the group.',
    '<p class="form-notice">By continuing, you agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a>.</p>',
  ));
  const form = $('dialog-body').querySelector('form');
  form.elements.name.value = state.selfProfile?.displayName || saved.name || state.selfProfile?.username?.split('#')[0] || '';
  form.elements.name.readOnly = Boolean(state.selfProfile?.displayName);
  if (!joining && title) form.elements.title.value = title;
  handleForm(async data => {
    const name = data.get('name');
    const code = invite ?? inviteCode(data.get('invite'));
    if (joining && !code) throw new Error('Paste a valid Lobby invite link.');
    const existing = joining && saved.rooms.find(room => room.invite === code);
    let room = existing || await api(joining ? '/join' : '/rooms', {
      input: joining ? { name, invite: code } : { name, title: data.get('title'), description: data.get('description') },
    });
    if (!existing) {
      const known = saved.rooms.find(entry => entry.id === room.id);
      if (known) {
        Object.assign(known, { invite: room.invite, inviteVersion: room.inviteVersion });
        room = known;
        saveStorage();
      } else saved.rooms.unshift(room);
    }
    saved.name = room.name;
    removeInviteFragment();
    closeDialog();
    openRoom(room);
    toast(joining ? `Joined ${room.title}` : 'Room created. Use Invite people to share it.');
  });
}

export async function restoreAccess(room) {
  const restored = await api('/my-rooms/restore', { input: { roomId: room.id } });
  Object.assign(room, { access: restored.access, memberId: restored.memberId, name: restored.name, host: restored.host });
  if (!room.invite) room.inviteVersion = restored.inviteVersion;
  saveStorage();
  return room;
}

// The room list lives in this browser's storage. Signed-in accounts also get back
// rooms they joined in another browser, on another device, or before storage was cleared.
export async function syncAccountRooms() {
  if (!state.selfProfile?.username) return;
  let rooms;
  try {
    ({ rooms } = await api('/my-rooms'));
  } catch {
    return;
  }
  let added = 0;
  for (const entry of rooms) {
    if (saved.rooms.some(room => room.id === entry.id)) continue;
    try {
      const room = await restoreAccess({ ...entry });
      if (saved.rooms.some(known => known.id === room.id)) continue;
      saved.rooms.push(room);
      added++;
    } catch {
      // A room that can't be restored now stays reachable through its invite link.
    }
  }
  if (!added) return;
  saveStorage();
  renderNav();
}

export function showInvite() {
  if (!state.session) return;
  const current = state.session;
  const { room } = current;
  const valid = Boolean(room.invite) && (room.inviteVersion ?? 0) === current.inviteVersion;
  const url = new URL('/', location.origin);
  url.hash = `join=${room.invite}`;
  showDialog('Invite people', valid ? `<p>Share this link with people you want in the room.</p>
    <div class="dialog-form"><label class="field">Room invite link<input id="invite-link" readonly></label>
    <div class="dialog-actions" id="invite-actions"><button class="button primary" id="copy-invite">${icon('copy')} Copy link</button></div></div>`
    : `<p>${room.invite ? 'The invite link was replaced.' : 'This browser doesn’t have the invite link.'} Ask the room host for the current link.</p><div class="dialog-actions below" id="invite-actions"></div>`);
  if (room.host) {
    const replace = element('button', 'button outline', 'Replace invite link');
    replace.addEventListener('click', () => showInviteReplacement(current));
    $('invite-actions').prepend(replace);
  }
  if (!valid) return;
  const input = $('invite-link');
  input.value = url.href;
  input.select();
  $('copy-invite').addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(url.href);
      button.textContent = 'Link copied';
    } catch {
      input.focus();
      input.select();
      button.textContent = 'Copy the selected link';
    }
  });
}

function showInviteReplacement(current) {
  const version = current.inviteVersion;
  showDialog('Replace invite link?', dialogForm('', 'Replace link', 'The previous link will expire. People who have already joined can keep using the room.'));
  handleForm(async () => {
    const { room } = current;
    const updated = await api(`/rooms/${room.id}/replace-invite`, { access: room.access, input: { version } });
    Object.assign(room, updated);
    current.inviteVersion = updated.inviteVersion;
    saveStorage();
    if (state.session === current) showInvite();
    toast('Invite link replaced.');
  });
}
