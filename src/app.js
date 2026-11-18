import { bindPicture, pictureField } from './pictures.js';
import { createVoiceController } from './voice.js';
import { createRoomBoard } from './board.js';
import { formatContent } from './formatting.js';
import { createSocial } from './social.js';

const $ = id => document.getElementById(id);
const storageKey = 'duo-chat-rooms-v1';
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });
const narrowScreen = window.matchMedia('(max-width: 950px)');
const saved = readStorage();
let admin = false;
let selfProfile;
let providers = {};
let session;
let usernameSetup = false;
let refreshTimer;
let toastTimer;
let memberCardAnchorTop = 0;
let mentionSuggestions;
const drafts = new Map(Object.entries(saved.drafts ?? {}));
const preferences = { compact: false, largeText: false, enterSends: true, desktopNotifications: false, ...saved.preferences };
let bookmarks = Array.isArray(saved.bookmarks) ? saved.bookmarks.slice(0, 40) : [];
const voice = createVoiceController(api, renderVoiceDock, toast);
const roomBoard = createRoomBoard({
  api, element, icon, showDialog, dialogForm, handleForm, closeDialog, toast,
  getSession: () => session,
  getDraft: () => $('message-input').value,
  showMessage: showHistoryResult,
  remind: showReminder,
});
const social = createSocial({
  api, element, avatar, toast, showDialog, dialogForm, handleForm, closeDialog,
  getProfile: () => selfProfile,
  enterSends: () => preferences.enterSends,
  onOpen: showSocial,
  notify: notifyAttention,
  showProfile: (person, trigger) => showMemberProfile({ ...person, id: person.username, online: false, activity: { connections: person.shareActivity ? person.connections || {} : {}, game: person.shareActivity ? person.game : '', music: person.shareActivity ? person.music : '' } }, trigger, false),
});
const pendingMessages = new Map();
const failedMessages = new Map();
const replyDrafts = new Map();
const imageDrafts = new Map();
const reactionOptions = [['👍', 'Thumbs up'], ['💜', 'Purple heart'], ['😂', 'Laugh'], ['🎉', 'Celebrate'], ['👀', 'Eyes'], ['🔥', 'Fire']];

const starters = {
  'Game night': [
    ['game', 'Play trivia', '@ChatGPT Host a group trivia game. Ask one question at a time and wait for our answers.'],
    ['spark', '20 Questions', '@ChatGPT Host 20 Questions. Secretly pick an object and let each of us take turns asking yes-or-no questions.'],
  ],
  Brainstorm: [
    ['bulb', 'Brainstorm together', '@ChatGPT Help us run a brainstorm. Ask what problem we want to solve, then invite each person to share an idea.'],
    ['spark', 'Find a new angle', '@ChatGPT Give us a creative exercise we can do together in this chat.'],
  ],
  default: [
    ['chat', 'Break the ice', '@ChatGPT Give us one fun icebreaker question everyone can answer.'],
    ['game', 'Play trivia', '@ChatGPT Host a group trivia game. Ask one question at a time and wait for our answers.'],
    ['bulb', 'Brainstorm', '@ChatGPT Help us brainstorm an idea together. Start by asking what we’re working on.'],
  ],
};

function readStorage() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(value?.rooms)) return value;
  } catch {
    // A new profile also works with storage disabled.
  }
  return { rooms: [], active: null, name: '' };
}

function saveStorage() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    toast('This browser couldn’t save your rooms for next time.');
  }
}

function icon(id) {
  return `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateAvatar(node, name, key, accent, picture) {
  const initials = Array.from(name.split(/\s+/).slice(0, 2), word => Array.from(word)[0]).join('').toUpperCase();
  node.dataset.color = accent ?? color(key);
  if (node.dataset.initials === initials && node.dataset.picture === (picture || '')) return;
  node.dataset.initials = initials;
  node.dataset.picture = picture || '';
  node.replaceChildren(initials);
  if (picture) node.append(pictureImage(picture, 'avatar-image'));
}

function pictureImage(source, className) {
  const image = element('img', className);
  image.alt = '';
  image.src = source;
  image.addEventListener('error', () => { image.hidden = true; });
  return image;
}

function avatar(name, key, accent, picture) {
  const node = element('span', 'avatar');
  updateAvatar(node, name, key, accent, picture);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function color(key) {
  return (key || '').split('').reduce((number, value) => number + value.charCodeAt(0), 0) % 5;
}

function toast(message) {
  const node = $('toast');
  clearTimeout(toastTimer);
  node.textContent = message;
  node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

function notifyAttention(title, message) {
  toast(`${title} · ${message}`);
  if (!document.hidden || !preferences.desktopNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification(title, { body: message });
    notification.onclick = () => { window.focus(); notification.close(); };
  } catch {
    // In-app reminders stay available when the browser cannot show a notification.
  }
}

function showReminder(roomId, plan) {
  const seen = saved.seenReminders ?? [];
  if (seen.includes(plan.id)) return;
  saved.seenReminders = [...seen.slice(-99), plan.id];
  saveStorage();
  const title = saved.rooms.find(room => room.id === roomId)?.title || 'Room reminder';
  notifyAttention(title, plan.text);
}

function showRoomBoard(tab = 'overview') {
  if (!session) return;
  sendTyping(session, false);
  clearMentionSuggestions();
  roomBoard.open(tab);
  setPage(session.room);
}

function showSocial() {
  clearTimeout(refreshTimer);
  sendTyping(session, false);
  clearMentionSuggestions();
  roomBoard.close();
  session = null;
  saved.active = null;
  saveStorage();
  social.open();
  setPage();
}

async function api(path, { access, input, keepalive = false } = {}) {
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

function showDialog(title, markup) {
  closeMemberCard();
  $('dialog-title').textContent = title;
  $('dialog-body').innerHTML = markup;
  if (!$('dialog').open) $('dialog').showModal();
  const firstField = $('dialog-body').querySelector('input');
  (firstField ?? $('close-dialog')).focus();
}

function dialogForm(fields, submit, intro = '', notice = '') {
  return `${intro ? `<p>${intro}</p>` : ''}<form class="dialog-form"><div class="form-error" role="alert" hidden></div>${fields}
    ${notice}
    <div class="dialog-actions"><button class="button outline" type="button" data-dismiss>Cancel</button>
    <button class="button primary" type="submit">${submit}</button></div></form>`;
}

function handleForm(action) {
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

function closeDialog() {
  if ($('dialog').open) $('dialog').close();
}

function inviteCode(value) {
  const text = (value || '').trim();
  return text.match(/^[a-f0-9]{48}$/)?.[0] ?? text.match(/(?:^|#)join=([a-f0-9]{48})$/)?.[1];
}

function removeInviteFragment() {
  if (location.hash.startsWith('#join=')) history.replaceState(null, '', location.pathname + location.search);
}

function showRoomForm({ title, invite, joining = false } = {}) {
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
  form.elements.name.value = selfProfile?.displayName || saved.name || selfProfile?.username?.split('#')[0] || '';
  form.elements.name.readOnly = Boolean(selfProfile?.displayName);
  if (!joining && title) form.elements.title.value = title;
  handleForm(async data => {
    const name = data.get('name');
    const code = invite ?? inviteCode(data.get('invite'));
    if (joining && !code) throw new Error('Paste a valid Duo Chat invite link.');
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

function showInvite() {
  if (!session) return;
  const current = session;
  const { room } = current;
  const valid = (room.inviteVersion ?? 0) === current.inviteVersion;
  const url = new URL('/', location.origin);
  url.hash = `join=${room.invite}`;
  showDialog('Invite people', valid ? `<p>Share this link with people you want in the room.</p>
    <div class="dialog-form"><label class="field">Room invite link<input id="invite-link" readonly></label>
    <div class="dialog-actions" id="invite-actions"><button class="button primary" id="copy-invite">${icon('copy')} Copy link</button></div></div>`
    : '<p>The invite link was replaced. Ask the room host for the current link.</p><div class="dialog-actions below" id="invite-actions"></div>');
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
    if (session === current) showInvite();
    toast('Invite link replaced.');
  });
}

function showHelp() {
  showDialog('How it works', `<ul>
    <li>Create a room or join one from an invite.</li>
    <li>Use text channels to keep different conversations in the same room. Everyone in the room can read and send messages in its channels.</li>
    <li>The host can connect an OpenAI API key. Then anyone can mention <strong>@ChatGPT</strong> to get a shared reply.</li>
  </ul>`);
}

function applyOwnProfile(data) {
  admin = data.admin;
  selfProfile = data.profile;
  providers = data.providers;
  renderProfile();
  if (selfProfile?.username) social.start();
}

const usernameField = `<label class="field">Username<input name="username" pattern="[A-Za-z0-9_]{3,24}" maxlength="24" placeholder="e.g. moonlight" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="username-help" required><small id="username-help">Choose 3–24 letters, numbers, or underscores. Duo Chat adds an available four-digit tag.</small></label>`;

function showUsernameSetup() {
  if (usernameSetup) return;
  usernameSetup = true;
  clearTimeout(refreshTimer);
  toggleSidebar(false);
  showDialog('Choose your username', dialogForm(usernameField, 'Continue', 'Set the username people will see on your profile.'));
  $('close-dialog').hidden = true;
  $('dialog-body').querySelector('[data-dismiss]').remove();
  handleForm(async data => {
    applyOwnProfile(await api('/profile/username', { input: { username: data.get('username') } }));
    usernameSetup = false;
    $('close-dialog').hidden = false;
    closeDialog();
    if (session && !location.hash) void refresh(session);
    else restorePage();
  });
}

const accentOptions = '<option value="0">Lavender</option><option value="1">Mint</option><option value="2">Rose</option><option value="3">Amber</option><option value="4">Blue</option>';

function paintCover(cover, accent, source) {
  cover.dataset.color = accent;
  cover.replaceChildren();
  if (source) cover.append(pictureImage(source, 'profile-banner'));
}

function profileDetailsEditor(form, details) {
  const list = form.querySelector('#profile-details-edit');
  const add = form.querySelector('#add-profile-detail');
  function addRow(detail = {}) {
    const row = element('div', 'profile-detail-row');
    row.innerHTML = `<input aria-label="Detail label" placeholder="e.g. Interests" maxlength="25" required data-label>
      <input aria-label="Detail value" placeholder="What to show" maxlength="100" required data-value>
      <button type="button" class="icon-button" title="Remove detail" aria-label="Remove detail">${icon('close')}</button>`;
    row.querySelector('[data-label]').value = detail.label || '';
    row.querySelector('[data-value]').value = detail.value || '';
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      add.disabled = false;
      add.focus();
    });
    list.append(row);
    add.disabled = list.childElementCount >= 5;
    return row;
  }
  details.forEach(addRow);
  add.addEventListener('click', () => addRow().querySelector('input').focus());
  return () => Array.from(list.children, row => ({ label: row.querySelector('[data-label]').value, value: row.querySelector('[data-value]').value }));
}

async function showProfileEditor() {
  showDialog('Edit your profile', '<p id="profile-loading">Loading your profile…</p>');
  const marker = $('profile-loading');
  try {
    const data = await api('/profile');
    if (!marker.isConnected) return;
    if (!data.signedIn) {
      showDialog('Edit your profile', '<p>Sign in to save a profile you can use across your rooms.</p><div class="dialog-actions below"><a class="button primary" href="/signin-with-chatgpt" target="_top">Sign in</a></div>');
      return;
    }
    applyOwnProfile(data);
    if (!selfProfile.username) {
      showUsernameSetup();
      return;
    }
  } catch (error) {
    if (marker.isConnected) marker.textContent = error.message;
    return;
  }

  const gameHint = providers.steam ? 'Use your own public Steam profile for live game status.' : 'Steam profile link. Live game status needs site setup.';
  const musicHint = providers.lastfm ? 'Use your own Last.fm profile for live track updates.' : 'Last.fm profile link. Live track updates need site setup.';
  const fields = `
    <div class="profile-preview profile-card"><div class="profile-cover" id="preview-cover"></div><span class="avatar" id="preview-avatar"></span><div><strong id="preview-name"></strong><small id="preview-username" hidden></small></div></div>
    <fieldset class="profile-section"><legend>Pictures</legend>
      ${pictureField('Profile picture', 'avatar', 'Cropped to a square')}
      ${pictureField('Profile banner', 'banner', 'Cropped to a wide image')}
    </fieldset>
    <div class="profile-grid">
      <label class="field">Display name<input name="displayName" maxlength="32" autocomplete="nickname" required></label>
      <label class="field">Profile accent<select name="color">${accentOptions}</select></label>
    </div>
    ${usernameField}
    <label class="field">About me<textarea name="bio" rows="2" maxlength="160" placeholder="Write a short bio"></textarea></label>
    <fieldset class="profile-section"><legend>Profile details</legend>
      <p class="profile-field-hint">Add up to five things you want room members to know.</p><div id="profile-details-edit"></div>
      <button type="button" class="button outline add-detail" id="add-profile-detail">${icon('plus')} Add detail</button>
    </fieldset>
    <fieldset class="profile-section"><legend>Activity</legend>
      <div class="profile-grid">
        <label class="field">Playing<input name="game" maxlength="80" placeholder="e.g. Minecraft" autocomplete="off"></label>
        <label class="field">Listening to<input name="music" maxlength="100" placeholder="Song and artist" autocomplete="off"></label>
      </div>
    </fieldset>
    <fieldset class="profile-section"><legend>Connected profiles</legend>
      <label class="field">Steam<input name="steam" maxlength="500" placeholder="Steam profile link or SteamID64" autocomplete="off"><small>${gameHint}</small></label>
      <label class="field">Last.fm<input name="lastfm" maxlength="500" placeholder="Last.fm username or profile link" autocomplete="off"><small>${musicHint}</small></label>
      <label class="field">Spotify<input name="spotify" maxlength="500" placeholder="Spotify profile link" autocomplete="off"><small>Profile link</small></label>
    </fieldset>
    <label class="profile-share"><input name="shareActivity" type="checkbox"><span><strong>Share activity and connected profiles</strong><small>People in your rooms can see your status and links. A live provider can check public activity while you’re active in a room.</small></span></label>`;
  showDialog('Edit your profile', dialogForm(fields, 'Save profile'));
  const form = $('dialog-body').querySelector('form');
  const originalUsername = selfProfile.username;
  const originalBase = originalUsername.split('#')[0];
  const values = { ...selfProfile.connections, displayName: selfProfile.displayName || session?.room.name || saved.name || originalBase, username: originalBase, bio: selfProfile.bio, color: selfProfile.color, game: selfProfile.game, music: selfProfile.music };
  for (const [field, value] of Object.entries(values)) form.elements[field].value = value;
  form.elements.shareActivity.checked = selfProfile.shareActivity;
  if (selfProfile.usernameAssigned) {
    form.elements.username.readOnly = true;
    form.querySelector('#username-help').textContent = `${originalUsername} is assigned to your account.`;
  }
  let avatarSource = selfProfile.avatar;
  let coverSource = selfProfile.banner;
  const updatePreview = () => {
    const name = form.elements.displayName.value.trim() || 'Your profile';
    updateAvatar(form.querySelector('#preview-avatar'), name, '', form.elements.color.value, avatarSource);
    form.querySelector('#preview-name').textContent = name;
    const username = form.querySelector('#preview-username');
    const base = form.elements.username.value.trim().toLowerCase();
    username.textContent = base === originalBase ? originalUsername : base;
    username.hidden = !username.textContent;
  };
  const updateCover = () => paintCover(form.querySelector('#preview-cover'), form.elements.color.value, coverSource);
  form.elements.displayName.addEventListener('input', updatePreview);
  form.elements.username.addEventListener('input', updatePreview);
  form.elements.color.addEventListener('change', () => { updatePreview(); updateCover(); });
  const readAvatar = bindPicture(form, 'avatar', avatarSource, [256, 256], 180_000, source => { avatarSource = source; updatePreview(); });
  const readBanner = bindPicture(form, 'banner', coverSource, [1080, 360], 600_000, source => { coverSource = source; updateCover(); });
  const readDetails = profileDetailsEditor(form, selfProfile.details);
  form.elements.displayName.focus();
  handleForm(async values => {
    const input = Object.fromEntries(values);
    if (input.username.trim().toLowerCase() === originalBase) delete input.username;
    input.color = Number(input.color);
    input.shareActivity = values.has('shareActivity');
    input.details = readDetails();
    [input.avatarImage, input.bannerImage] = await Promise.all([readAvatar(), readBanner()]);
    applyOwnProfile(await api('/profile', { input }));
    if (form.isConnected) closeDialog();
    toast('Profile saved.');
    if (session) {
      session.nextActivityRefresh = 0;
      void refresh(session);
    }
  });
}

function showChannelForm() {
  if (!session?.canManage) return;
  const { room, channels } = session;
  const fields = '<label class="field">Channel name<input name="name" maxlength="30" placeholder="e.g. game-night" required autocomplete="off"></label>' + channelGroupField();
  showDialog('Create a text channel', dialogForm(fields, 'Create channel', 'Everyone in the room can see and use this channel.'));
  suggestChannelGroups(session);
  handleForm(async data => {
    const { name, section } = await api(`/rooms/${room.id}/channels`, { access: room.access, input: { name: data.get('name'), section: data.get('section') } });
    closeDialog();
    if (session?.room.id === room.id) {
      session.channels = [...new Set([...channels, ...session.channels, name])];
      if (section) session.sections = { ...session.sections, [name]: section };
      openRoom(room, name);
    }
    toast(`#${name} created.`);
  });
}

