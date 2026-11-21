// Room and channel management: channel forms and details, room info and settings, bans, ChatGPT setup.
import { bindPicture, pictureField } from './pictures.js';
import { saveStorage, state } from './state.js';
import { $, api, avatar, closeDialog, dialogForm, element, handleForm, icon, showDialog, toast, updateAvatar } from './ui.js';
import { showInvite } from './rooms.js';
import { accentOptions } from './profile.js';
import { updateAi } from './people.js';
import { showGallery, showPins } from './history.js';
import { openRoom, refresh, renderChannels, renderNav, roomBoard } from './app.js';
import { renderVoiceChannels } from './voice-ui.js';

export function showChannelForm() {
  if (!state.session?.canManage) return;
  const { room, channels } = state.session;
  const fields = '<label class="field">Channel name<input name="name" maxlength="30" placeholder="e.g. game-night" required autocomplete="off"></label>' + channelGroupField();
  showDialog('Create a text channel', dialogForm(fields, 'Create channel', 'Everyone in the room can see and use this channel.'));
  suggestChannelGroups(state.session);
  handleForm(async data => {
    const { name, section } = await api(`/rooms/${room.id}/channels`, { access: room.access, input: { name: data.get('name'), section: data.get('section') } });
    closeDialog();
    if (state.session?.room.id === room.id) {
      state.session.channels = [...new Set([...channels, ...state.session.channels, name])];
      if (section) state.session.sections = { ...state.session.sections, [name]: section };
      openRoom(room, name);
    }
    toast(`#${name} created.`);
  });
}

export function renderChannelDetails() {
  const channel = state.session?.channel;
  const { topic = '', slowSeconds = 0 } = state.session?.channelSettings?.[channel] ?? {};
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

export function showChannelDetails() {
  if (!state.session) return;
  const current = state.session;
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
    if (state.session?.room === room) {
      state.session.channelSettings[channel] = settings;
      renderChannelDetails();
      void refresh(state.session);
    }
    closeDialog();
    toast('Channel settings saved.');
  });
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

export function organizeChannels() {
  if (!state.session?.canManage) return;
  const current = state.session;
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
    if (state.session?.room.id === room.id) void refresh(state.session);
    toast('Channel group saved.');
  });
}

export function appendSidebarSpacer(container, style) {
  if (!['small', 'large', 'divider'].includes(style)) return;
  const spacer = element('div', 'room-sidebar-spacer ' + style);
  spacer.setAttribute('aria-hidden', 'true');
  container.append(spacer);
}

export function showSidebarSpacing(kind) {
  const current = state.session;
  if (!current?.canManage) return;
  const { room } = current;
  const voice = kind === 'voice';
  const names = voice ? current.voiceChannels.map(channel => channel.name) : current.channels;
  if (!names.length) return;
  const fields = `<label class="field">Add space after<select name="channel"></select></label>
    <label class="field">Spacing<select name="style"><option value="none">None</option><option value="small">Small gap</option>
    <option value="large">Large gap</option><option value="divider">Divider line</option></select></label>`;
  showDialog(voice ? 'Voice channel spacing' : 'Text channel spacing', dialogForm(fields, 'Save spacing', 'Everyone in this room sees these spacers.'));
  const form = $('dialog-body').querySelector('form');
  const channel = form.elements.channel;
  const style = form.elements.style;
  for (const name of names) channel.add(new Option(voice ? (name === 'lounge' ? 'Lounge' : name) : '#' + name, name));
  if (!voice && names.includes(current.channel)) channel.value = current.channel;
  const update = () => { style.value = current.spacers?.[kind + ':' + channel.value] || 'none'; };
  channel.addEventListener('change', update);
  update();
  channel.focus();
  handleForm(async data => {
    const result = await api('/rooms/' + room.id + '/sidebar-spacer', {
      access: room.access, input: { kind, name: data.get('channel'), style: data.get('style') },
    });
    if (state.session?.room.id === room.id) {
      state.session.spacers = result.spacers;
      renderChannels();
      renderVoiceChannels();
    }
    if (form.isConnected) closeDialog();
    toast('Sidebar spacing saved.');
  });
}

export function applyRoomIdentity(room, identity) {
  const next = { title: identity.title, description: identity.description || '', accent: identity.accent ?? 0, icon: identity.icon || '' };
  if (Object.keys(next).every(key => room[key] === next[key])) return;
  Object.assign(room, next);
  saveStorage();
  if (state.session?.room.id === room.id) {
    $('room-title').textContent = `${room.title} · #${state.session.channel}`;
    document.title = `#${state.session.channel} · ${room.title} · Lobby`;
    renderNav();
  }
}

export function showRoomInfo() {
  if (!state.session) return;
  const { room, members, channels, canManage, latest } = state.session;
  showDialog('Room overview', '<div id="room-info-content"></div><div class="dialog-actions below" id="room-info-actions"></div>');
  const panel = $('room-info-content');
  const title = element('div', 'profile-preview');
  const detail = element('div');
  detail.append(element('strong', '', room.title));
  detail.append(element('small', '', `${channels.length} text · ${state.session.voiceChannels.length} voice · ${members.length} ${members.length === 1 ? 'member' : 'members'}`));
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
    room.readThrough = { ...latest, ...(state.session?.room === room ? state.session.latest : {}) };
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

export function showRoomSettings() {
  if (!state.session?.canManage) return;
  const { room } = state.session;
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

export function showRoomBan(member) {
  const current = state.session;
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
  const current = state.session;
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

export function showAiSettings() {
  if (!state.session) return;
  const current = state.session;
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
    if (state.session === current) {
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
      if (state.session === current) {
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
