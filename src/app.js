// Entry point: page navigation, the room refresh loop, the sidebar and all event wiring.
import { createVoiceController } from './voice.js';
import { createRoomBoard } from './board.js';
import { createSocial } from './social.js';
import { drafts, preferences, saveStorage, saved, state } from './state.js';
import { $, api, avatar, closeDialog, closeMemberCard, dialogForm, element, handleForm, icon, narrowScreen, notifyAttention, showDialog, toast } from './ui.js';
import { inviteCode, removeInviteFragment, restoreAccess, showInvite, showRoomForm, syncAccountRooms } from './rooms.js';
import { applyOwnProfile, renderProfile, showProfileEditor, showStatusForm, showUsernameSetup } from './profile.js';
import { applyRoomIdentity, organizeChannels, renderChannelDetails, showAiSettings, showChannelDetails, showChannelForm, showRoomInfo, showRoomSettings } from './room-settings.js';
import { renderVoiceChannels, renderVoiceDock, showVoiceChannelForm, showVoiceDetails } from './voice-ui.js';
import { positionMemberCard, refreshActivity, renderPeople, showMemberProfile, showPeople, updateAi } from './people.js';
import { refreshProfileListening } from './listening.js';
import { appendMessages, imageDrafts, jumpLatest, nearLatest, readVisibleMessages, renderAttachment, replyDrafts, showAttachImage, showMessageEditor, showPollCreator, showReplyComposer, updateHistoryNote, updateMessageAuthors } from './messages.js';
import { highlightMessage, refreshMentions, renderMentionBadge, showBookmarks, showHistoryResult, showMentions, showPins, showSearch } from './history.js';
import { chooseMention, clearMentionSuggestions, selectMentionSuggestion, sendMessage, sendTyping, setDraft, showMentionSuggestions, showTyping, storeDraft, updateComposer } from './composer.js';
import { applyPreferences, showHelp, showPreferences, showShortcuts, showSwitcher, toggleSidebar } from './settings.js';

export const voice = createVoiceController(api, renderVoiceDock, toast);
export const roomBoard = createRoomBoard({
  api, element, icon, showDialog, dialogForm, handleForm, closeDialog, toast,
  getSession: () => state.session,
  getDraft: () => $('message-input').value,
  showMessage: showHistoryResult,
  remind: showReminder,
});
export const social = createSocial({
  api, element, avatar, toast, showDialog, dialogForm, handleForm, closeDialog,
  getProfile: () => state.selfProfile,
  enterSends: () => preferences.enterSends,
  onOpen: showSocial,
  notify: notifyAttention,
  showProfile: (person, trigger) => showMemberProfile({ ...person, id: person.username, online: false, activity: { connections: person.shareActivity ? person.connections || {} : {}, game: person.shareActivity ? person.game : '', music: person.shareActivity ? person.music : '' } }, trigger, false),
});

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

function showReminder(roomId, plan) {
  const seen = saved.seenReminders ?? [];
  if (seen.includes(plan.id)) return;
  saved.seenReminders = [...seen.slice(-99), plan.id];
  saveStorage();
  const title = saved.rooms.find(room => room.id === roomId)?.title || 'Room reminder';
  notifyAttention(title, plan.text);
}

export function showRoomBoard(tab = 'overview') {
  if (!state.session) return;
  sendTyping(state.session, false);
  clearMentionSuggestions();
  roomBoard.open(tab);
  setPage(state.session.room);
}

export function showSocial() {
  clearTimeout(state.refreshTimer);
  sendTyping(state.session, false);
  clearMentionSuggestions();
  roomBoard.close();
  state.session = null;
  saved.active = null;
  saveStorage();
  social.open();
  setPage();
}

export function orderedRooms() {
  return [...saved.rooms].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
}