function renderChannelDetails() {
  const channel = session?.channel;
  const { topic = '', slowSeconds = 0 } = session?.channelSettings?.[channel] ?? {};
  const note = $('channel-topic');
  note.hidden = !topic || roomBoard.isOpen;
  note.textContent = topic;
  note.title = topic;
  $('slow-mode-note').hidden = !slowSeconds;
  $('slow-mode-note').textContent = slowSeconds ? `Slow mode · ${slowSeconds}s between posts` : '';
}

function toggleChannelPreference(room, name, channel) {
  const selected = room[name] ?? [];
  room[name] = selected.includes(channel) ? selected.filter(entry => entry !== channel) : [...selected, channel];
  saveStorage();
  renderChannels();
}

function showChannelDetails() {
  if (!session) return;
  const current = session;
  const { room, channel, canManage } = current;
  const { topic = '', slowSeconds = 0 } = current.channelSettings[channel] ?? {};
  showDialog('Channel details', '<div id="channel-overview"></div><div class="message-options channel-tools" id="channel-tools"></div>');
  const overview = $('channel-overview');
  overview.append(element('h3', '', `#${channel}`), element('p', 'channel-overview-topic', topic || 'No topic set.'));
  if (slowSeconds) overview.append(element('p', 'slow-mode-note', `Slow mode allows one post every ${slowSeconds} seconds. Room hosts and admins are exempt.`));
  const list = $('channel-tools');
  const add = (label, glyph, action) => {
    const button = element('button', 'button outline');
    button.innerHTML = icon(glyph);
    button.append(label);
    button.addEventListener('click', action);
    list.append(button);
    return button;
  };
  const isFavorite = () => room.favoriteChannels?.includes(channel);
  const favorite = add(isFavorite() ? 'Remove channel from favorites' : 'Favorite channel', 'star', () => {
    toggleChannelPreference(room, 'favoriteChannels', channel);
    favorite.lastChild.textContent = isFavorite() ? 'Remove channel from favorites' : 'Favorite channel';
  });
  const isMuted = () => room.mutedChannels?.includes(channel);
  const mute = add(isMuted() ? 'Unmute channel' : 'Mute channel', 'bell-off', () => {
    toggleChannelPreference(room, 'mutedChannels', channel);
    mute.lastChild.textContent = isMuted() ? 'Unmute channel' : 'Mute channel';
    toast(isMuted() ? 'Channel muted. Mentions still appear in your inbox.' : 'Channel unmuted.');
  });
  add('Media gallery', 'image', showGallery);
  add('Pinned messages', 'pin', showPins);
  if (canManage) add('Edit topic and slow mode', 'edit', () => editChannelSettings(current));
}

function editChannelSettings(current) {
  const { room, channel } = current;
  const { topic = '', slowSeconds = 0 } = current.channelSettings[channel] ?? {};
  const fields = `<label class="field">Topic<input name="topic" maxlength="120" placeholder="What is this channel for?"></label>
    <label class="field">Slow mode<select name="slowSeconds"><option value="0">Off</option><option value="5">5 seconds</option><option value="10">10 seconds</option>
    <option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option></select>
    <small>Sets how long members wait between posts. Room hosts and admins are exempt.</small></label>`;
  showDialog('Channel settings', dialogForm(fields, 'Save channel'));
  const { elements } = $('dialog-body').querySelector('form');
  elements.topic.value = topic;
  elements.slowSeconds.value = slowSeconds;
  handleForm(async values => {
    const settings = await api(`/rooms/${room.id}/channel-settings`, {
      access: room.access, input: { channel, topic: values.get('topic'), slowSeconds: Number(values.get('slowSeconds')) },
    });
    if (session?.room === room) {
      session.channelSettings[channel] = settings;
      renderChannelDetails();
      void refresh(session);
    }
    closeDialog();
    toast('Channel settings saved.');
  });
}

function showStatusForm() {
  toggleSidebar(false);
  if (!selfProfile?.username) {
    void showProfileEditor();
    return;
  }
  const fields = `<label class="field">Status<input name="status" maxlength="80" placeholder="e.g. Away for dinner"></label>
    <label class="field">Clear after<select name="minutes"><option value="0">Keep until I clear it</option><option value="60">1 hour</option>
    <option value="240">4 hours</option><option value="1440">1 day</option></select></label>`;
  showDialog('Set a status', dialogForm(fields, 'Save status', 'Room members can see your status. Leave it blank to clear it.'));
  $('dialog-body').querySelector('form').elements.status.value = selfProfile.status ?? '';
  handleForm(async data => {
    const { status } = await api('/profile/status', { input: { status: data.get('status'), minutes: Number(data.get('minutes')) } });
    selfProfile.status = status;
    closeDialog();
    toast(status ? 'Status set.' : 'Status cleared.');
    if (session) void refresh(session);
  });
}

function voiceChannelName(name) {
  return name === 'lounge' ? 'Lounge' : name;
}

function showVoiceChannelForm() {
  if (!session?.canManage) return;
  const { room } = session;
  showDialog('Create a voice channel', dialogForm(
    '<label class="field">Channel name<input name="name" maxlength="30" placeholder="e.g. game-night" required autocomplete="off"></label>',
    'Create channel',
  ));
  handleForm(async data => {
    const { name } = await api(`/rooms/${room.id}/voice-channels`, { access: room.access, input: { name: data.get('name') } });
    closeDialog();
    if (session?.room === room && !session.voiceChannels.some(channel => channel.name === name)) {
      session.voiceChannels = [...session.voiceChannels, { name, people: 0 }];
      renderVoiceChannels();
      void refresh(session);
    }
    toast(`${name} created.`);
  });
}

function renderVoiceChannels() {
  const list = $('voice-channel-list');
  $('add-voice-channel').hidden = !session?.canManage;
  const channels = session?.voiceChannels ?? [];
  const activeChannel = voice.active && voice.active.room === session?.room ? voice.active.channel : '';
  const key = JSON.stringify([channels, activeChannel, session?.room.id]);
  if (list.dataset.key === key) return;
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.channel : null;
  list.dataset.key = key;
  list.replaceChildren();
  for (const { name, people } of channels) {
    const item = element('button', 'nav-button channel-button voice-channel');
    item.dataset.channel = name;
    item.innerHTML = icon('speaker');
    item.append(element('span', '', voiceChannelName(name)));
    if (people) item.append(element('small', 'voice-count', people));
    if (name === activeChannel) item.classList.add('voice-active');
    item.setAttribute('aria-label', `${voiceChannelName(name)} voice channel, ${people} joined${name === activeChannel ? ', connected' : ''}`);
    const { room } = session;
    item.addEventListener('click', () => showJoinVoice(room, name));
    list.append(item);
    if (name === focused) item.focus();
  }
}

