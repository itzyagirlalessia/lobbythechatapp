import { formatContent } from './formatting.js';

export function createSocial(ui) {
  const $ = id => document.getElementById(id);
  const { element: el, api, toast } = ui;
  let opened = false, tab = 'friends', active, timer, loading = false, signature = '', historySignature = '';
  let data = { friends: [], blocked: [], threads: [] };
  let messages = [], canSend = false, earlier = false, reading = 0, notifySignature;
  const drafts = new Map();
  const failedRequests = new Map();
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  function action(label, operation, style = 'outline') {
    const button = el('button', `button ${style}`, label);
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await operation(); } catch (error) { toast(error.message); }
      finally { if (button.isConnected) button.disabled = false; }
    });
    return button;
  }

  function badge() {
    const count = data.friends.filter(p => p.state === 'pending' && !p.outgoing).length + data.threads.reduce((sum, p) => sum + p.unread, 0);
    $('social-count').textContent = count > 99 ? '99+' : count;
    $('social-count').hidden = !count;
    $('friends-rail').setAttribute('aria-label', count ? `Friends and DMs, ${count} unread` : 'Friends and DMs');
  }

  function empty(container, title, text) {
    const note = el('div', 'social-empty');
    note.append(el('h2', '', title), el('p', '', text));
    container.append(note);
  }

  function personRow(person) {
    const row = el('article', 'social-person');
    row.dataset.username = person.username;
    const info = el('button', 'social-person-info');
    info.type = 'button';
    info.setAttribute('aria-label', `View ${person.name}’s profile`);
    const text = el('span');
    text.append(el('strong', '', person.name), el('small', '', person.username));
    if (person.status) text.append(el('small', 'social-status', person.status));
    info.append(ui.avatar(person.name, person.username, person.color, person.avatar), text);
    info.addEventListener('click', () => ui.showProfile(person, info));
    const tools = el('div', 'social-person-actions');
    row.append(info, tools);
    return { row, tools };
  }

  async function change(person, type) {
    await api('/social/friend-action', { input: { username: person.username, action: type } });
    await refresh(true);
  }

  function confirmAction(person, type) {
    const copy = type === 'block' ? 'Blocking removes the friendship and stops new DMs and friend requests between you. Shared rooms still show their messages; room hosts can use room bans.' : 'You can add them again later. New DMs will pause until you are friends again.';
    ui.showDialog(type === 'block' ? 'Block this person?' : 'Remove friend?', ui.dialogForm('', type === 'block' ? 'Block person' : 'Remove friend', copy));
    $('dialog-body').prepend(el('p', 'social-confirm-name', person.username));
    ui.handleForm(async () => { await change(person, type); ui.closeDialog(); toast(type === 'block' ? 'Person blocked.' : 'Friend removed.'); });
  }

  function renderLists() {
    const key = JSON.stringify([data, tab, active]);
    if (signature === key) return;
    signature = key;
    const focus = document.activeElement;
    const focusedName = focus?.closest('[data-username]')?.dataset.username;
    const focusedLabel = focus?.textContent;
    const list = $('social-people');
    list.replaceChildren();
    let people;
    if (tab === 'blocked') people = data.blocked;
    else people = data.friends.filter(p => p.state === (tab === 'friends' ? 'accepted' : 'pending'));
    $('social-list-title').textContent = `${tab === 'friends' ? 'Your friends' : tab === 'requests' ? 'Friend requests' : 'Blocked people'} · ${people.length}`;
    for (const person of people) {
      const { row, tools } = personRow(person);
      if (tab === 'blocked') tools.append(action('Unblock', () => change(person, 'unblock')));
      else if (person.state === 'accepted') tools.append(action('Message', () => startDirect(person.username), 'primary'), action('Remove', () => confirmAction(person, 'remove')), action('Block', () => confirmAction(person, 'block')));
      else {
        row.append(el('small', 'request-direction', person.outgoing ? 'Request sent' : 'Wants to be friends'));
        if (person.outgoing) tools.append(action('Cancel', () => change(person, 'cancel')));
        else tools.append(action('Accept', () => change(person, 'accept'), 'primary'), action('Decline', () => change(person, 'decline')), action('Block', () => confirmAction(person, 'block')));
      }
      list.append(row);
    }
    if (!people.length) empty(list, tab === 'friends' ? 'Your people, one place' : tab === 'requests' ? 'You’re all caught up' : 'No blocked people', tab === 'friends' ? 'Add someone by their full username and tag to start a private conversation.' : tab === 'requests' ? 'Incoming and sent friend requests will appear here.' : 'People you block will appear here. Unblocking does not add them as a friend.');
    for (const button of $('social-tabs').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.socialTab === tab && !active));
    const threads = $('direct-list');
    threads.replaceChildren();
    for (const thread of data.threads) {
      const button = el('button', 'direct-thread');
      button.type = 'button';
      button.dataset.username = thread.username;
      button.classList.toggle('selected', thread.id === active);
      if (thread.id === active) button.setAttribute('aria-current', 'page');
      const info = el('span', 'direct-thread-info');
      info.append(el('strong', '', thread.name), el('small', '', thread.preview));
      button.append(ui.avatar(thread.name, thread.username, thread.color, thread.avatar), info);
      if (thread.unread) button.append(el('span', 'count', thread.unread > 99 ? '99+' : thread.unread));
      button.addEventListener('click', () => void selectDirect(thread.id));
      threads.append(button);
    }
    if (!data.threads.length) threads.append(el('p', 'direct-list-empty', 'Your conversations will appear here.'));
    if (focusedName) {
      const row = [...document.querySelectorAll('#social-people [data-username], #direct-list [data-username]')].find(p => p.dataset.username === focusedName);
      [...(row?.querySelectorAll('button') || [])].find(b => b.textContent === focusedLabel)?.focus({ preventScroll: true });
    }
    badge();
  }

  function showFriends(nextTab = 'friends') {
    if (active) drafts.set(active, $('direct-input').value);
    active = null;
    tab = nextTab;
    $('friends-panel').hidden = false;
    $('direct-panel').hidden = true;
    $('social-layout').classList.remove('direct-active');
    renderLists();
  }

  async function addFriend(username) {
    const result = await api('/social/friends', { input: { username } });
    toast(result.state === 'accepted' ? 'You’re now friends.' : 'Friend request sent.');
    await refresh(true);
  }

  async function startDirect(username) {
    const result = await api('/social/direct', { input: { username } });
    ui.onOpen();
    await refresh(true);
    await selectDirect(result.id);
  }

  async function selectDirect(id) {
    if (active) drafts.set(active, $('direct-input').value);
    active = id;
    messages = [];
    earlier = false;
    reading = 0;
    historySignature = '';
    $('direct-messages').replaceChildren();
    $('direct-input').value = drafts.get(id) || '';
    $('friends-panel').hidden = true;
    $('direct-panel').hidden = false;
    $('direct-feedback').textContent = 'Loading conversation…';
    $('social-layout').classList.add('direct-active');
    renderLists();
    try { await refreshHistory(id, true); } catch (error) { if (active === id) $('direct-feedback').textContent = error.message; }
  }

  function links(text) {
    const node = el('span');
    for (const [index, part] of text.split(/(https?:\/\/[^\s<>]+)/g).entries()) {
      if (index % 2) {
        const link = el('a', '', part);
        link.href = part;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        node.append(link);
      } else node.append(document.createTextNode(part));
    }
    return node;
  }

  function editMessage(message) {
    const id = active;
    ui.showDialog('Edit direct message', ui.dialogForm('<label class="field">Message<textarea name="text" maxlength="4000" rows="5" required></textarea></label>', 'Save changes'));
    $('dialog-body').querySelector('textarea').value = message.text;
    ui.handleForm(async form => {
      await api(`/social/direct/${id}/edit`, { input: { id: message.id, text: form.get('text') } });
      if (active === id) Object.assign(message, { text: form.get('text').trim(), edited_at: Date.now() });
      ui.closeDialog();
      await refreshHistory(id);
    });
  }

  function deleteMessage(message) {
    const id = active;
    ui.showDialog('Delete direct message?', ui.dialogForm('', 'Delete message', 'The message will be removed for both people.'));
    ui.handleForm(async () => {
      await api(`/social/direct/${id}/delete`, { input: { id: message.id } });
      if (active === id) Object.assign(message, { text: null, deleted: true });
      ui.closeDialog();
      await refreshHistory(id);
    });
  }

  function renderMessages(peer, initial = false) {
    const key = JSON.stringify([messages, canSend]);
    if (historySignature === key) return;
    historySignature = key;
    const stream = $('direct-stream');
    const bottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;
    const oldHeight = stream.scrollHeight, oldTop = stream.scrollTop;
    const focus = document.activeElement;
    const focusedId = focus?.closest('[data-message-id]')?.dataset.messageId;
    const focusedLabel = focus?.textContent;
    const list = $('direct-messages');
    list.replaceChildren();
    for (const message of messages) {
      const row = el('article', `direct-message${message.mine ? ' mine' : ''}`);
      row.dataset.messageId = message.id;
      const head = el('div', 'direct-message-head');
      const name = message.mine ? ui.getProfile()?.displayName || ui.getProfile()?.username : peer.name;
      const time = el('time', '', date.format(message.created_at));
      time.dateTime = new Date(message.created_at).toISOString();
      head.append(el('strong', '', name), time);
      if (message.edited_at && !message.deleted) head.append(el('small', '', 'edited'));
      const body = el('div', 'message-text');
      if (message.deleted) body.append(el('em', 'muted', 'Message deleted'));
      else body.append(formatContent(message.text, links));
      row.append(head, body);
      if (message.mine && !message.deleted) {
        const tools = el('div', 'direct-message-actions');
        tools.append(action('Edit', () => editMessage(message)), action('Delete', () => deleteMessage(message)));
        row.append(tools);
      }
      list.append(row);
    }
    $('direct-earlier').hidden = !earlier;
    if (!messages.length) empty(list, 'A little space for two', 'Say hello. Only you and this person can open this conversation in the app.');
    if (initial || bottom) stream.scrollTop = stream.scrollHeight;
    else if ($('direct-earlier').dataset.loading === 'true') stream.scrollTop = oldTop + stream.scrollHeight - oldHeight;
    else stream.scrollTop = oldTop;
    if (focusedId) {
      const row = [...list.children].find(p => p.dataset.messageId === focusedId);
      [...(row?.querySelectorAll('button') || [])].find(b => b.textContent === focusedLabel)?.focus({ preventScroll: true });
    }
  }

  async function refreshHistory(id, initial = false, before = null) {
    if (active !== id) return;
    const result = await api(`/social/direct/${id}${before ? `?before=${before}` : ''}`);
    if (active !== id || !opened) return;
    canSend = result.canSend;
    if (before) messages = [...result.messages, ...messages];
    else {
      const first = result.messages[0]?.id;
      messages = [...(first ? messages.filter(m => m.id < first) : []), ...result.messages];
    }
    if (before || messages.length <= 80) earlier = result.earlier;
    $('direct-title').textContent = result.peer.name;
    $('direct-subtitle').textContent = result.peer.username;
    $('direct-feedback').textContent = canSend ? 'Private conversation · messages are stored by this app.' : 'Messaging paused. You must be friends and neither person can be blocked. You can still view this conversation.';
    $('direct-input').disabled = !canSend;
    $('direct-send').disabled = !canSend || !$('direct-input').value.trim();
    $('direct-block').onclick = () => confirmAction(result.peer, 'block');
    $('direct-profile').onclick = () => ui.showProfile(result.peer, $('direct-profile'));
    renderMessages(result.peer, initial);
    void markRead();
  }

  async function markRead() {
    if (!opened || !active || document.hidden || $('dialog').open) return;
    if ($('direct-stream').scrollHeight - $('direct-stream').scrollTop - $('direct-stream').clientHeight > 120) return;
    const last = messages.at(-1)?.id;
    if (!last || last <= reading) return;
    const id = active;
    try {
      await api(`/social/direct/${id}/read`, { input: { through: last } });
      if (active !== id) return;
      reading = last;
      const item = data.threads.find(t => t.id === id);
      if (item) item.unread = 0;
      renderLists();
    } catch { /* Retry at the next poll. */ }
  }

  async function refresh(force = false) {
    if (loading) return;
    loading = true;
    clearTimeout(timer);
    try {
      data = await api('/social');
      const incoming = data.friends.filter(p => p.state === 'pending' && !p.outgoing);
      const key = JSON.stringify([incoming.map(p => p.username).sort(), data.threads.filter(p => p.unread).map(p => [p.id, p.unread])]);
      if (notifySignature !== undefined && key !== notifySignature && !force) {
        const unread = data.threads.find(p => p.unread && (p.id !== active || !opened || document.hidden));
        if (unread) ui.notify('New direct message', `${unread.name}: ${unread.preview}`);
        else if (incoming.length) ui.notify('Friend request', `${incoming[0].name} wants to be friends.`);
      }
      notifySignature = key;
      if (opened) renderLists();
      else badge();
      if (opened && active) await refreshHistory(active);
      $('social-feedback').textContent = '';
    } catch (error) {
      if (opened) $('social-feedback').textContent = error.message;
    } finally {
      loading = false;
      timer = setTimeout(() => void refresh(), opened && !document.hidden ? 3500 : 20_000);
    }
  }

  $('add-friend-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('friend-username'), button = $('add-friend-submit');
    button.disabled = true;
    $('add-friend-feedback').textContent = '';
    try {
      await addFriend(input.value);
      input.value = '';
      showFriends('requests');
      $('add-friend-feedback').textContent = 'Request sent. They can accept from their Requests tab.';
    } catch (error) { $('add-friend-feedback').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('social-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-social-tab]');
    if (button) { showFriends(button.dataset.socialTab); void refresh(true); }
  });
  $('direct-back').addEventListener('click', () => showFriends());
  $('direct-input').addEventListener('input', () => {
    if (active) drafts.set(active, $('direct-input').value);
    $('direct-send').disabled = !canSend || !$('direct-input').value.trim();
  });
  $('direct-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && (ui.enterSends() || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!$('direct-send').disabled) $('direct-composer').requestSubmit();
    }
  });
  $('direct-composer').addEventListener('submit', async event => {
    event.preventDefault();
    const id = active, text = $('direct-input').value.trim();
    if (!id || !canSend || !text || $('direct-composer').dataset.sending === 'true') return;
    const previous = failedRequests.get(id);
    const requestId = previous?.text === text ? previous.requestId : crypto.randomUUID();
    failedRequests.set(id, { text, requestId });
    $('direct-composer').dataset.sending = 'true';
    $('direct-send').disabled = true;
    try {
      await api(`/social/direct/${id}/messages`, { input: { id: requestId, text } });
      failedRequests.delete(id);
      drafts.delete(id);
      if (active === id && $('direct-input').value.trim() === text) $('direct-input').value = '';
      await refreshHistory(id, true);
      await refresh(true);
    } catch (error) { toast(error.message); }
    finally {
      $('direct-composer').dataset.sending = 'false';
      $('direct-send').disabled = !canSend || !$('direct-input').value.trim();
    }
  });
  $('direct-earlier').addEventListener('click', async () => {
    const button = $('direct-earlier');
    button.disabled = true;
    button.dataset.loading = 'true';
    try { await refreshHistory(active, false, messages[0]?.id); } catch (error) { toast(error.message); }
    finally { button.disabled = false; button.dataset.loading = 'false'; }
  });
  $('direct-stream').addEventListener('scroll', () => void markRead(), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.getProfile()?.username) void refresh(); });

  return {
    get isOpen() { return opened; },
    open() { opened = true; showFriends(); void refresh(true); },
    close() { if (active) drafts.set(active, $('direct-input').value); opened = false; },
    start() { if (!timer && !loading) void refresh(true); },
    stop() { clearTimeout(timer); },
    addFriend, startDirect,
    blockPerson: person => confirmAction(person, 'block'),
  };
}
