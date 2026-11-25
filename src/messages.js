// Rendering messages and their actions: replies, reactions, polls, images, edits, deletes, saved messages.
import { bindPicture, pictureField } from './pictures.js';
import { formatContent } from './formatting.js';
import { displayMentions, editMentionText, encodeMentions, roomLinks } from './mentions.js';
import { messageTime } from './message-time.js';
import { saveStorage, saved, state } from './state.js';
import { $, api, avatar, closeDialog, dialogForm, element, handleForm, icon, pictureImage, showDialog, toast, updateAvatar } from './ui.js';
import { roomMember, showMemberProfile } from './people.js';
import { showHistoryResult } from './history.js';
import { updateComposer } from './composer.js';
import { openRoom, refresh, renderChannels, roomBoard } from './app.js';

export const pendingMessages = new Map();
export const failedMessages = new Map();
export const replyDrafts = new Map();
export const imageDrafts = new Map();
const reactionOptions = [['👍', 'Thumbs up'], ['💜', 'Purple heart'], ['😂', 'Laugh'], ['🎉', 'Celebrate'], ['👀', 'Eyes'], ['🔥', 'Fire']];

async function changeMessageVisibility(current, message, button) {
  if (state.session !== current || !current.canManage) return;
  button.disabled = true;
  try {
    const result = await api(`/rooms/${current.room.id}/moderation`, {
      access: current.room.access, input: { messageId: message.id, hidden: !message.hidden },
    });
    if (state.session === current) {
      await refresh(current);
      toast(result.hidden ? 'Message hidden.' : 'Message restored.');
    }
  } catch (error) {
    if (state.session === current) toast(error.message);
  } finally {
    button.disabled = false;
  }
}

export function showMessageEditor(current, message) {
  if (state.session !== current) return;
  showDialog('Edit message', dialogForm(`<label class="field">${message.image ? 'Caption' : 'Message'}<textarea name="text" ${message.image ? '' : 'required'} maxlength="4000" rows="5"></textarea></label>`, 'Save changes'));
  const form = $('dialog-body').querySelector('form');
  const draft = displayMentions(message.text, current.members);
  form.elements.text.value = draft.text;
  form.elements.text.addEventListener('input', ({ target }) => editMentionText(draft, target.value, target.selectionStart));
  form.elements.text.focus();
  form.elements.text.setSelectionRange(draft.text.length, draft.text.length);
  handleForm(async () => {
    await api(`/rooms/${current.room.id}/edit-message`, { access: current.room.access, input: { messageId: message.id, text: encodeMentions(draft) } });
    if (form.isConnected) closeDialog();
    if (state.session === current) void refresh(current);
  });
}

export function authorOf(message) {
  return message.name || (message.kind === 'assistant' ? 'ChatGPT' : 'Room update');
}

export function messageAction(label, glyph, click, className = 'icon-button') {
  const button = element('button', className);
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon(glyph);
  button.addEventListener('click', click);
  return button;
}

export function showReplyComposer(current) {
  const target = current && replyDrafts.get(current.draftKey);
  $('reply-composer').hidden = !target;
  if (!target) return;
  $('reply-target').textContent = `Replying to ${authorOf(target)}`;
  $('reply-excerpt').textContent = displayMentions(target.text || '', current.members).text || target.image?.alt || 'Shared image';
}

function startReply(current, message) {
  if (state.session !== current) return;
  replyDrafts.set(current.draftKey, message);
  showReplyComposer(current);
  $('message-input').focus();
}

export function renderAttachment(current) {
  const attachment = imageDrafts.get(current.draftKey);
  $('image-attachment').hidden = !attachment;
  $('message-input').placeholder = attachment ? 'Add a caption…' : `Message #${current.channel}`;
  const thumbnail = $('attachment-thumbnail');
  thumbnail.replaceChildren();
  if (!attachment) return;
  thumbnail.append(pictureImage(attachment.source, 'attached-thumbnail'));
  $('attachment-description').textContent = attachment.alt;
}

export function showAttachImage() {
  if (!state.session) return;
  const current = state.session;
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
    if (state.session?.draftKey === current.draftKey) {
      renderAttachment(state.session);
      updateComposer();
      $('message-input').focus();
    }
  });
}

export function showSharedImage(image) {
  showDialog('Shared image', '<div class="shared-image-view" id="shared-image-view"></div>');
  const picture = pictureImage(image.url, 'shared-image');
  picture.alt = image.alt || 'Shared image';
  $('shared-image-view').append(picture);
  if (image.alt) $('shared-image-view').append(element('p', '', image.alt));
}