function showJoinVoice(room, channel) {
  if (voice.active?.room === room && voice.active.channel === channel) {
    showVoiceDetails();
    return;
  }
  showDialog(voiceChannelName(channel), `<p id="voice-join-description"></p><p class="form-error" id="voice-join-error" role="alert" hidden></p>
    <div class="dialog-actions below"><button class="button outline" id="join-muted">Join muted</button><button class="button primary" id="join-voice">Join voice</button></div>`);
  $('voice-join-description').textContent = `Talk with people in ${room.title}. Your browser will ask for microphone access.`;
  const error = $('voice-join-error');
  const join = $('join-voice');
  const muted = $('join-muted');
  for (const button of [join, muted]) button.addEventListener('click', async () => {
    join.disabled = muted.disabled = true;
    error.hidden = true;
    try {
      await voice.join(room, channel, button === muted, () => $('dialog').open && join.isConnected);
      if (join.isConnected) showVoiceDetails();
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally {
      join.disabled = muted.disabled = false;
    }
  });
  join.focus();
}

function showVoiceDetails() {
  if (!voice.active) return;
  showDialog('Voice controls', `<div class="voice-details"><strong id="voice-detail-title"></strong><p id="voice-detail-status" role="status"></p>
    <ul class="voice-roster" id="voice-roster" aria-label="People in voice"></ul>
    <button class="button outline" id="voice-enable-audio" hidden>Enable audio</button>
    <div class="dialog-actions below"><button class="button outline" id="voice-detail-mute"></button><button class="button outline" id="voice-detail-deafen"></button><button class="button danger" id="voice-detail-leave">Leave voice</button></div></div>`);
  $('voice-detail-mute').addEventListener('click', voice.toggleMute);
  $('voice-detail-deafen').addEventListener('click', voice.toggleDeafen);
  $('voice-detail-leave').addEventListener('click', voice.leave);
  $('voice-enable-audio').addEventListener('click', voice.resumeAudio);
  renderVoiceDock(voice.active);
}

function renderVoiceDock(call) {
  $('voice-dock').hidden = !call;
  $('voice-quick').hidden = !call;
  renderVoiceChannels();
  if (!call) {
    if ($('voice-roster')) closeDialog();
    return;
  }
  const title = `${voiceChannelName(call.channel)} · ${call.room.title}`;
  $('voice-dock-text').textContent = title;
  $('voice-dock-text').title = title;
  const muted = call.muted || call.deafened;
  const update = (id, pressed, label) => {
    const button = $(id);
    button.setAttribute('aria-pressed', String(pressed));
    button.setAttribute('aria-label', label);
    button.title = label;
    return button;
  };
  const muteLabel = muted ? 'Unmute microphone' : 'Mute microphone';
  const deafenLabel = call.deafened ? 'Undeafen' : 'Deafen';
  update('mute-voice', muted, muteLabel).disabled = call.deafened;
  update('deafen-voice', call.deafened, deafenLabel);
  const roster = $('voice-roster');
  if (!roster) return;
  $('voice-detail-title').textContent = title;
  const peers = [...call.connections.values()];
  const audioBlocked = peers.some(peer => peer.audioBlocked);
  let status = 'Waiting for others to join';
  if (call.networkError) status = 'Reconnecting to voice';
  else if (call.deafened) status = 'Voice audio and microphone muted';
  else if (audioBlocked) status = 'Select Enable audio to hear the channel';
  else if (peers.some(peer => peer.failed || peer.connection.connectionState === 'failed')) status = 'Some audio connections failed. Try leaving and rejoining.';
  else if (peers.some(peer => peer.connection.connectionState !== 'connected')) status = 'Connecting audio';
  else if (peers.length) status = 'Voice connected';
  if ($('voice-detail-status').textContent !== status) $('voice-detail-status').textContent = status;
  $('voice-enable-audio').hidden = !audioBlocked || call.deafened;
  const mute = update('voice-detail-mute', muted, muteLabel);
  mute.disabled = call.deafened;
  mute.textContent = muted ? 'Unmute' : 'Mute';
  update('voice-detail-deafen', call.deafened, deafenLabel).textContent = deafenLabel;
  const lineup = call.peers.length ? call.peers : [{ id: call.id, name: 'You', muted, deafened: call.deafened }];
  const key = JSON.stringify(lineup);
  if (roster.dataset.key === key) return;
  roster.dataset.key = key;
  roster.replaceChildren(...lineup.map(peer => {
    const row = element('li');
    const name = peer.id === call.id && peer.name !== 'You' ? `${peer.name} (you)` : peer.name;
    row.append(element('span', '', name), element('small', '', peer.deafened ? 'Deafened' : peer.muted ? 'Muted' : 'In voice'));
    return row;
  }));
}

function channelGroupField() {
  return '<label class="field">Channel group<input name="section" maxlength="32" list="channel-group-options" placeholder="Leave blank for Text channels" autocomplete="off"><small>Choose an existing group or type a new name.</small></label><datalist id="channel-group-options"></datalist>';
}

function suggestChannelGroups(current) {
  const list = $('channel-group-options');
  for (const group of new Set(Object.values(current.sections))) {
    const option = document.createElement('option');
    option.value = group;
    list.append(option);
  }
}

function organizeChannels() {
  if (!session?.canManage) return;
  const current = session;
  const { room } = current;
  const channels = current.channels.filter(name => name !== 'general');
  if (!channels.length) return;
  const fields = '<label class="field">Text channel<select name="channel"></select></label>' + channelGroupField();
  showDialog('Organize channels', dialogForm(fields, 'Save group'));
  suggestChannelGroups(current);
  const form = $('dialog-body').querySelector('form');
  for (const name of channels) form.elements.channel.add(new Option(`#${name}`, name));
  if (channels.includes(current.channel)) form.elements.channel.value = current.channel;
  const update = () => { form.elements.section.value = Object.hasOwn(current.sections, form.elements.channel.value) ? current.sections[form.elements.channel.value] : ''; };
  form.elements.channel.addEventListener('change', update);
  update();
  form.elements.channel.focus();
  handleForm(async data => {
    await api(`/rooms/${room.id}/channel-group`, { access: room.access, input: { name: data.get('channel'), section: data.get('section') } });
    if (form.isConnected) closeDialog();
    if (session?.room.id === room.id) void refresh(session);
    toast('Channel group saved.');
  });
}

function applyRoomIdentity(room, identity) {
  const next = { title: identity.title, description: identity.description || '', accent: identity.accent ?? 0, icon: identity.icon || '' };
  if (Object.keys(next).every(key => room[key] === next[key])) return;
  Object.assign(room, next);
  saveStorage();
  if (session?.room.id === room.id) {
    $('room-title').textContent = `${room.title} · #${session.channel}`;
    document.title = `#${session.channel} · ${room.title} · Duo Chat`;
    renderNav();
  }
}

function showRoomInfo() {
  if (!session) return;
  const { room, members, channels, canManage, latest } = session;
  showDialog('Room overview', '<div id="room-info-content"></div><div class="dialog-actions below" id="room-info-actions"></div>');
  const panel = $('room-info-content');
  const title = element('div', 'profile-preview');
  const detail = element('div');
  detail.append(element('strong', '', room.title));
  detail.append(element('small', '', `${channels.length} text · ${session.voiceChannels.length} voice · ${members.length} ${members.length === 1 ? 'member' : 'members'}`));
  title.append(avatar(room.title, room.id, room.accent, room.icon), detail);
  panel.append(title);
  if (room.description) panel.append(element('p', 'member-bio', room.description));
  const actions = $('room-info-actions');
  const favorite = element('button', 'button outline', room.favorite ? 'Remove favorite' : 'Favorite room');
  favorite.addEventListener('click', () => {
    room.favorite = !room.favorite;
    saveStorage();
    renderNav();
    favorite.textContent = room.favorite ? 'Remove favorite' : 'Favorite room';
  });
  const markRead = element('button', 'button outline', 'Mark room read');
  markRead.addEventListener('click', () => {
    room.readThrough = { ...latest, ...(session?.room === room ? session.latest : {}) };
    saveStorage();
    renderChannels();
    closeDialog();
    toast('Room marked as read.');
  });
  actions.append(favorite, markRead);
  if (canManage) {
    const settings = element('button', 'button outline', 'Room settings');
    settings.addEventListener('click', showRoomSettings);
    actions.append(settings);
    const banned = element('button', 'button outline', 'Banned members');
    banned.addEventListener('click', showRoomBans);
    actions.append(banned);
  }
  const invite = element('button', 'button primary', 'Invite people');
  invite.addEventListener('click', showInvite);
  actions.append(invite);
}

function showRoomSettings() {
  if (!session?.canManage) return;
  const { room } = session;
  const fields = `<div class="profile-preview"><span class="avatar" id="room-preview-icon"></span><div><strong id="room-preview-title"></strong><small>Room icon</small></div></div>
    ${pictureField('Room icon', 'icon', 'Cropped to a square')}
    <label class="field">Room name<input name="title" maxlength="60" required></label>
    <label class="field">Description<textarea name="description" rows="3" maxlength="260"></textarea></label>
    <label class="field">Room accent<select name="accent">${accentOptions}</select></label>`;
  showDialog('Room settings', dialogForm(fields, 'Save room'));
  const form = $('dialog-body').querySelector('form');
  form.elements.title.value = room.title;
  form.elements.description.value = room.description || '';
  form.elements.accent.value = room.accent ?? 0;
  let picture = room.icon;
  const update = () => {
    const title = form.elements.title.value.trim() || 'Your room';
    updateAvatar(form.querySelector('#room-preview-icon'), title, room.id, form.elements.accent.value, picture);
    form.querySelector('#room-preview-title').textContent = title;
  };
  form.elements.title.addEventListener('input', update);
  form.elements.accent.addEventListener('change', update);
  const readIcon = bindPicture(form, 'icon', picture, [256, 256], 180_000, source => { picture = source; update(); });
  form.elements.title.focus();
  handleForm(async data => {
    const input = { ...Object.fromEntries(data), accent: Number(data.get('accent')), iconImage: await readIcon() };
    const identity = await api(`/rooms/${room.id}/settings`, { access: room.access, input });
    applyRoomIdentity(room, identity);
    if (form.isConnected) closeDialog();
    toast('Room settings saved.');
  });
}

function showRoomBan(member) {
  const current = session;
  if (!current?.canManage) return;
  showDialog('Ban from this room?', dialogForm('<label class="field">Reason (optional)<input name="reason" maxlength="160" placeholder="For your moderation records"></label>', 'Ban member', 'This removes their room access and voice connection. Hosts and admins can unban them from Room overview.'));
  $('dialog-body').prepend(element('p', 'social-confirm-name', member.name));
  handleForm(async form => {
    await api(`/rooms/${current.room.id}/ban`, { access: current.room.access, input: { memberId: member.id, banned: true, reason: form.get('reason') } });
    closeDialog();
    toast('Member banned from this room.');
    void refresh(current);
  });
}

async function showRoomBans() {
  const current = session;
  if (!current?.canManage) return;
  showDialog('Banned members', '<div id="room-ban-list"><p>Loading bans…</p></div>');
  const list = $('room-ban-list');
  try {
    const result = await api(`/rooms/${current.room.id}/bans`, { access: current.room.access });
    if (!list.isConnected) return;
    list.replaceChildren();
    if (!result.bans.length) list.append(element('p', '', 'No one is banned from this room.'));
    for (const member of result.bans) {
      const row = element('div', 'room-ban-row');
      const info = element('div');
      info.append(element('strong', '', member.name), element('small', '', member.username || 'Room member'));
      if (member.reason) info.append(element('p', '', member.reason));
      const button = element('button', 'button outline', 'Unban');
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api(`/rooms/${current.room.id}/ban`, { access: current.room.access, input: { memberId: member.id, banned: false } });
          if (list.isConnected) void showRoomBans();
          toast('Member unbanned. They can use their room access or the current invite.');
        } catch (error) { toast(error.message); button.disabled = false; }
      });
      row.append(info, button);
      list.append(row);
    }
  } catch (error) { if (list.isConnected) list.textContent = error.message; }
}

function showAiSettings() {
  if (!session) return;
  const current = session;
  if (!current.room.host) {
    showDialog('ChatGPT setup', '<p>Ask the room host to connect ChatGPT. Once connected, anyone in the room can use @ChatGPT.</p>');
    return;
  }
  const connected = current.aiConnected;
  const field = '<label class="field">OpenAI API key<input type="password" name="key" autocomplete="off" spellcheck="false" maxlength="270" placeholder="sk-…" required></label>';
  showDialog(connected ? 'Manage ChatGPT' : 'Connect ChatGPT', dialogForm(field, connected ? 'Replace key' : 'Connect',
    'Use a <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">project API key</a> with active OpenAI API billing. The key is encrypted for this room. A mention sends recent room messages to OpenAI and uses the host’s API quota.'));
  handleForm(async data => {
    const result = await api(`/rooms/${current.room.id}/ai`, { access: current.room.access, input: { key: data.get('key') } });
    if (session === current) {
      current.aiConnected = result.aiConnected;
      updateAi(current);
      closeDialog();
      toast('ChatGPT is connected. Mention @ChatGPT for a reply.');
    }
  });
  if (!connected) return;
  const actions = element('div', 'dialog-actions below');
  const disconnect = element('button', 'button outline', 'Disconnect ChatGPT');
  actions.append(disconnect);
  $('dialog-body').append(actions);
  disconnect.addEventListener('click', async () => {
    disconnect.disabled = true;
    try {
      await api(`/rooms/${current.room.id}/ai`, { access: current.room.access, input: { disconnect: true } });
      if (session === current) {
        current.aiConnected = false;
        updateAi(current);
        closeDialog();
        toast('ChatGPT disconnected.');
      }
    } catch (failure) {
      toast(failure.message);
    } finally {
      disconnect.disabled = false;
    }
  });
}

function orderedRooms() {
  return [...saved.rooms].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
}

function renderNav() {
  const active = session?.room;
  const list = $('room-list');
  const shortcuts = $('room-shortcuts');
  list.replaceChildren();
  shortcuts.replaceChildren();
  $('sidebar-title').textContent = active ? 'Rooms' : 'Duo Chat';
  $('brand').classList.toggle('selected', !active);
  $('home-navigation').hidden = Boolean(active);
  $('home-room-nav').hidden = Boolean(active);
  $('channel-nav').hidden = !active;
  $('room-hub').hidden = !active;
  if (active) {
    $('room-hub-icon').replaceChildren(avatar(active.title, active.id, active.accent, active.icon));
    $('room-hub-title').textContent = active.title;
    $('room-hub-description').textContent = active.description || 'Room overview';
    $('room-settings').hidden = !session.canManage;
  }
  $('home-button').classList.toggle('selected', !active && !social.isOpen);
  $('brand').classList.toggle('selected', !active && !social.isOpen);
  if (active || social.isOpen) $('home-button').removeAttribute('aria-current');
  else $('home-button').setAttribute('aria-current', 'page');
  if (!saved.rooms.length) list.append(element('p', 'no-rooms', 'Rooms you create or join appear here.'));
  for (const room of orderedRooms()) {
    const item = element('button', 'nav-button');
    item.innerHTML = icon(room.favorite ? 'star' : 'chat');
    item.append(element('span', '', room.title));
    if (room.id === active?.id) {
      item.classList.add('selected');
      item.setAttribute('aria-current', 'page');
    }
    item.addEventListener('click', () => openRoom(room));
    list.append(item);
    const shortcut = element('button', 'rail-button rail-room');
    shortcut.append(avatar(room.title, room.id, room.accent, room.icon));
    shortcut.title = room.favorite ? `${room.title} · Favorite` : room.title;
    shortcut.setAttribute('aria-label', `Open ${shortcut.title}`);
    shortcut.classList.toggle('favorite', Boolean(room.favorite));
    if (room.id === active?.id) {
      shortcut.classList.add('selected');
      shortcut.setAttribute('aria-current', 'page');
    }
    shortcut.addEventListener('click', () => openRoom(room));
    shortcuts.append(shortcut);
  }
  renderChannels();
  renderVoiceChannels();
  renderProfile();
}