export function renderNav() {
  const active = state.session?.room;
  const list = $('room-list');
  const shortcuts = $('room-shortcuts');
  list.replaceChildren();
  shortcuts.replaceChildren();
  $('sidebar-title').textContent = active ? 'Rooms' : 'Lobby';
  $('brand').classList.toggle('selected', !active);
  $('home-navigation').hidden = Boolean(active);
  $('home-room-nav').hidden = Boolean(active);
  $('channel-nav').hidden = !active;
  $('room-hub').hidden = !active;
  if (active) {
    $('room-hub-icon').replaceChildren(avatar(active.title, active.id, active.accent, active.icon));
    $('room-hub-title').textContent = active.title;
    $('room-hub-description').textContent = active.description || 'Room overview';
    $('room-settings').hidden = !state.session.canManage;
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

export function renderChannels() {
  const list = $('channel-list');
  list.replaceChildren();
  if (!state.session) return;
  const { room, channel, channels, sections, canManage } = state.session;
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
      } else if ((Number(state.session.latest[name]) || 0) > (Number(room.readThrough?.[name]) || 0)) {
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

export function setPage(room) {
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
  $('page-title').textContent = room ? (roomBoard.isOpen ? 'Room board' : state.session.channel) : social.isOpen ? 'Friends & DMs' : 'Home';
  $('crumb-icon').innerHTML = icon(room ? (roomBoard.isOpen ? 'board' : 'hash') : social.isOpen ? 'people' : 'home');
  $('room-board').classList.toggle('selected', roomBoard.isOpen);
  $('header-action').innerHTML = `${icon(room ? 'link' : 'join')}<span>${room ? 'Invite people' : 'Join a room'}</span>`;
  $('header-action').setAttribute('aria-label', room ? 'Invite people' : 'Join a room');
  document.title = room ? `${roomBoard.isOpen ? 'Room board' : `#${state.session.channel}`} · ${room.title} · Lobby` : social.isOpen ? 'Friends & DMs · Lobby' : 'Lobby';
  renderNav();
  toggleSidebar(false);
}

function openHome() {
  social.close();
  roomBoard.close();
  clearTimeout(state.refreshTimer);
  sendTyping(state.session, false);
  state.session = null;
  saved.active = null;
  saveStorage();
  setPage();
}

export function openRoom(room, channel = room.lastChannel || 'general', through = null) {
  social.close();
  const fromBoard = roomBoard.isOpen;
  roomBoard.close();
  const sameRoom = state.session?.room.id === room.id;
  if (sameRoom && state.session.channel === channel && state.session.through === through) {
    if (fromBoard) setPage(room);
    toggleSidebar(false);
    return;
  }
  clearTimeout(state.refreshTimer);
  sendTyping(state.session, false);
  const current = {
    room, channel, draftKey: `${room.id}:${channel}`, after: 0, revision: null, refreshing: false,
    canManage: state.admin || room.host,
    members: sameRoom ? state.session.members : [],
    live: sameRoom ? state.session.live : new Map(),
    channels: sameRoom ? state.session.channels : room.knownChannels ?? ['general'],
    voiceChannels: sameRoom ? state.session.voiceChannels : [{ name: 'lounge', people: 0 }],
    sections: sameRoom ? state.session.sections : {},
    channelSettings: sameRoom ? state.session.channelSettings : {},
    mentionUnread: sameRoom ? state.session.mentionUnread : 0,
    latest: sameRoom ? state.session.latest : {},
    inviteVersion: sameRoom ? state.session.inviteVersion : room.inviteVersion ?? 0,
    through,
    aiConnected: sameRoom && state.session.aiConnected,
  };
  state.session = current;
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

export async function refresh(current) {
  if (state.session !== current || current.refreshing) return;
  current.refreshing = true;
  clearTimeout(state.refreshTimer);
  try {
    const query = new URLSearchParams({ channel: current.channel, after: current.after });
    if (current.revision !== null) query.set('revision', current.revision);
    if (current.through) query.set('through', current.through);
    const data = await api(`/rooms/${current.room.id}?${query}`, { access: current.room.access });
    if (state.session !== current) return;
    applyRoomIdentity(current.room, data);
    if (state.admin !== data.admin) {
      state.admin = data.admin;
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
    void refreshProfileListening(current);
    void refreshMentions(current);
    void roomBoard.refresh();
  } catch (error) {
    if (state.session !== current) return;
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
      if (!current.restoreTried && state.selfProfile?.username) {
        current.restoreTried = true;
        try {
          await restoreAccess(current.room);
          return;
        } catch {
          if (state.session !== current) return;
        }
      }
      saved.rooms = saved.rooms.filter(room => room.id !== current.room.id);
      openHome();
      toast(error.message);
      return;
    }
    setConnection('Reconnecting');
  } finally {
    current.refreshing = false;
    if (state.session === current && !state.usernameSetup) state.refreshTimer = setTimeout(() => refresh(current), document.hidden ? 12_000 : 2200);
  }
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

export function restorePage() {
  if (state.usernameSetup || followSharedLink()) return;
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
  if (!state.session || input.value.length + mark.length * 2 > input.maxLength) return;
  input.setRangeText(mark + input.value.slice(start, end) + mark, start, end, 'end');
  input.setSelectionRange(start + mark.length, end + mark.length);
  storeDraft(state.session.draftKey, input.value);
  updateComposer();
  input.focus();
}));
$('room-settings').addEventListener('click', showRoomSettings);
$('hero-create').addEventListener('click', () => showRoomForm());
$('header-action').addEventListener('click', () => state.session ? showInvite() : showRoomForm({ joining: true }));
$('search-room').addEventListener('click', showSearch);
$('channel-pins').addEventListener('click', showPins);
$('channel-details').addEventListener('click', showChannelDetails);
$('mentions-inbox').addEventListener('click', showMentions);
$('attach-image').addEventListener('click', showAttachImage);
$('create-poll').addEventListener('click', showPollCreator);
$('remove-attachment').addEventListener('click', () => {
  if (!state.session) return;
  imageDrafts.delete(state.session.draftKey);
  renderAttachment(state.session);
  updateComposer();
  $('message-input').focus();
});
$('earlier-messages').addEventListener('click', () => {
  if (state.session?.oldest > 1) openRoom(state.session.room, state.session.channel, state.session.oldest - 1);
});
$('jump-latest').addEventListener('click', jumpLatest);
$('cancel-reply').addEventListener('click', () => {
  if (!state.session) return;
  replyDrafts.delete(state.session.draftKey);
  showReplyComposer(state.session);
  $('message-input').focus();
});
$('message-stream').addEventListener('scroll', () => {
  updateHistoryNote(state.session);
  if (readVisibleMessages(state.session)) renderChannels();
}, { passive: true });
$('help-button').addEventListener('click', () => { toggleSidebar(false); showHelp(); });
$('edit-profile').addEventListener('click', showProfileEditor);
$('edit-from-member-card').addEventListener('click', showProfileEditor);
$('close-member-card').addEventListener('click', closeMemberCard);
$('ai-settings').addEventListener('click', showAiSettings);
$('people-button').addEventListener('click', showPeople);
$('close-dialog').addEventListener('click', closeDialog);
$('dialog').addEventListener('cancel', event => { if (state.usernameSetup) event.preventDefault(); });
$('dialog').addEventListener('close', () => { if (!$('dialog').open) $('dialog-body').replaceChildren(); });
$('open-sidebar').addEventListener('click', () => { toggleSidebar(true); $('close-sidebar').focus(); });
$('close-sidebar').addEventListener('click', () => { toggleSidebar(false); $('open-sidebar').focus(); });
$('sidebar-backdrop').addEventListener('click', () => toggleSidebar(false));
narrowScreen.addEventListener('change', () => toggleSidebar(false));
document.querySelectorAll('[data-room-title]').forEach(button => button.addEventListener('click', () => showRoomForm({ title: button.dataset.roomTitle })));
$('composer').addEventListener('submit', sendMessage);
$('message-input').addEventListener('input', event => {
  storeDraft(state.session.draftKey, event.target.value);
  updateComposer();
  sendTyping(state.session, Boolean(event.target.value.trim()));
  if (!event.isComposing) showMentionSuggestions();
});
$('message-input').addEventListener('click', showMentionSuggestions);
$('message-input').addEventListener('blur', () => {
  clearMentionSuggestions();
  sendTyping(state.session, false);
});
$('message-input').addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (state.mentionSuggestions && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    if (event.key === 'Escape') {
      event.preventDefault();
      clearMentionSuggestions();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      chooseMention(state.mentionSuggestions.members[state.mentionSuggestions.index].username);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const { index, members } = state.mentionSuggestions;
      selectMentionSuggestion((index + members.length + (event.key === 'ArrowDown' ? 1 : -1)) % members.length);
      return;
    }
  }
  if (event.key === 'ArrowUp' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    && !event.target.value && state.session?.lastEditableMessage && !state.session.through
    && !replyDrafts.has(state.session.draftKey) && !imageDrafts.has(state.session.draftKey)) {
    event.preventDefault();
    showMessageEditor(state.session, state.session.lastEditableMessage);
    return;
  }
  if (state.mentionSuggestions && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) clearMentionSuggestions();
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
  if (state.usernameSetup || event.defaultPrevented || event.isComposing || event.repeat) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    showSwitcher();
  } else if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey
    && !event.target.closest('input, textarea, select, [contenteditable]')) showShortcuts();
});
document.addEventListener('visibilitychange', () => { if (!state.usernameSetup && !document.hidden && state.session) void refresh(state.session); });
window.addEventListener('hashchange', () => { if (!state.usernameSetup) followSharedLink(); });
window.addEventListener('resize', positionMemberCard);
window.addEventListener('pagehide', voice.disconnect);
window.addEventListener('pagehide', () => social.stop());

applyPreferences();
void api('/profile').then(data => {
  applyOwnProfile(data);
  const url = new URL(location.href);
  const spotify = url.searchParams.get('spotify');
  if (['connected', 'declined', 'failed'].includes(spotify)) {
    url.searchParams.delete('spotify');
    history.replaceState(history.state, '', url);
    const message = { connected: 'Spotify connected. Your live track can now appear in room profiles.',
      declined: 'Spotify connection cancelled.', failed: 'Couldn’t connect Spotify. Check your access and try again.' };
    toast(message[spotify]);
  }
  if (data.signedIn && !data.profile.username) showUsernameSetup();
  else {
    restorePage();
    void syncAccountRooms();
  }
}).catch(restorePage);