export function showPollCreator() {
  if (!state.session) return;
  const current = state.session;
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
    if (state.session === current) {
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
    if (state.session === current) void refresh(current);
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
        if (state.session !== current) return;
        options.querySelectorAll('button').forEach(button => { button.disabled = true; });
        try {
          await api(`/rooms/${current.room.id}/poll-vote`, { access: current.room.access, input: { messageId: message.id, option: option.mine ? null : index } });
          await refresh(current);
        } catch (error) {
          if (state.session === current) toast(error.message);
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

export function toggleBookmark(roomId, id) {
  const wasSaved = state.bookmarks.some(entry => entry.roomId === roomId && entry.id === id);
  if (wasSaved) state.bookmarks = state.bookmarks.filter(entry => entry.roomId !== roomId || entry.id !== id);
  else if (state.bookmarks.length < 40) state.bookmarks = [{ roomId, id }, ...state.bookmarks];
  else {
    toast('Remove a saved message before adding another. This browser can save 40.');
    return false;
  }
  saved.bookmarks = state.bookmarks;
  saveStorage();
  toast(wasSaved ? 'Removed from saved messages.' : 'Message saved.');
  return true;
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

async function reactToMessage(current, message, emoji, active, button) {
  if (state.session !== current) return;
  button.disabled = true;
  try {
    await api(`/rooms/${current.room.id}/reaction`, { access: current.room.access, input: { messageId: message.id, emoji, active } });
    await refresh(current);
  } catch (error) {
    if (state.session === current) toast(error.message);
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
    const savedHere = state.bookmarks.some(entry => entry.roomId === roomId && entry.id === message.id);
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
        if (state.session === current) { void refresh(current); toast(active ? 'Message pinned.' : 'Message unpinned.'); }
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
  for (const match of text.matchAll(roomLinks)) {
    if (match[1]) {
      const username = match[1].toLowerCase();
      const target = current.members.find(member => member.username === username);
      if (!target) continue;
      const mention = element('button', 'member-mention', '@' + target.name);
      mention.dataset.username = username;
      mention.title = match[0];
      mention.setAttribute('aria-haspopup', 'dialog');
      mention.addEventListener('click', () => {
        const member = current.members.find(entry => entry.username === username);
        if (state.session === current && member) showMemberProfile(member, mention, member.username === state.selfProfile?.username);
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

export function appendMessages(current, messages) {
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
    const member = roomMember(current, message.member_id);
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
        const member = roomMember(current, message.member_id);
        if (state.session === current && member) showMemberProfile(member, profile, mine);
      });
      byline.append(profile);
    } else byline.append(name);
    byline.append(messageTime(message.created_at, 'time'));
    if (message.edited_at) byline.append(element('span', 'edited-mark', 'edited'));
    if (message.pinned_at && !message.hidden) byline.append(element('span', 'pinned-mark', 'Pinned'));
    const unavailable = message.hidden || message.deleted;
    const text = message.deleted ? 'Message deleted.' : message.hidden ? 'Message hidden by a moderator.' : message.text;
    if (message.reply_to && !unavailable) {
      const reference = element(message.reply_text ? 'button' : 'div', 'message-reference');
      if (message.reply_text) {
        reference.append(element('strong', '', message.reply_name || 'Member'), element('span', '', displayMentions(message.reply_text, current.members).text));
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
          if (state.session === current && distance < image.offsetHeight + 100) stream.scrollTop = stream.scrollHeight;
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

export function updateMessageAuthors(current) {
  for (const tag of $('messages').querySelectorAll('.member-mention')) {
    const target = current.members.find(member => member.username === tag.dataset.username);
    const label = '@' + (target?.name || tag.dataset.username);
    if (tag.textContent !== label) tag.textContent = label;
  }
  const people = new Map(current.members.flatMap(member => (member.memberIds ?? [member.id]).map(id => [id, member])));
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

export function nearLatest() {
  const stream = $('message-stream');
  return stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;
}

export function updateHistoryNote(current) {
  const note = $('history-note');
  const earlier = Boolean(current?.through);
  const stream = $('message-stream');
  const distance = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
  note.hidden = !earlier && !(current?.after > 0 && distance > 180);
  $('history-note-label').textContent = earlier ? 'Viewing earlier messages' : 'You’re above the latest messages';
}

export function jumpLatest() {
  if (!state.session) return;
  if (state.session.through) {
    openRoom(state.session.room, state.session.channel);
    return;
  }
  $('history-note').hidden = true;
  const stream = $('message-stream');
  stream.scrollTop = stream.scrollHeight;
  if (readVisibleMessages(state.session)) renderChannels();
}

export function readVisibleMessages(current) {
  if (!current || roomBoard.isOpen || current.through || document.hidden || !nearLatest() || !current.room.readThrough) return false;
  const seen = Math.min(current.after, Number(current.latest[current.channel]) || 0);
  if (seen <= (Number(current.room.readThrough[current.channel]) || 0)) return false;
  current.room.readThrough[current.channel] = seen;
  saveStorage();
  return true;
}