function renderChannels() {
  const list = $('channel-list');
  list.replaceChildren();
  if (!session) return;
  const { room, channel, channels, sections, canManage } = session;
  $('add-channel').hidden = !canManage;
  $('organize-channels').hidden = !canManage || channels.length < 2;
  $('room-settings').hidden = !canManage;
  const favorites = channels.filter(name => room.favoriteChannels?.includes(name));
  const groups = new Map([['', { label: '', channels: [] }]]);
  for (const name of channels) {
    if (favorites.includes(name)) continue;
    const group = Object.hasOwn(sections, name) ? sections[name] : '';
    const key = group.toLowerCase();
    if (!groups.has(key)) groups.set(key, { label: group, channels: [] });
    groups.get(key).channels.push(name);
  }
  const results = [...groups.values()];
  if (favorites.length) results.unshift({ label: 'My favorites', channels: favorites });
  for (const { label, channels: grouped } of results) {
    if (!grouped.length) continue;
    const block = element('div', 'channel-group');
    if (label) block.append(element('h3', '', label));
    for (const name of grouped) {
      const item = element('button', 'nav-button channel-button');
      item.innerHTML = icon(favorites.includes(name) ? 'star' : 'hash');
      item.append(element('span', '', name));
      if (room.mutedChannels?.includes(name)) {
        item.classList.add('channel-muted');
        const muted = element('span', 'channel-muted-icon');
        muted.innerHTML = icon('bell-off');
        item.append(muted);
        item.setAttribute('aria-label', `${name}, muted`);
      } else if ((Number(session.latest[name]) || 0) > (Number(room.readThrough?.[name]) || 0)) {
        item.classList.add('unread');
        item.setAttribute('aria-label', `${name}, unread messages`);
      }
      if (name === channel && !roomBoard.isOpen) {
        item.classList.add('selected');
        item.setAttribute('aria-current', 'page');
      }
      item.addEventListener('click', () => openRoom(room, name));
      block.append(item);
    }
    list.append(block);
  }
}

function renderProfile() {
  const active = session?.room;
  const name = selfProfile?.displayName || active?.name || saved.name || selfProfile?.username?.split('#')[0] || 'Guest';
  const profile = $('profile-avatar');
  updateAvatar(profile, name, active?.memberId, selfProfile?.displayName ? selfProfile.color : null, selfProfile?.avatar);
  $('profile-name').textContent = name;
  const detail = $('profile-detail');
  detail.replaceChildren();
  if (admin) {
    detail.innerHTML = icon('shield');
    detail.append('Duo Chat admin');
  } else {
    detail.textContent = active ? (active.host ? 'Room host' : 'Room member') : 'My profile';
  }
}

function setPage(room) {
  closeMemberCard();
  $('room-view').hidden = !room || roomBoard.isOpen;
  $('board-view').hidden = !room || !roomBoard.isOpen;
  $('home-view').hidden = Boolean(room) || social.isOpen;
  $('social-view').hidden = !social.isOpen;
  $('friends-rail').classList.toggle('selected', social.isOpen);
  $('friends-button').classList.toggle('selected', social.isOpen);
  $('people-button').hidden = !room;
  $('search-room').hidden = !room;
  $('channel-pins').hidden = !room;
  $('channel-details').hidden = !room || roomBoard.isOpen;
  $('mentions-inbox').hidden = !room;
  renderChannelDetails();
  renderMentionBadge();
  $('page-title').textContent = room ? (roomBoard.isOpen ? 'Room board' : session.channel) : social.isOpen ? 'Friends & DMs' : 'Home';
  $('crumb-icon').innerHTML = icon(room ? (roomBoard.isOpen ? 'board' : 'hash') : social.isOpen ? 'people' : 'home');
  $('room-board').classList.toggle('selected', roomBoard.isOpen);
  $('header-action').innerHTML = `${icon(room ? 'link' : 'join')}<span>${room ? 'Invite people' : 'Join a room'}</span>`;
  $('header-action').setAttribute('aria-label', room ? 'Invite people' : 'Join a room');
  document.title = room ? `${roomBoard.isOpen ? 'Room board' : `#${session.channel}`} · ${room.title} · Duo Chat` : social.isOpen ? 'Friends & DMs · Duo Chat' : 'Duo Chat';
  renderNav();
  toggleSidebar(false);
}

function openHome() {
  social.close();
  roomBoard.close();
  clearTimeout(refreshTimer);
  sendTyping(session, false);
  session = null;
  saved.active = null;
  saveStorage();
  setPage();
}

function openRoom(room, channel = room.lastChannel || 'general', through = null) {
  social.close();
  const fromBoard = roomBoard.isOpen;
  roomBoard.close();
  const sameRoom = session?.room.id === room.id;
  if (sameRoom && session.channel === channel && session.through === through) {
    if (fromBoard) setPage(room);
    toggleSidebar(false);
    return;
  }
  clearTimeout(refreshTimer);
  sendTyping(session, false);
  const current = {
    room, channel, draftKey: `${room.id}:${channel}`, after: 0, revision: null, refreshing: false,
    canManage: admin || room.host,
    members: sameRoom ? session.members : [],
    live: sameRoom ? session.live : new Map(),
    channels: sameRoom ? session.channels : room.knownChannels ?? ['general'],
    voiceChannels: sameRoom ? session.voiceChannels : [{ name: 'lounge', people: 0 }],
    sections: sameRoom ? session.sections : {},
    channelSettings: sameRoom ? session.channelSettings : {},
    mentionUnread: sameRoom ? session.mentionUnread : 0,
    latest: sameRoom ? session.latest : {},
    inviteVersion: sameRoom ? session.inviteVersion : room.inviteVersion ?? 0,
    through,
    aiConnected: sameRoom && session.aiConnected,
  };
  session = current;
  room.lastChannel = channel;
  saved.active = room.id;
  saveStorage();
  setPage(room);
  $('room-title').textContent = `${room.title} · #${channel}`;
  $('room-empty').hidden = false;
  $('empty-title').textContent = `Welcome to #${channel}`;
  $('empty-hint').textContent = channel === 'general' ? 'Invite your friends or try one of these starters.' : 'Send a message to start the conversation in this channel.';
  $('messages').replaceChildren();
  clearMentionSuggestions();
  $('earlier-messages').hidden = true;
  updateHistoryNote(current);
  $('message-input').value = drafts.get(current.draftKey) || '';
  $('message-input').placeholder = `Message #${channel}`;
  $('ai-thinking').hidden = true;
  showTyping([]);
  renderPeople(current.members);
  updateAi(current);
  updateComposer();
  renderAttachment(current);
  showReplyComposer(current);
  setConnection('Connecting');
  const row = $('starters');
  row.replaceChildren();
  row.hidden = channel !== 'general';
  const suggestions = Object.hasOwn(starters, room.title) ? starters[room.title] : starters.default;
  for (const [glyph, label, prompt] of channel === 'general' ? suggestions : []) {
    const button = element('button', 'button outline');
    button.innerHTML = icon(glyph);
    button.append(document.createTextNode(label));
    button.addEventListener('click', () => setDraft(prompt));
    row.append(button);
  }
  void refresh(current);
}

function setConnection(label) {
  const status = $('live-status');
  if (status.textContent.trim() === label) return;
  status.classList.toggle('online', label === 'Live');
  status.replaceChildren(element('span'), document.createTextNode(label));
}

function linkedActivityKey(member) {
  const linked = member.activity?.connections;
  return member.online && linked ? `${linked.steam}|${linked.lastfm}` : '';
}

function activityRows(member) {
  const activity = member.activity;
  if (!activity) return [];
  const live = session?.live.get(member.id);
  const fresh = live?.key && live.key === linkedActivityKey(member) && live.expires > Date.now() ? live : {};
  return [
    { icon: 'game', label: 'Playing', title: fresh.game || activity.game, source: fresh.game ? 'Steam' : '' },
    { icon: 'music', label: 'Listening to', title: fresh.music || activity.music, source: fresh.music ? 'Last.fm' : '' },
  ].filter(row => row.title);
}

function showMemberProfile(member, trigger, isOwn = member.id === session?.room.memberId) {
  memberCardAnchorTop = trigger.getBoundingClientRect().top;
  closeDialog();
  const popup = $('member-card');
  const panel = $('member-profile');
  panel.dataset.memberId = member.id;
  panel.dataset.own = String(isOwn);
  $('member-card-actions').hidden = !isOwn;
  renderMemberProfile(member);
  if (!popup.matches(':popover-open')) popup.showPopover();
  positionMemberCard();
}

function closeMemberCard() {
  const popup = $('member-card');
  if (popup.matches(':popover-open')) popup.hidePopover();
}

function positionMemberCard() {
  const popup = $('member-card');
  if (!popup.matches(':popover-open')) return;
  const available = window.innerHeight - popup.offsetHeight;
  const top = window.innerWidth <= 620 ? available / 2 : memberCardAnchorTop - 20;
  popup.style.setProperty('--card-top', `${Math.max(12, Math.min(top, available - 12))}px`);
}

