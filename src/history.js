// Finding older messages: search, mentions inbox, media gallery, pins and saved messages list.
import { saveStorage, saved, state } from './state.js';
import { $, api, closeDialog, dialogForm, element, handleForm, notifyAttention, pictureImage, showDialog } from './ui.js';
import { authorOf, messageAction, showSharedImage, toggleBookmark } from './messages.js';
import { toggleSidebar } from './settings.js';
import { openRoom, roomBoard, setPage } from './app.js';

export function showHistoryResult(room, channel, id) {
  closeDialog();
  if (roomBoard.isOpen) {
    roomBoard.close();
    setPage(state.session?.room);
  }
  const row = state.session?.room.id === room.id && state.session.channel === channel && $(`message-${id}`);
  if (row) {
    highlightMessage(row);
    return;
  }
  openRoom(room, channel, id);
}

export function highlightMessage(row) {
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

export function renderMentionBadge() {
  const unread = state.session?.mentionUnread || 0;
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
    if (lastNotified !== undefined && (document.hidden || roomBoard.isOpen || messages[0].channel !== state.session?.channel)) {
      const count = messages.filter(message => message.mentionedAt > lastNotified).length;
      notifyAttention(room.title, `${count} new ${count === 1 ? 'mention' : 'mentions'}`);
    }
  } else if (lastNotified === undefined) room.mentionNotifiedThrough = 0;
  if (state.session?.room === current.room) {
    state.session.mentionUnread = messages.filter(message => message.mentionedAt > (current.room.mentionsReadThrough || 0)).length;
    renderMentionBadge();
  }
  return messages;
}

export async function refreshMentions(current) {
  if (document.hidden || !state.selfProfile?.username || Date.now() < (current.nextMentionRefresh ?? 0)) return;
  current.nextMentionRefresh = Date.now() + 12_000;
  try {
    await loadMentions(current);
  } catch {
    // The inbox can be retried independently of the chat.
  }
}

export async function showMentions() {
  if (!state.session) return;
  const current = state.session;
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
        if (state.session?.room === room) {
          state.session.mentionUnread = 0;
          renderMentionBadge();
          void loadMentions(state.session).catch(() => {});
        }
        list.querySelector('button')?.focus();
      });
      list.before(mark);
    }
  } catch (error) {
    if (list.isConnected) list.replaceChildren(element('p', 'form-error', error.message));
  }
}

export function showGallery() {
  if (!state.session) return;
  const { room, channel } = state.session;
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

export function showSearch() {
  if (!state.session) return;
  const { room, channels } = state.session;
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

export async function showBookmarks() {
  toggleSidebar(false);
  showDialog('Saved messages', '<p>Messages you save appear here on this browser.</p><div class="history-results" id="bookmark-results" aria-live="polite"></div>');
  const list = $('bookmark-results');
  if (!state.bookmarks.length) {
    list.append(element('p', 'history-empty', 'Open a message’s actions to save it here.'));
    return;
  }
  const entries = state.bookmarks;
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

export async function showPins() {
  if (!state.session) return;
  const { room, channel } = state.session;
  showDialog('Pinned messages', '<div class="history-results" id="pin-results" aria-live="polite"><p>Loading pins…</p></div>');
  const list = $('pin-results');
  try {
    const { messages } = await api(`/rooms/${room.id}/pins?${new URLSearchParams({ channel })}`, { access: room.access });
    renderHistoryResults(list, room, messages, 'This channel has no pinned messages yet.');
  } catch (error) {
    if (list.isConnected) list.replaceChildren(element('p', 'form-error', error.message));
  }
}
