// Preferences, keyboard shortcuts, quick switcher, help and the mobile sidebar.
import { preferences, saveStorage, saved, state } from './state.js';
import { $, closeDialog, dialogForm, element, handleForm, icon, narrowScreen, showDialog, toast } from './ui.js';
import { showStatusForm } from './profile.js';
import { showChannelDetails } from './room-settings.js';
import { showJoinVoice, showVoiceDetails } from './voice-ui.js';
import { showBookmarks, showGallery, showMentions, showSearch } from './history.js';
import { openRoom, orderedRooms, roomBoard, showRoomBoard, showSocial, voice } from './app.js';

export function showHelp() {
  showDialog('How it works', `<ul>
    <li>Create a room or join one from an invite.</li>
    <li>Use text channels to keep different conversations in the same room. Everyone in the room can read and send messages in its channels.</li>
    <li>The host can connect an OpenAI API key. Then anyone can mention <strong>@ChatGPT</strong> to get a shared reply.</li>
  </ul>`);
}

export function toggleSidebar(open) {
  open = narrowScreen.matches && open;
  $('sidebar').classList.toggle('open', open);
  $('sidebar').inert = narrowScreen.matches && !open;
  $('sidebar-backdrop').hidden = !open;
  $('open-sidebar').setAttribute('aria-expanded', String(open));
}

export function applyPreferences() {
  const root = document.documentElement;
  root.classList.toggle('compact-messages', preferences.compact);
  root.classList.toggle('large-messages', preferences.largeText);
  $('composer-hint').textContent = preferences.enterSends
    ? 'Enter sends · Shift + Enter adds a line'
    : 'Enter adds a line · Ctrl or ⌘ + Enter sends';
}

export function showPreferences() {
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

export function showShortcuts() {
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

export function showSwitcher() {
  toggleSidebar(false);
  showDialog('Quick switcher', `<div id="switcher"><label class="field">Jump to a room, channel or tool<input id="switcher-filter" type="search" autocomplete="off"></label>
    <div class="history-results switcher-results" id="switcher-results" aria-label="Suggestions"></div></div>`);
  const input = $('switcher-filter');
  const list = $('switcher-results');
  const rooms = orderedRooms();
  const channelEntries = [state.session?.room, ...rooms.filter(room => room !== state.session?.room)].filter(Boolean).flatMap(room =>
    (room.knownChannels ?? ['general']).map(channel => [`#${channel}`, room.title, 'hash', () => openRoom(room, channel)]));
  const tools = [
    ['Friends & DMs', '', 'people', showSocial],
    ['Saved messages', '', 'bookmark', showBookmarks],
    ['Set a status', '', 'status', showStatusForm],
    ['Preferences', '', 'sliders', showPreferences],
    ['Keyboard shortcuts', '', 'help', showShortcuts],
  ];
  if (state.session) {
    tools.push(['Room board', state.session.room.title, 'board', () => showRoomBoard()]);
    tools.push(['My plans', state.session.room.title, 'clock', () => showRoomBoard('plans')]);
    tools.push(['Schedule a message', `#${state.session.channel}`, 'send', () => roomBoard.planForm('message')]);
    tools.push(['Search room', state.session.room.title, 'search', showSearch]);
    tools.push(['Mentions inbox', state.session.room.title, 'inbox', showMentions]);
    tools.push(['Media gallery', `#${state.session.channel}`, 'image', showGallery]);
    tools.push(['Channel details', `#${state.session.channel}`, 'sliders', showChannelDetails]);
    if (voice.active) tools.push(['Voice controls', voice.active.room.title, 'speaker', showVoiceDetails]);
    else tools.push(['Join Lounge', state.session.room.title, 'speaker', () => showJoinVoice(state.session.room, 'lounge')]);
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