function renderMemberProfile(member) {
  const panel = $('member-profile');
  if (panel?.dataset.memberId !== member.id) return;
  const activities = activityRows(member);
  const isAdmin = panel.dataset.own === 'true' && admin;
  const signature = JSON.stringify([member, activities, isAdmin]);
  if (panel.dataset.profileSignature === signature) return;
  panel.dataset.profileSignature = signature;
  const header = element('div', 'member-popup-header');
  const cover = element('div', 'profile-cover');
  paintCover(cover, member.color ?? color(member.id), member.banner);
  const picture = avatar(member.name, member.id, member.color, member.avatar);
  picture.classList.toggle('online', member.online);
  const title = element('h2', 'member-popup-name', member.name);
  title.id = 'member-card-title';
  const meta = element('div', 'member-popup-meta');
  meta.append(element('span', member.online ? 'member-presence online' : 'member-presence', member.online ? 'Online' : 'Away'));
  if (member.host) meta.append(element('span', 'member-role', 'Room host'));
  if (isAdmin) meta.append(element('span', 'member-role', 'Duo Chat admin'));
  header.append(cover, picture, title);
  if (member.username) header.append(element('p', 'member-popup-username', member.username));
  header.append(meta);
  const details = element('div', 'member-popup-details');
  if (member.status) details.append(element('p', 'profile-status', member.status));
  if (member.bio) details.append(element('p', 'member-bio', member.bio));
  if (member.details?.length) {
    const facts = element('dl', 'profile-facts');
    for (const { label, value } of member.details) {
      const fact = element('div');
      fact.append(element('dt', '', label), element('dd', '', value));
      facts.append(fact);
    }
    details.append(facts);
  }
  for (const activity of activities) {
    const row = element('div', 'member-activity');
    const glyph = element('span', 'activity-glyph');
    glyph.innerHTML = icon(activity.icon);
    const info = element('div');
    info.append(element('small', '', activity.source ? `${activity.label} · ${activity.source}` : activity.label));
    info.append(element('strong', '', activity.title));
    row.append(glyph, info);
    details.append(row);
  }
  const links = element('div', 'profile-links');
  for (const [key, label] of [['steam', 'Steam'], ['lastfm', 'Last.fm'], ['spotify', 'Spotify']]) {
    const href = member.activity?.connections[key];
    if (!href) continue;
    const link = element('a', 'button outline');
    link.innerHTML = icon('link');
    link.append(label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
  }
  if (links.childElementCount) details.append(links);
  if (panel.dataset.own !== 'true') {
    const tools = element('div', 'profile-links');
    if (member.username && member.username !== selfProfile?.username) {
      const add = element('button', 'button subtle', 'Add friend');
      add.addEventListener('click', () => void social.addFriend(member.username).catch(error => toast(error.message)));
      const message = element('button', 'button primary', 'Message');
      message.addEventListener('click', () => void social.startDirect(member.username).catch(error => toast(error.message)));
      const block = element('button', 'button outline', 'Block');
      block.addEventListener('click', () => social.blockPerson(member));
      tools.append(add, message, block);
    }
    if (session?.canManage && !member.host && member.username !== selfProfile?.username && member.id !== session.room.memberId) {
      const ban = element('button', 'button outline', 'Ban from room');
      ban.addEventListener('click', () => showRoomBan(member));
      tools.append(ban);
    }
    if (tools.childElementCount) details.append(tools);
  }
  panel.replaceChildren(header);
  if (details.childElementCount) panel.append(details);
  positionMemberCard();
}

function makePeople(members) {
  return members.map(member => {
    const node = element('button', 'person');
    node.dataset.memberId = member.id;
    node.setAttribute('aria-label', `View ${member.name}’s profile`);
    node.setAttribute('aria-haspopup', 'dialog');
    node.addEventListener('click', () => showMemberProfile(member, node));
    const initials = avatar(member.name, member.id, member.color, member.avatar);
    initials.classList.toggle('online', member.online);
    const detail = element('span', 'person-detail');
    detail.append(element('strong', '', member.name + (session.room.memberId === member.id ? ' (you)' : '')));
    detail.append(element('small', '', `${member.host ? 'Host · ' : ''}${member.online ? 'Online' : 'Away'}`));
    if (member.status) detail.append(element('small', 'person-status', member.status));
    for (const activity of activityRows(member)) {
      const badge = element('small', 'activity-line');
      badge.innerHTML = icon(activity.icon);
      badge.append(element('span', '', `${activity.label} ${activity.title}`));
      detail.append(badge);
    }
    node.append(initials, detail);
    return node;
  });
}

function renderPeople(members) {
  for (const list of [$('people-list'), $('mobile-members')]) {
    if (!list) continue;
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.memberId : null;
    list.replaceChildren(...makePeople(members));
    if (focused) Array.from(list.children).find(button => button.dataset.memberId === focused)?.focus();
  }
  $('people-count').textContent = members.length;
  const online = members.filter(member => member.online).length;
  $('room-subtitle').textContent = members.length ? `${members.length} ${members.length === 1 ? 'person' : 'people'} · ${online} online` : 'Connecting…';
  if ($('member-card').matches(':popover-open')) {
    const shown = members.find(member => member.id === $('member-profile').dataset.memberId);
    if (shown) renderMemberProfile(shown);
    else closeMemberCard();
  }
}

async function refreshActivity(current) {
  if (document.hidden || current.refreshingActivity || Date.now() < (current.nextActivityRefresh ?? 0)) return;
  const candidates = current.members.filter(member => member.online && member.activity &&
    ((providers.steam && member.activity.connections.steam) || (providers.lastfm && member.activity.connections.lastfm)));
  if (!candidates.length) return;
  current.nextActivityRefresh = Date.now() + 45_000;
  current.refreshingActivity = true;
  try {
    for (let start = 0; start < candidates.length && session === current; start += 6) {
      const results = await Promise.allSettled(candidates.slice(start, start + 6).map(async member => {
        const status = await api(`/rooms/${current.room.id}/activity?member=${member.id}`, { access: current.room.access });
        return [member.id, { ...status, key: linkedActivityKey(member), expires: Date.now() + 55_000 }];
      }));
      if (session !== current) return;
      for (const result of results) if (result.status === 'fulfilled') current.live.set(...result.value);
      renderPeople(current.members);
    }
  } finally {
    current.refreshingActivity = false;
  }
}

function showPeople() {
  if (!session) return;
  showDialog('People in this room', '<div id="mobile-members"></div><div class="dialog-actions below"><button class="button subtle" id="mobile-ai"></button></div>');
  $('mobile-members').append(...makePeople(session.members));
  $('mobile-ai').textContent = session.aiConnected ? 'ChatGPT connected' : 'ChatGPT setup';
  $('mobile-ai').addEventListener('click', showAiSettings);
}

function updateAi(current) {
  $('ai-status').textContent = current.aiConnected ? 'Ready to mention' : 'Needs an API key';
  $('ai-settings').textContent = current.aiConnected ? 'Manage connection' : 'Connect ChatGPT';
  $('ai-settings').hidden = !current.room.host;
}

async function changeMessageVisibility(current, message, button) {
  if (session !== current || !current.canManage) return;
  button.disabled = true;
  try {
    const result = await api(`/rooms/${current.room.id}/moderation`, {
      access: current.room.access, input: { messageId: message.id, hidden: !message.hidden },
    });
    if (session === current) {
      await refresh(current);
      toast(result.hidden ? 'Message hidden.' : 'Message restored.');
    }
  } catch (error) {
    if (session === current) toast(error.message);
  } finally {
    button.disabled = false;
  }
}

function showMessageEditor(current, message) {
  if (session !== current) return;
  showDialog('Edit message', dialogForm(`<label class="field">${message.image ? 'Caption' : 'Message'}<textarea name="text" ${message.image ? '' : 'required'} maxlength="4000" rows="5"></textarea></label>`, 'Save changes'));
  const form = $('dialog-body').querySelector('form');
  form.elements.text.value = message.text;
  form.elements.text.focus();
  form.elements.text.setSelectionRange(message.text.length, message.text.length);
  handleForm(async data => {
    await api(`/rooms/${current.room.id}/edit-message`, { access: current.room.access, input: { messageId: message.id, text: data.get('text') } });
    if (form.isConnected) closeDialog();
    if (session === current) void refresh(current);
  });
}

function authorOf(message) {
  return message.name || (message.kind === 'assistant' ? 'ChatGPT' : 'Room update');
}

function messageAction(label, glyph, click, className = 'icon-button') {
  const button = element('button', className);
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon(glyph);
  button.addEventListener('click', click);
  return button;
}

function showReplyComposer(current) {
  const target = current && replyDrafts.get(current.draftKey);
  $('reply-composer').hidden = !target;
  if (!target) return;
  $('reply-target').textContent = `Replying to ${authorOf(target)}`;
  $('reply-excerpt').textContent = target.text || target.image?.alt || 'Shared image';
}

function startReply(current, message) {
  if (session !== current) return;
  replyDrafts.set(current.draftKey, message);
  showReplyComposer(current);
  $('message-input').focus();
}

function renderAttachment(current) {
  const attachment = imageDrafts.get(current.draftKey);
  $('image-attachment').hidden = !attachment;
  $('message-input').placeholder = attachment ? 'Add a caption…' : `Message #${current.channel}`;
  const thumbnail = $('attachment-thumbnail');
  thumbnail.replaceChildren();
  if (!attachment) return;
  thumbnail.append(pictureImage(attachment.source, 'attached-thumbnail'));
  $('attachment-description').textContent = attachment.alt;
}

function showAttachImage() {
  if (!session) return;
  const current = session;
  const existing = imageDrafts.get(current.draftKey);
  const fields = `${pictureField('Image', 'message-image', 'PNG, JPEG, or WebP')}
    <div class="attachment-preview" id="attachment-preview" hidden></div>
    <label class="field">Image description <small>Optional</small><input name="alt" maxlength="160" placeholder="Describe the image for others"></label>`;
  showDialog('Attach an image', dialogForm(fields, 'Attach image'));
  const form = $('dialog-body').querySelector('form');
  form.elements.alt.value = existing?.alt ?? '';
  const preview = $('attachment-preview');
  const read = bindPicture(form, 'message-image', existing?.source, [1600, 1600], 2_000_000, source => {
    preview.hidden = !source;
    preview.replaceChildren(...(source ? [pictureImage(source, 'attachment-image')] : []));
  }, 'contain');
  handleForm(async data => {
    const picked = await read();
    const source = picked === undefined ? existing?.source : picked;
    if (!source) throw new Error('Choose an image to attach.');
    imageDrafts.set(current.draftKey, { source, alt: data.get('alt').trim() });
    if (form.isConnected) closeDialog();
    if (session?.draftKey === current.draftKey) {
      renderAttachment(session);
      updateComposer();
      $('message-input').focus();
    }
  });
}

function showSharedImage(image) {
  showDialog('Shared image', '<div class="shared-image-view" id="shared-image-view"></div>');
  const picture = pictureImage(image.url, 'shared-image');
  picture.alt = image.alt || 'Shared image';
  $('shared-image-view').append(picture);
  if (image.alt) $('shared-image-view').append(element('p', '', image.alt));
}

function showPollCreator() {
  if (!session) return;
  const current = session;
  const requestId = crypto.randomUUID();
  showDialog('Create a poll', dialogForm(`<label class="field">Question<input name="question" maxlength="180" required placeholder="What should we play next?"></label>
    <div class="poll-choices" id="poll-choices"></div><button class="button outline" type="button" id="add-poll-choice">${icon('plus')} Add choice</button>`, 'Post poll'));
  const form = $('dialog-body').querySelector('form');
  const choices = $('poll-choices');
  const add = $('add-poll-choice');
  function updateLabels() {
    Array.from(choices.children).forEach((row, index) => {
      row.querySelector('span').textContent = `Choice ${index + 1}`;
      row.querySelector('button').hidden = choices.childElementCount <= 2;
    });
    add.disabled = choices.childElementCount >= 5;
  }
  function addChoice() {
    const row = element('div', 'poll-choice');
    row.innerHTML = '<label class="field"><span></span><input name="option" maxlength="60" required></label>';
    const remove = messageAction('Remove this choice', 'close', () => {
      row.remove();
      updateLabels();
      add.focus();
    });
    remove.type = 'button';
    row.append(remove);
    choices.append(row);
    updateLabels();
    return row.querySelector('input');
  }
  addChoice();
  addChoice();
  add.addEventListener('click', () => addChoice().focus());
  handleForm(async data => {
    const { room, channel } = current;
    const input = { id: requestId, question: data.get('question'), options: data.getAll('option'), channel };
    await api(`/rooms/${room.id}/polls`, { access: room.access, input });
    if (form.isConnected) closeDialog();
    if (session === current) {
      if (current.through) openRoom(room, channel);
      else void refresh(current);
    }
  });
}

function showClosePoll(current, message) {
  showDialog('Close this poll?', dialogForm('', 'Close poll', 'The final results will stay in the channel.'));
  const form = $('dialog-body').querySelector('form');
  handleForm(async () => {
    await api(`/rooms/${current.room.id}/close-poll`, { access: current.room.access, input: { messageId: message.id } });
    if (form.isConnected) closeDialog();
    if (session === current) void refresh(current);
  });
}

function renderPoll(current, message, mine) {
  const poll = message.poll;
  const card = element('section', 'poll-card');
  const total = poll.options.reduce((sum, option) => sum + option.count, 0);
  const header = element('div', 'poll-card-heading');
  header.innerHTML = icon('poll');
  header.append(element('span', '', poll.closed ? 'Poll closed' : 'Room poll'));
  card.append(header, element('strong', 'poll-question', message.text));
  const options = element('div', 'poll-options');
  poll.options.forEach((option, index) => {
    const row = element(poll.closed ? 'div' : 'button', 'poll-option');
    const line = element('span', 'poll-option-label');
    line.append(element('span', '', option.label));
    line.append(element('small', '', `${option.count} · ${total ? Math.round(option.count / total * 100) : 0}%`));
    row.append(line);
    if (total) {
      const bar = element('progress', 'poll-progress');
      bar.value = option.count;
      bar.max = total;
      bar.setAttribute('aria-hidden', 'true');
      row.append(bar);
    }
    if (!poll.closed) {
      row.setAttribute('aria-pressed', String(option.mine));
      row.addEventListener('click', async () => {
        if (session !== current) return;
        options.querySelectorAll('button').forEach(button => { button.disabled = true; });
        try {
          await api(`/rooms/${current.room.id}/poll-vote`, { access: current.room.access, input: { messageId: message.id, option: option.mine ? null : index } });
          await refresh(current);
        } catch (error) {
          if (session === current) toast(error.message);
        } finally {
          options.querySelectorAll('button').forEach(button => { button.disabled = false; });
        }
      });
    }
    options.append(row);
  });
  const footer = element('div', 'poll-footer');
  footer.append(element('span', '', `${total} ${total === 1 ? 'vote' : 'votes'}`));
  if (!poll.closed && (mine || current.canManage)) {
    const close = element('button', 'button subtle', 'Close poll');
    close.addEventListener('click', () => showClosePoll(current, message));
    footer.append(close);
  }
  card.append(options, footer);
  return card;
}

function showHistoryResult(room, channel, id) {
  closeDialog();
  if (roomBoard.isOpen) {
    roomBoard.close();
    setPage(session?.room);
  }
  const row = session?.room.id === room.id && session.channel === channel && $(`message-${id}`);
  if (row) {
    highlightMessage(row);
    return;
  }
  openRoom(room, channel, id);
}

function highlightMessage(row) {
  $('messages').querySelector('.message.highlighted')?.classList.remove('highlighted');
  row.classList.add('highlighted');
  row.scrollIntoView({ block: 'center' });
}

function renderHistoryResults(list, room, messages, emptyText) {
  if (!list.isConnected) return;
  list.replaceChildren();
  if (!messages.length) list.append(element('p', 'history-empty', emptyText));
  for (const message of messages) list.append(historyResult(room, message, `#${message.channel}`));
}

function renderMentionBadge() {
  const unread = session?.mentionUnread || 0;
  $('mentions-count').hidden = !unread;
  $('mentions-count').textContent = unread;
  $('mentions-inbox').setAttribute('aria-label', unread ? `Mentions inbox, ${unread} unread` : 'Mentions inbox');
}

async function loadMentions(current) {
  const { messages } = await api(`/rooms/${current.room.id}/mentions`, { access: current.room.access });
  const { room } = current;
  const lastNotified = room.mentionNotifiedThrough;
  const latest = messages[0]?.mentionedAt ?? 0;
  if (latest > (lastNotified ?? 0)) {
    room.mentionNotifiedThrough = latest;
    saveStorage();
    if (lastNotified !== undefined && (document.hidden || roomBoard.isOpen || messages[0].channel !== session?.channel)) {
      const count = messages.filter(message => message.mentionedAt > lastNotified).length;
      notifyAttention(room.title, `${count} new ${count === 1 ? 'mention' : 'mentions'}`);
    }
  } else if (lastNotified === undefined) room.mentionNotifiedThrough = 0;
  if (session?.room === current.room) {
    session.mentionUnread = messages.filter(message => message.mentionedAt > (current.room.mentionsReadThrough || 0)).length;
    renderMentionBadge();
  }
  return messages;
}

async function refreshMentions(current) {
  if (document.hidden || !selfProfile?.username || Date.now() < (current.nextMentionRefresh ?? 0)) return;
  current.nextMentionRefresh = Date.now() + 12_000;
  try {
    await loadMentions(current);
  } catch {
    // The inbox can be retried independently of the chat.
  }
}

async function showMentions() {
  if (!session) return;
  const current = session;
  const { room } = current;
  showDialog('Mentions inbox', '<p>Messages that mention your username in this room.</p><div id="mention-results" class="history-results" aria-live="polite"><p>Loading mentions…</p></div>');
  const list = $('mention-results');
  try {
    const messages = await loadMentions(current);
    if (!list.isConnected) return;
    renderHistoryResults(list, room, messages, 'You have no mentions in this room.');
    const read = room.mentionsReadThrough || 0;
    for (const [index, message] of messages.entries()) {
      if (message.mentionedAt > read) list.children[index].classList.add('unread-mention');
    }
    if (messages[0]?.mentionedAt > read) {
      const mark = element('button', 'button outline', 'Mark all as read');
      mark.addEventListener('click', () => {
        room.mentionsReadThrough = Math.max(room.mentionsReadThrough || 0, messages[0].mentionedAt);
        saveStorage();
        mark.remove();
        for (const row of list.children) row.classList.remove('unread-mention');
        if (session?.room === room) {
          session.mentionUnread = 0;
          renderMentionBadge();
          void loadMentions(session).catch(() => {});
        }
        list.querySelector('button')?.focus();
      });
      list.before(mark);
    }
  } catch (error) {
    if (list.isConnected) list.replaceChildren(element('p', 'form-error', error.message));
  }
}

function showGallery() {
  if (!session) return;
  const { room, channel } = session;
  showDialog(`Media gallery · #${channel}`, `<p id="gallery-feedback" class="history-empty" role="status"></p>
    <div id="gallery-grid" class="gallery-grid"></div><button id="gallery-more" class="button outline" hidden>Load older images</button>`);
  const grid = $('gallery-grid');
  const feedback = $('gallery-feedback');
  const more = $('gallery-more');
  let before;
  async function load() {
    more.disabled = true;
    feedback.textContent = 'Loading images…';
    const query = new URLSearchParams({ channel });
    if (before) query.set('before', before);
    try {
      const { images, next } = await api(`/rooms/${room.id}/gallery?${query}`, { access: room.access });
      if (!grid.isConnected) return;
      for (const image of images) {
        const tile = element('div', 'gallery-tile');
        const open = element('button', 'gallery-picture');
        open.setAttribute('aria-label', image.alt ? `View image: ${image.alt}` : 'View shared image');
        const preview = pictureImage(image.url, 'gallery-thumbnail');
        preview.alt = '';
        preview.loading = 'lazy';
        open.append(preview);
        open.addEventListener('click', () => showSharedImage(image));
        const jump = element('button', 'gallery-jump', 'Jump to message');
        jump.addEventListener('click', () => showHistoryResult(room, channel, image.id));
        tile.append(open, jump);
        grid.append(tile);
      }
      before = next;
      more.hidden = !next;
      feedback.textContent = grid.children.length ? '' : 'No images in this channel yet.';
    } catch (error) {
      feedback.textContent = error.message;
      more.hidden = false;
      more.textContent = 'Try again';
    } finally {
      more.disabled = false;
    }
  }
  more.addEventListener('click', () => {
    more.textContent = 'Load older images';
    void load();
  });
  void load();
}

function historyResult(room, message, label) {
  const result = element('button', 'history-result');
  const meta = element('span', 'history-result-meta');
  meta.append(element('strong', '', authorOf(message)), element('small', '', label));
  result.append(meta, element('span', 'history-result-text', message.text));
  result.addEventListener('click', () => showHistoryResult(room, message.channel, message.id));
  return result;
}

function showSearch() {
  if (!session) return;
  const { room, channels } = session;
  const field = `<label class="field">Search messages<input name="query" type="search" minlength="2" maxlength="100" placeholder="Search words or image descriptions"></label>
    <div class="search-filters"><label class="field">Channel<select name="channel"><option value="">All channels</option></select></label>
    <label class="field">Message type<select name="kind"><option value="all">All messages</option><option value="images">Images</option><option value="polls">Polls</option></select></label></div>`;
  showDialog('Search room', `${dialogForm(field, 'Search')}<div class="history-results" id="search-results" aria-live="polite"></div>`);
  const channelFilter = $('dialog-body').querySelector('[name=channel]');
  for (const channel of channels) channelFilter.add(new Option(`#${channel}`, channel));
  const list = $('search-results');
  handleForm(async data => {
    list.textContent = '';
    const query = new URLSearchParams({ q: data.get('query').trim(), kind: data.get('kind') });
    if (data.get('channel')) query.set('channel', data.get('channel'));
    const { messages } = await api(`/rooms/${room.id}/search?${query}`, { access: room.access });
    renderHistoryResults(list, room, messages, 'No matching messages.');
  });
}

function toggleBookmark(roomId, id) {
  const wasSaved = bookmarks.some(entry => entry.roomId === roomId && entry.id === id);
  if (wasSaved) bookmarks = bookmarks.filter(entry => entry.roomId !== roomId || entry.id !== id);
  else if (bookmarks.length < 40) bookmarks = [{ roomId, id }, ...bookmarks];
  else {
    toast('Remove a saved message before adding another. This browser can save 40.');
    return false;
  }
  saved.bookmarks = bookmarks;
  saveStorage();
  toast(wasSaved ? 'Removed from saved messages.' : 'Message saved.');
  return true;
}

async function showBookmarks() {
  toggleSidebar(false);
  showDialog('Saved messages', '<p>Messages you save appear here on this browser.</p><div class="history-results" id="bookmark-results" aria-live="polite"></div>');
  const list = $('bookmark-results');
  if (!bookmarks.length) {
    list.append(element('p', 'history-empty', 'Open a message’s actions to save it here.'));
    return;
  }
  const entries = bookmarks;
  const rooms = new Map(saved.rooms.map(room => [room.id, room]));
  const idsByRoom = new Map();
  for (const { roomId, id } of entries) {
    if (!rooms.has(roomId)) continue;
    if (!idsByRoom.has(roomId)) idsByRoom.set(roomId, []);
    idsByRoom.get(roomId).push(id);
  }
  list.append(element('p', 'history-empty', 'Loading saved messages…'));
  const responseByRoom = new Map(await Promise.all([...idsByRoom].map(async ([id, ids]) => {
    const query = new URLSearchParams({ ids: ids.join(',') });
    try {
      const { messages } = await api(`/rooms/${id}/saved-messages?${query}`, { access: rooms.get(id).access });
      return [id, new Map(messages.map(message => [message.id, message]))];
    } catch {
      return [id, null];
    }
  })));
  if (!list.isConnected) return;
  list.replaceChildren();
  for (const { roomId, id } of entries) {
    const room = rooms.get(roomId);
    const messages = responseByRoom.get(roomId);
    const message = messages?.get(id);
    const row = element('div', 'bookmark-row');
    if (message) {
      row.append(historyResult(room, message, `${room.title} · #${message.channel}`));
    } else {
      row.append(element('p', 'history-empty', messages === null ? 'Couldn’t load this message. Try opening Saved messages again.' : 'Message unavailable'));
    }
    row.append(messageAction('Remove saved message', 'trash', () => {
      if (!toggleBookmark(roomId, id)) return;
      const next = row.nextElementSibling ?? row.previousElementSibling;
      row.remove();
      if (!list.children.length) list.append(element('p', 'history-empty', 'Open a message’s actions to save it here.'));
      (next?.querySelector('button') ?? $('close-dialog')).focus();
    }));
    list.append(row);
  }
}

async function copyMessageValue(value, success) {
  try {
    await navigator.clipboard.writeText(value);
    closeDialog();
    toast(success);
  } catch {
    toast('Couldn’t copy. Check clipboard permissions and try again.');
  }
}

async function showPins() {
  if (!session) return;
  const { room, channel } = session;
  showDialog('Pinned messages', '<div class="history-results" id="pin-results" aria-live="polite"><p>Loading pins…</p></div>');
  const list = $('pin-results');
  try {
    const { messages } = await api(`/rooms/${room.id}/pins?${new URLSearchParams({ channel })}`, { access: room.access });
    renderHistoryResults(list, room, messages, 'This channel has no pinned messages yet.');
  } catch (error) {
    if (list.isConnected) list.replaceChildren(element('p', 'form-error', error.message));
  }
}

async function reactToMessage(current, message, emoji, active, button) {
  if (session !== current) return;
  button.disabled = true;
  try {
    await api(`/rooms/${current.room.id}/reaction`, { access: current.room.access, input: { messageId: message.id, emoji, active } });
    await refresh(current);
  } catch (error) {
    if (session === current) toast(error.message);
  } finally {
    button.disabled = false;
  }
}

function showReactions(current, message) {
  showDialog('Add a reaction', '<div class="reaction-picker" id="reaction-picker"></div>');
  const list = $('reaction-picker');
  for (const [emoji, label] of reactionOptions) {
    const active = Boolean(message.reactions?.find(reaction => reaction.emoji === emoji)?.mine);
    const button = element('button', 'button outline', emoji);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => { closeDialog(); void reactToMessage(current, message, emoji, !active, button); });
    list.append(button);
  }
  list.firstElementChild.focus();
}

function showDeleteMessage(current, message) {
  showDialog('Delete message?', dialogForm('', 'Delete message', 'This will remove your message for everyone in the room.'));
  const form = $('dialog-body').querySelector('form');
  handleForm(async () => {
    await api(`/rooms/${current.room.id}/delete-message`, { access: current.room.access, input: { messageId: message.id } });
    if (form.isConnected) closeDialog();
    void refresh(current);
  });
}

function showMessageOptions(current, message, mine) {
  showDialog('Message actions', '<div class="message-options" id="message-options"></div>');
  const list = $('message-options');
  function add(label, glyph, action) {
    const button = element('button', 'button subtle');
    button.innerHTML = icon(glyph);
    button.append(label);
    button.addEventListener('click', () => action(button));
    list.append(button);
  }
  if (!message.hidden) {
    const roomId = current.room.id;
    const savedHere = bookmarks.some(entry => entry.roomId === roomId && entry.id === message.id);
    add(savedHere ? 'Remove from saved' : 'Save message', 'bookmark', () => {
      if (toggleBookmark(roomId, message.id)) closeDialog();
    });
    if (message.text) add('Copy text', 'copy', () => copyMessageValue(message.text, 'Message copied.'));
    add('Remind me about this', 'clock', () => roomBoard.planForm('reminder', { id: message.id, text: message.text || 'Return to this message' }));
    add('Copy message link', 'link', () => copyMessageValue(
      `${location.origin}${location.pathname}#message=${roomId}/${current.channel}/${message.id}`,
      'Message link copied.',
    ));
  }
  if (current.canManage && !message.hidden) {
    add(message.pinned_at ? 'Unpin message' : 'Pin message', 'pin', async button => {
      button.disabled = true;
      try {
        const { active } = await api(`/rooms/${current.room.id}/pin`, { access: current.room.access, input: { messageId: message.id, active: !message.pinned_at } });
        if (button.isConnected) closeDialog();
        if (session === current) { void refresh(current); toast(active ? 'Message pinned.' : 'Message unpinned.'); }
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    });
  }
  if (current.canManage) add(message.hidden ? 'Restore message' : 'Hide message', message.hidden ? 'show' : 'hide', button => {
    closeDialog();
    void changeMessageVisibility(current, message, button);
  });
  if (mine && message.kind === 'person') add('Delete message', 'trash', () => showDeleteMessage(current, message));
  list.firstElementChild?.focus();
}

function linkedMessageText(current, text) {
  const body = document.createDocumentFragment();
  let position = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+|(?<![a-z0-9_@])@([a-z0-9_]{3,24}#[0-9]{4})(?![a-z0-9_#])/gi)) {
    if (match[1]) {
      const username = match[1].toLowerCase();
      if (!current.members.some(member => member.username === username)) continue;
      const mention = element('button', 'member-mention', match[0]);
      mention.setAttribute('aria-haspopup', 'dialog');
      mention.addEventListener('click', () => {
        const member = current.members.find(entry => entry.username === username);
        if (session === current && member) showMemberProfile(member, mention, member.username === selfProfile?.username);
      });
      body.append(text.slice(position, match.index), mention);
      position = match.index + match[0].length;
      continue;
    }
    const value = match[0].replace(/[.!?,;:)\]]+$/, '');
    const url = URL.canParse(value) ? new URL(value) : null;
    if (!url || url.username || url.password) continue;
    const anchor = element('a', '', value);
    anchor.href = url.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    body.append(text.slice(position, match.index), anchor);
    position = match.index + value.length;
  }
  body.append(text.slice(position));
  return body;
}

function messageText(current, text, unavailable) {
  const body = element('div', unavailable ? 'message-text moderated' : 'message-text');
  if (unavailable) body.textContent = text;
  else body.append(formatContent(text, value => linkedMessageText(current, value)));
  return body;
}

function appendMessages(current, messages) {
  if (!messages.length) return;
  const stream = $('message-stream');
  const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;
  const first = !current.after;
  const list = $('messages');
  $('room-empty').hidden = true;
  for (const message of messages) {
    if (message.id <= current.after) continue;
    current.after = message.id;
    const kind = message.kind;
    const mine = Boolean(message.mine) || message.member_id === current.room.memberId;
    const author = authorOf(message);
    const row = element('article', `message ${kind}${mine ? ' mine' : ''}`);
    row.id = `message-${message.id}`;
    const member = current.members.find(person => person.id === message.member_id);
    const initials = avatar(author, message.member_id, message.color, member?.avatar);
    if (kind !== 'person') {
      initials.dataset.color = kind === 'assistant' ? '1' : '3';
      initials.innerHTML = icon(kind === 'assistant' ? 'spark' : 'help');
    }
    const content = element('div', 'message-content');
    const byline = element('div', 'message-name');
    const name = author + (mine ? ' (you)' : '');
    if (message.member_id) {
      row.dataset.memberId = message.member_id;
      row.dataset.mine = mine ? 'true' : 'false';
      const profile = element('button', 'message-author', name);
      profile.setAttribute('aria-haspopup', 'dialog');
      profile.addEventListener('click', () => {
        const member = current.members.find(entry => entry.id === message.member_id);
        if (session === current && member) showMemberProfile(member, profile, mine);
      });
      byline.append(profile);
    } else byline.append(name);
    const time = new Date(message.created_at);
    const stamp = element('time', 'time', clock.format(time));
    stamp.dateTime = time.toISOString();
    stamp.title = fullDate.format(time);
    byline.append(stamp);
    if (message.edited_at) byline.append(element('span', 'edited-mark', 'edited'));
    if (message.pinned_at && !message.hidden) byline.append(element('span', 'pinned-mark', 'Pinned'));
    const unavailable = message.hidden || message.deleted;
    const text = message.deleted ? 'Message deleted.' : message.hidden ? 'Message hidden by a moderator.' : message.text;
    if (message.reply_to && !unavailable) {
      const reference = element(message.reply_text ? 'button' : 'div', 'message-reference');
      if (message.reply_text) {
        reference.append(element('strong', '', message.reply_name || 'Member'), element('span', '', message.reply_text));
        reference.addEventListener('click', () => showHistoryResult(current.room, current.channel, message.reply_to));
      } else reference.textContent = 'Original message unavailable';
      content.append(reference);
    }
    content.append(byline);
    if (!unavailable && message.poll) content.append(renderPoll(current, message, mine));
    else if (text) content.append(messageText(current, text, unavailable));
    if (!unavailable && message.image) {
      const open = element('button', 'message-image-button');
      open.setAttribute('aria-label', 'Open shared image');
      const image = pictureImage(message.image.url, 'attachment-image');
      image.alt = message.image.alt || 'Shared image';
      if (!current.through && (atBottom || first || mine)) {
        image.addEventListener('load', () => {
          const distance = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
          if (session === current && distance < image.offsetHeight + 100) stream.scrollTop = stream.scrollHeight;
        }, { once: true });
      }
      open.append(image);
      open.addEventListener('click', () => showSharedImage(message.image));
      content.append(open);
    }
    if (!unavailable && message.reactions?.length) {
      const list = element('div', 'message-reactions');
      for (const reaction of message.reactions) {
        const label = reactionOptions.find(([emoji]) => emoji === reaction.emoji)?.[1] || reaction.emoji;
        const button = element('button', 'reaction-chip', `${reaction.emoji} ${reaction.count}`);
        button.setAttribute('aria-label', `${label}, ${reaction.count}`);
        button.setAttribute('aria-pressed', String(Boolean(reaction.mine)));
        button.addEventListener('click', () => void reactToMessage(current, message, reaction.emoji, !reaction.mine, button));
        list.append(button);
      }
      content.append(list);
    }
    row.append(initials, content);
    const actions = element('div', 'message-actions');
    if (!unavailable) {
      actions.append(messageAction('Reply', 'reply', () => startReply(current, message)));
      actions.append(messageAction('Add reaction', 'reaction', () => showReactions(current, message)));
      if (mine && kind === 'person' && !message.poll) {
        current.lastEditableMessage = message;
        actions.append(messageAction('Edit message', 'edit', () => showMessageEditor(current, message)));
      }
    }
    if (!message.deleted && (!unavailable || current.canManage || (mine && kind === 'person'))) actions.append(messageAction('More message actions', 'more', () => showMessageOptions(current, message, mine)));
    row.append(actions);
    list.append(row);
  }
  if (!current.through && (atBottom || first || messages.some(message => message.mine || message.member_id === current.room.memberId))) stream.scrollTop = stream.scrollHeight;
}

function updateMessageAuthors(current) {
  const people = new Map(current.members.map(member => [member.id, member]));
  for (const row of $('messages').querySelectorAll('[data-member-id]')) {
    const member = people.get(row.dataset.memberId);
    if (!member) continue;
    const author = row.querySelector('.message-author');
    const name = member.name + (row.dataset.mine === 'true' ? ' (you)' : '');
    if (author.textContent !== name) author.textContent = name;
    const artwork = row.querySelector('.avatar');
    updateAvatar(artwork, member.name, member.id, member.color, member.avatar);
  }
}

function nearLatest() {
  const stream = $('message-stream');
  return stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;
}

function updateHistoryNote(current) {
  const note = $('history-note');
  const earlier = Boolean(current?.through);
  const stream = $('message-stream');
  const distance = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
  note.hidden = !earlier && !(current?.after > 0 && distance > 180);
  $('history-note-label').textContent = earlier ? 'Viewing earlier messages' : 'You’re above the latest messages';
}

function jumpLatest() {
  if (!session) return;
  if (session.through) {
    openRoom(session.room, session.channel);
    return;
  }
  $('history-note').hidden = true;
  const stream = $('message-stream');
  stream.scrollTop = stream.scrollHeight;
  if (readVisibleMessages(session)) renderChannels();
}

function readVisibleMessages(current) {
  if (!current || roomBoard.isOpen || current.through || document.hidden || !nearLatest() || !current.room.readThrough) return false;
  const seen = Math.min(current.after, Number(current.latest[current.channel]) || 0);
  if (seen <= (Number(current.room.readThrough[current.channel]) || 0)) return false;
  current.room.readThrough[current.channel] = seen;
  saveStorage();
  return true;
}

async function refresh(current) {
  if (session !== current || current.refreshing) return;
  current.refreshing = true;
  clearTimeout(refreshTimer);
  try {
    const query = new URLSearchParams({ channel: current.channel, after: current.after });
    if (current.revision !== null) query.set('revision', current.revision);
    if (current.through) query.set('through', current.through);
    const data = await api(`/rooms/${current.room.id}?${query}`, { access: current.room.access });
    if (session !== current) return;
    applyRoomIdentity(current.room, data);
    if (admin !== data.admin) {
      admin = data.admin;
      renderProfile();
    }
    const latest = data.latest ?? {};
    const refreshChannels = current.canManage !== data.canManage || current.channels.join(' ') !== data.channels.join(' ')
      || JSON.stringify(current.sections) !== JSON.stringify(data.sections) || JSON.stringify(current.latest) !== JSON.stringify(latest);
    current.canManage = data.canManage;
    current.channels = data.channels;
    current.voiceChannels = data.voiceChannels ?? [{ name: 'lounge', people: 0 }];
    current.channelSettings = data.channelSettings ?? {};
    renderChannelDetails();
    current.sections = data.sections;
    current.latest = latest;
    if (JSON.stringify(current.room.knownChannels) !== JSON.stringify(data.channels)) {
      current.room.knownChannels = data.channels;
      saveStorage();
    }
    renderVoiceChannels();
    if (!current.room.readThrough) {
      current.room.readThrough = { ...latest };
      saveStorage();
    }
    if (current.inviteVersion !== data.inviteVersion) {
      current.inviteVersion = data.inviteVersion ?? 0;
      if ($('invite-actions')) showInvite();
    }
    current.aiConnected = data.aiConnected;
    if (JSON.stringify(current.members) !== JSON.stringify(data.members)) {
      current.members = data.members;
      renderPeople(data.members);
      updateMessageAuthors(current);
    }
    updateAi(current);
    current.revision = data.revision;
    const stream = $('message-stream');
    const initial = !current.after;
    const restoreScroll = data.reset && (current.through || !nearLatest()) ? stream.scrollTop : null;
    if (data.reset) {
      current.after = 0;
      current.lastEditableMessage = null;
      $('messages').replaceChildren();
      $('room-empty').hidden = Boolean(data.messages.length);
    }
    if (initial || data.reset) current.oldest = data.messages[0]?.id;
    if (typeof data.earlier === 'boolean') $('earlier-messages').hidden = !data.earlier;
    appendMessages(current, data.messages);
    if (restoreScroll !== null) stream.scrollTop = restoreScroll;
    if (current.through && initial) {
      const selected = $(`message-${current.through}`);
      if (selected) highlightMessage(selected);
      else stream.scrollTop = stream.scrollHeight;
    }
    const marked = readVisibleMessages(current);
    updateHistoryNote(current);
    if (refreshChannels || marked) renderChannels();
    $('ai-thinking').hidden = !data.aiThinking;
    showTyping(data.typing ?? []);
    setConnection('Live');
    void refreshActivity(current);
    void refreshMentions(current);
    void roomBoard.refresh();
  } catch (error) {
    if (session !== current) return;
    if (error.status === 404 && current.channel !== 'general') {
      openRoom(current.room, 'general');
      return;
    }
    if (error.code === 'room_banned') {
      openHome();
      toast(error.message);
      return;
    }
    if (error.status === 401) {
      saved.rooms = saved.rooms.filter(room => room.id !== current.room.id);
      openHome();
      toast(error.message);
      return;
    }
    setConnection('Reconnecting');
  } finally {
    current.refreshing = false;
    if (session === current && !usernameSetup) refreshTimer = setTimeout(() => refresh(current), document.hidden ? 12_000 : 2200);
  }
}

function setDraft(value) {
  const input = $('message-input');
  input.value = value;
  storeDraft(session.draftKey, value);
  updateComposer();
  input.focus();
}

function storeDraft(key, value) {
  drafts.delete(key);
  if (value) drafts.set(key, value);
  if (drafts.size > 40) drafts.delete(drafts.keys().next().value);
  saved.drafts = Object.fromEntries(drafts);
  saveStorage();
}

function clearMentionSuggestions() {
  mentionSuggestions = null;
  $('mention-suggestions').hidden = true;
  $('message-input').removeAttribute('aria-activedescendant');
}

function selectMentionSuggestion(index) {
  const list = $('mention-suggestions');
  mentionSuggestions.index = index;
  for (const [position, option] of [...list.children].entries()) {
    option.setAttribute('aria-selected', String(position === index));
  }
  $('message-input').setAttribute('aria-activedescendant', list.children[index].id);
  list.children[index].scrollIntoView({ block: 'nearest' });
}

function chooseMention(username) {
  if (!mentionSuggestions || !session) return;
  const { start, end } = mentionSuggestions;
  const input = $('message-input');
  const replacement = `@${username}${/^\s/.test(input.value.slice(end)) ? '' : ' '}`;
  if (input.value.length - (end - start) + replacement.length > input.maxLength) {
    toast('This message is too long to add the mention.');
    return;
  }
  input.setRangeText(replacement, start, end, 'end');
  storeDraft(session.draftKey, input.value);
  updateComposer();
  sendTyping(session, true);
  clearMentionSuggestions();
  input.focus();
}

function showMentionSuggestions() {
  const input = $('message-input');
  if (!session || document.activeElement !== input || input.selectionStart !== input.selectionEnd) {
    clearMentionSuggestions();
    return;
  }
  const caret = input.selectionStart;
  const token = input.value.slice(0, caret).match(/(?:^|[^a-z0-9_@])@([a-z0-9_#]{0,29})$/i);
  if (!token) {
    clearMentionSuggestions();
    return;
  }
  const query = token[1].toLowerCase();
  const members = [];
  const seen = new Set([selfProfile?.username]);
  for (const member of session.members) {
    if (!member.username || seen.has(member.username)) continue;
    seen.add(member.username);
    if (!member.username.startsWith(query) && !member.name.toLowerCase().includes(query)) continue;
    members.push(member);
    if (members.length === 6) break;
  }
  if (!members.length) {
    clearMentionSuggestions();
    return;
  }
  const start = caret - query.length - 1;
  const end = caret + input.value.slice(caret).match(/^[a-z0-9_#]*/i)[0].length;
  mentionSuggestions = { start, end, members, index: 0 };
  const list = $('mention-suggestions');
  list.replaceChildren(...members.map((member, index) => {
    const option = element('button', 'mention-option');
    option.type = 'button';
    option.tabIndex = -1;
    option.id = `mention-option-${index}`;
    option.setAttribute('role', 'option');
    option.append(element('strong', '', member.name), element('small', '', `@${member.username}`));
    option.addEventListener('pointerdown', event => event.preventDefault());
    option.addEventListener('click', () => chooseMention(member.username));
    return option;
  }));
  list.hidden = false;
  selectMentionSuggestion(0);
}

function updateComposer() {
  const input = $('message-input');
  input.rows = Math.max(1, Math.min(5, input.value.split('\n').length));
  const key = session?.draftKey;
  $('send-message').disabled = (!input.value.trim() && !imageDrafts.has(key)) || pendingMessages.has(key);
}

function sendTyping(current, active) {
  if (!current || (!active && !current.nextTyping) || (active && Date.now() < (current.nextTyping ?? 0))) return;
  current.nextTyping = active ? Date.now() + 3000 : 0;
  void api(`/rooms/${current.room.id}/typing`, { access: current.room.access, input: { channel: current.channel, active } }).catch(() => {});
}

function showTyping(names) {
  const status = $('typing-members');
  const text = names.length ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} typing` : '';
  if (status.textContent !== text) status.textContent = text;
  $('people-typing').hidden = !text;
}

async function sendMessage(event) {
  event.preventDefault();
  const current = session;
  const room = current?.room;
  const text = $('message-input').value.trim();
  const attachment = imageDrafts.get(current?.draftKey);
  if (!room || (!text && !attachment) || pendingMessages.has(current.draftKey)) return;
  const { draftKey, channel } = current;
  const failed = failedMessages.get(draftKey);
  const replyTo = replyDrafts.get(draftKey)?.id ?? null;
  const retry = failed?.text === text && failed.replyTo === replyTo && failed.attachment === attachment;
  const attempt = { id: retry ? failed.id : crypto.randomUUID(), text, replyTo, attachment };
  pendingMessages.set(draftKey, attempt);
  sendTyping(current, false);
  updateComposer();
  try {
    const input = { id: attempt.id, text, channel, replyTo, image: attachment?.source, imageAlt: attachment?.alt };
    const reply = await api(`/rooms/${room.id}/messages`, { access: room.access, input });
    failedMessages.delete(draftKey);
    if (drafts.get(draftKey)?.trim() === text) {
      storeDraft(draftKey, '');
      if (session?.draftKey === draftKey) $('message-input').value = '';
    }
    if ((replyDrafts.get(draftKey)?.id ?? null) === replyTo) {
      replyDrafts.delete(draftKey);
      if (session?.draftKey === draftKey) showReplyComposer(session);
    }
    if (attachment && imageDrafts.get(draftKey) === attachment) {
      imageDrafts.delete(draftKey);
      if (session?.draftKey === draftKey) renderAttachment(session);
    }
    if (session === current) {
      if (reply.ai === 'disconnected') toast(current.room.host ? 'Message sent. Connect ChatGPT to get a reply.' : 'Message sent. Ask the host to connect ChatGPT.');
      if (reply.ai === 'busy') toast('Message sent. ChatGPT is already replying to an earlier request.');
      if (reply.ai === 'queued') $('ai-thinking').hidden = false;
      if (current.through) openRoom(room, channel);
      else void refresh(current);
    }
  } catch (failure) {
    failedMessages.set(draftKey, attempt);
    if (session === current) toast(failure.message);
  } finally {
    pendingMessages.delete(draftKey);
    if (session?.draftKey === draftKey) updateComposer();
  }
}

function toggleSidebar(open) {
  open = narrowScreen.matches && open;
  $('sidebar').classList.toggle('open', open);
  $('sidebar').inert = narrowScreen.matches && !open;
  $('sidebar-backdrop').hidden = !open;
  $('open-sidebar').setAttribute('aria-expanded', String(open));
}

function applyPreferences() {
  const root = document.documentElement;
  root.classList.toggle('compact-messages', preferences.compact);
  root.classList.toggle('large-messages', preferences.largeText);
  $('composer-hint').textContent = preferences.enterSends
    ? 'Enter sends · Shift + Enter adds a line'
    : 'Enter adds a line · Ctrl or ⌘ + Enter sends';
}

function showPreferences() {
  toggleSidebar(false);
  showDialog('Preferences', dialogForm(`<div class="preference-fields">
    <label><span>Compact messages</span><input name="compact" type="checkbox"></label>
    <label><span>Larger chat text</span><input name="largeText" type="checkbox"></label>
    <label><span>Enter sends a message</span><input name="enterSends" type="checkbox"></label>
    <label><span>Desktop messages, requests, mentions and reminders</span><input name="desktopNotifications" type="checkbox"></label>
    <small>Notifications work while the app is open and require browser permission.</small>
    </div>`, 'Save preferences', 'These preferences apply in this browser.'));
  const { elements } = $('dialog-body').querySelector('form');
  for (const key of Object.keys(preferences)) if (elements.namedItem(key)) elements[key].checked = preferences[key];
  handleForm(async data => {
    preferences.compact = data.has('compact');
    preferences.largeText = data.has('largeText');
    preferences.enterSends = data.has('enterSends');
    const wantsNotifications = data.has('desktopNotifications');
    if (wantsNotifications && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    preferences.desktopNotifications = Boolean(wantsNotifications && 'Notification' in window && Notification.permission === 'granted');
    saved.preferences = preferences;
    saveStorage();
    applyPreferences();
    closeDialog();
    toast(wantsNotifications && !preferences.desktopNotifications ? 'Preferences saved. Allow notifications in your browser to enable them.' : 'Preferences saved.');
  });
}

function showShortcuts() {
  toggleSidebar(false);
  showDialog('Keyboard shortcuts', `<dl class="shortcut-list">
    <div><dt>Quick switcher</dt><dd><kbd>Ctrl or ⌘</kbd> + <kbd>K</kbd></dd></div>
    <div><dt>Send a message</dt><dd><kbd>Ctrl or ⌘</kbd> + <kbd>Enter</kbd></dd></div>
    <div><dt>Add a line in the composer</dt><dd><kbd>Shift</kbd> + <kbd>Enter</kbd></dd></div>
    <div><dt>Edit your last message from an empty composer</dt><dd><kbd>↑</kbd></dd></div>
    <div><dt>Find someone to mention in a message</dt><dd><kbd>@</kbd></dd></div>
    <div><dt>Show keyboard shortcuts outside a text field</dt><dd><kbd>?</kbd></dd></div>
    <div><dt>Close a dialog</dt><dd><kbd>Esc</kbd></dd></div>
    </dl>`);
}

function showSwitcher() {
  toggleSidebar(false);
  showDialog('Quick switcher', `<div id="switcher"><label class="field">Jump to a room, channel or tool<input id="switcher-filter" type="search" autocomplete="off"></label>
    <div class="history-results switcher-results" id="switcher-results" aria-label="Suggestions"></div></div>`);
  const input = $('switcher-filter');
  const list = $('switcher-results');
  const rooms = orderedRooms();
  const channelEntries = [session?.room, ...rooms.filter(room => room !== session?.room)].filter(Boolean).flatMap(room =>
    (room.knownChannels ?? ['general']).map(channel => [`#${channel}`, room.title, 'hash', () => openRoom(room, channel)]));
  const tools = [
    ['Friends & DMs', '', 'people', showSocial],
    ['Saved messages', '', 'bookmark', showBookmarks],
    ['Set a status', '', 'status', showStatusForm],
    ['Preferences', '', 'sliders', showPreferences],
    ['Keyboard shortcuts', '', 'help', showShortcuts],
  ];
  if (session) {
    tools.push(['Room board', session.room.title, 'board', () => showRoomBoard()]);
    tools.push(['My plans', session.room.title, 'clock', () => showRoomBoard('plans')]);
    tools.push(['Schedule a message', `#${session.channel}`, 'send', () => roomBoard.planForm('message')]);
    tools.push(['Search room', session.room.title, 'search', showSearch]);
    tools.push(['Mentions inbox', session.room.title, 'inbox', showMentions]);
    tools.push(['Media gallery', `#${session.channel}`, 'image', showGallery]);
    tools.push(['Channel details', `#${session.channel}`, 'sliders', showChannelDetails]);
    if (voice.active) tools.push(['Voice controls', voice.active.room.title, 'speaker', showVoiceDetails]);
    else tools.push(['Join Lounge', session.room.title, 'speaker', () => showJoinVoice(session.room, 'lounge')]);
  }
  const entries = [
    ...rooms.map(room => [room.title, 'Room', room.favorite ? 'star' : 'chat', () => openRoom(room)]),
    ...tools,
    ...channelEntries,
  ];
  function filter() {
    const terms = input.value.trim().toLowerCase().split(/\s+/);
    list.replaceChildren();
    for (const [label, description, glyph, action] of entries.filter(([label, description]) =>
      terms.every(term => `${label} ${description}`.toLowerCase().includes(term))).slice(0, 18)) {
      const row = element('button', 'history-result switcher-result');
      row.innerHTML = icon(glyph);
      row.append(element('span', '', label), element('small', '', description));
      row.addEventListener('click', () => {
        closeDialog();
        action();
      });
      list.append(row);
    }
    if (!list.firstElementChild) list.append(element('p', 'history-empty', 'No matching rooms, channels or tools.'));
  }
  filter();
  input.addEventListener('input', filter);
  $('switcher').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      list.querySelector('button')?.click();
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const options = [input, ...list.querySelectorAll('button')];
    const index = options.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    options[(index + options.length + (event.key === 'ArrowDown' ? 1 : -1)) % options.length].focus();
  });
}

function followInvite() {
  const code = inviteCode(location.hash);
  if (!code) return false;
  const room = saved.rooms.find(entry => entry.invite === code);
  if (room) {
    removeInviteFragment();
    openRoom(room);
  } else {
    openHome();
    showRoomForm({ joining: true, invite: code });
  }
  return true;
}

function followSharedLink() {
  if (followInvite()) return true;
  const match = location.hash.match(/^#message=([a-f0-9-]{36})\/([a-z0-9-]{1,30})\/(\d{1,16})$/);
  const id = Number(match?.[3]);
  if (!Number.isSafeInteger(id) || id < 1) return false;
  const room = saved.rooms.find(entry => entry.id === match[1]);
  if (!room) {
    toast('Join this room with an invite link, then reopen the message link.');
    return false;
  }
  removeInviteFragment();
  showHistoryResult(room, match[2], id);
  return true;
}

function restorePage() {
  if (usernameSetup || followSharedLink()) return;
  const room = saved.rooms.find(entry => entry.id === saved.active);
  if (room) openRoom(room);
  else setPage();
}

$('brand').addEventListener('click', openHome);
$('home-button').addEventListener('click', openHome);
$('friends-button').addEventListener('click', showSocial);
$('friends-rail').addEventListener('click', showSocial);
$('new-room').addEventListener('click', () => { toggleSidebar(false); showRoomForm(); });
$('rail-new-room').addEventListener('click', () => { toggleSidebar(false); showRoomForm(); });
$('add-channel').addEventListener('click', showChannelForm);
$('add-voice-channel').addEventListener('click', showVoiceChannelForm);
$('voice-status').addEventListener('click', showVoiceDetails);
$('voice-quick').addEventListener('click', showVoiceDetails);
$('mute-voice').addEventListener('click', voice.toggleMute);
$('deafen-voice').addEventListener('click', voice.toggleDeafen);
$('leave-voice').addEventListener('click', voice.leave);
$('quick-switcher').addEventListener('click', showSwitcher);
$('saved-messages').addEventListener('click', showBookmarks);
$('set-status').addEventListener('click', showStatusForm);
$('preferences').addEventListener('click', showPreferences);
$('shortcuts').addEventListener('click', showShortcuts);
$('organize-channels').addEventListener('click', organizeChannels);
$('room-info').addEventListener('click', showRoomInfo);
$('room-board').addEventListener('click', () => showRoomBoard());
$('schedule-message').addEventListener('click', () => roomBoard.planForm('message'));
$('format-message').addEventListener('click', () => {
  const open = $('format-toolbar').hidden;
  $('format-toolbar').hidden = !open;
  $('format-message').setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => {
  const input = $('message-input');
  const mark = button.dataset.format;
  const { selectionStart: start, selectionEnd: end } = input;
  if (!session || input.value.length + mark.length * 2 > input.maxLength) return;
  input.setRangeText(mark + input.value.slice(start, end) + mark, start, end, 'end');
  input.setSelectionRange(start + mark.length, end + mark.length);
  storeDraft(session.draftKey, input.value);
  updateComposer();
  input.focus();
}));
$('room-settings').addEventListener('click', showRoomSettings);
$('hero-create').addEventListener('click', () => showRoomForm());
$('header-action').addEventListener('click', () => session ? showInvite() : showRoomForm({ joining: true }));
$('search-room').addEventListener('click', showSearch);
$('channel-pins').addEventListener('click', showPins);
$('channel-details').addEventListener('click', showChannelDetails);
$('mentions-inbox').addEventListener('click', showMentions);
$('attach-image').addEventListener('click', showAttachImage);
$('create-poll').addEventListener('click', showPollCreator);
$('remove-attachment').addEventListener('click', () => {
  if (!session) return;
  imageDrafts.delete(session.draftKey);
  renderAttachment(session);
  updateComposer();
  $('message-input').focus();
});
$('earlier-messages').addEventListener('click', () => {
  if (session?.oldest > 1) openRoom(session.room, session.channel, session.oldest - 1);
});
$('jump-latest').addEventListener('click', jumpLatest);
$('cancel-reply').addEventListener('click', () => {
  if (!session) return;
  replyDrafts.delete(session.draftKey);
  showReplyComposer(session);
  $('message-input').focus();
});
$('message-stream').addEventListener('scroll', () => {
  updateHistoryNote(session);
  if (readVisibleMessages(session)) renderChannels();
}, { passive: true });
$('help-button').addEventListener('click', () => { toggleSidebar(false); showHelp(); });
$('edit-profile').addEventListener('click', showProfileEditor);
$('edit-from-member-card').addEventListener('click', showProfileEditor);
$('close-member-card').addEventListener('click', closeMemberCard);
$('ai-settings').addEventListener('click', showAiSettings);
$('people-button').addEventListener('click', showPeople);
$('close-dialog').addEventListener('click', closeDialog);
$('dialog').addEventListener('cancel', event => { if (usernameSetup) event.preventDefault(); });
$('dialog').addEventListener('close', () => { if (!$('dialog').open) $('dialog-body').replaceChildren(); });
$('open-sidebar').addEventListener('click', () => { toggleSidebar(true); $('close-sidebar').focus(); });
$('close-sidebar').addEventListener('click', () => { toggleSidebar(false); $('open-sidebar').focus(); });
$('sidebar-backdrop').addEventListener('click', () => toggleSidebar(false));
narrowScreen.addEventListener('change', () => toggleSidebar(false));
document.querySelectorAll('[data-room-title]').forEach(button => button.addEventListener('click', () => showRoomForm({ title: button.dataset.roomTitle })));
$('composer').addEventListener('submit', sendMessage);
$('message-input').addEventListener('input', event => {
  storeDraft(session.draftKey, event.target.value);
  updateComposer();
  sendTyping(session, Boolean(event.target.value.trim()));
  if (!event.isComposing) showMentionSuggestions();
});
$('message-input').addEventListener('click', showMentionSuggestions);
$('message-input').addEventListener('blur', () => {
  clearMentionSuggestions();
  sendTyping(session, false);
});
$('message-input').addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (mentionSuggestions && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    if (event.key === 'Escape') {
      event.preventDefault();
      clearMentionSuggestions();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      chooseMention(mentionSuggestions.members[mentionSuggestions.index].username);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const { index, members } = mentionSuggestions;
      selectMentionSuggestion((index + members.length + (event.key === 'ArrowDown' ? 1 : -1)) % members.length);
      return;
    }
  }
  if (event.key === 'ArrowUp' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    && !event.target.value && session?.lastEditableMessage && !session.through
    && !replyDrafts.has(session.draftKey) && !imageDrafts.has(session.draftKey)) {
    event.preventDefault();
    showMessageEditor(session, session.lastEditableMessage);
    return;
  }
  if (mentionSuggestions && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) clearMentionSuggestions();
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && (preferences.enterSends || event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (!$('send-message').disabled) $('composer').requestSubmit();
  }
});
$('mention').addEventListener('click', () => {
  const text = $('message-input').value;
  setDraft(/(^|[^\w])@chatgpt\b/i.test(text) ? text : `@ChatGPT ${text}`);
});
document.addEventListener('keydown', event => {
  if (usernameSetup || event.defaultPrevented || event.isComposing || event.repeat) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    showSwitcher();
  } else if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey
    && !event.target.closest('input, textarea, select, [contenteditable]')) showShortcuts();
});
document.addEventListener('visibilitychange', () => { if (!usernameSetup && !document.hidden && session) void refresh(session); });
window.addEventListener('hashchange', () => { if (!usernameSetup) followSharedLink(); });
window.addEventListener('resize', positionMemberCard);
window.addEventListener('pagehide', voice.disconnect);
window.addEventListener('pagehide', () => social.stop());

applyPreferences();
void api('/profile').then(data => {
  applyOwnProfile(data);
  if (data.signedIn && !data.profile.username) showUsernameSetup();
  else restorePage();
}).catch(restorePage);
