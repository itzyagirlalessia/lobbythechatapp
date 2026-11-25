// The message box: drafts, @mention suggestions, typing status and sending.
import { drafts, saveStorage, saved, state } from './state.js';
import { $, api, element, toast } from './ui.js';
import { failedMessages, imageDrafts, pendingMessages, renderAttachment, replyDrafts, showReplyComposer } from './messages.js';
import { openRoom, refresh } from './app.js';
import { displayMentions, editMentionText, encodeMentions } from './mentions.js';

export function restoreDraft(current) {
  current.mentionDraft = displayMentions(drafts.get(current.draftKey) || '', current.members);
  $('message-input').value = current.mentionDraft.text;
}

export function setDraft(value) {
  const input = $('message-input');
  input.value = value;
  const draft = state.session.mentionDraft;
  editMentionText(draft, value, value.endsWith(draft.text) ? value.length - draft.text.length : value.length);
  storeDraft(state.session.draftKey, encodeMentions(draft));
  updateComposer();
  input.focus();
}

export function storeDraft(key, value) {
  drafts.delete(key);
  if (value) drafts.set(key, value);
  if (drafts.size > 40) drafts.delete(drafts.keys().next().value);
  saved.drafts = Object.fromEntries(drafts);
  saveStorage();
}

export function clearMentionSuggestions() {
  state.mentionSuggestions = null;
  $('mention-suggestions').hidden = true;
  $('message-input').removeAttribute('aria-activedescendant');
}

export function selectMentionSuggestion(index) {
  const list = $('mention-suggestions');
  state.mentionSuggestions.index = index;
  for (const [position, option] of [...list.children].entries()) {
    option.setAttribute('aria-selected', String(position === index));
  }
  $('message-input').setAttribute('aria-activedescendant', list.children[index].id);
  list.children[index].scrollIntoView({ block: 'nearest' });
}

export function chooseMention(username) {
  if (!state.mentionSuggestions || !state.session) return;
  const { start, end } = state.mentionSuggestions;
  const input = $('message-input');
  const member = state.mentionSuggestions.members.find(person => person.username === username);
  if (!member) return;
  const label = '@' + member.name;
  const replacement = label + (/^\s/.test(input.value.slice(end)) ? '' : ' ');
  if (input.value.length - (end - start) + replacement.length > input.maxLength) {
    toast('This message is too long to add the mention.');
    return;
  }
  input.setRangeText(replacement, start, end, 'end');
  const draft = state.session.mentionDraft;
  editMentionText(draft, input.value, start + replacement.length);
  draft.tags = draft.tags.filter(tag => tag.start + tag.label.length <= start || tag.start >= start + replacement.length);
  draft.tags.push({ start, username, label });
  draft.tags.sort((a, b) => a.start - b.start);
  storeDraft(state.session.draftKey, encodeMentions(draft));
  updateComposer();
  sendTyping(state.session, true);
  clearMentionSuggestions();
  input.focus();
}

export function showMentionSuggestions() {
  const input = $('message-input');
  if (!state.session || document.activeElement !== input || input.selectionStart !== input.selectionEnd) {
    clearMentionSuggestions();
    return;
  }
  const caret = input.selectionStart;
  const token = input.value.slice(0, caret).match(/(?:^|[^a-z0-9_@])@([^@\r\n]{0,32})$/i);
  if (!token) {
    clearMentionSuggestions();
    return;
  }
  const query = token[1].toLowerCase();
  const members = [];
  const seen = new Set([state.selfProfile?.username]);
  for (const member of state.session.members) {
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
  const start = caret - token[1].length - 1;
  if (state.session.mentionDraft.tags.some(tag => tag.start === start)) {
    clearMentionSuggestions();
    return;
  }
  const end = caret + input.value.slice(caret).match(/^[a-z0-9_#]*/i)[0].length;
  state.mentionSuggestions = { start, end, members, index: 0 };
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

export function updateComposer() {
  const input = $('message-input');
  input.rows = Math.max(1, Math.min(5, input.value.split('\n').length));
  const key = state.session?.draftKey;
  $('send-message').disabled = (!input.value.trim() && !imageDrafts.has(key)) || pendingMessages.has(key);
}

export function sendTyping(current, active) {
  if (!current || (!active && !current.nextTyping) || (active && Date.now() < (current.nextTyping ?? 0))) return;
  current.nextTyping = active ? Date.now() + 3000 : 0;
  void api(`/rooms/${current.room.id}/typing`, { access: current.room.access, input: { channel: current.channel, active } }).catch(() => {});
}

export function showTyping(names) {
  const status = $('typing-members');
  const text = names.length ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} typing` : '';
  if (status.textContent !== text) status.textContent = text;
  $('people-typing').hidden = !text;
}

export async function sendMessage(event) {
  event.preventDefault();
  const current = state.session;
  const room = current?.room;
  const text = current ? encodeMentions(current.mentionDraft).trim() : '';
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
      if (state.session?.draftKey === draftKey) restoreDraft(state.session);
    }
    if ((replyDrafts.get(draftKey)?.id ?? null) === replyTo) {
      replyDrafts.delete(draftKey);
      if (state.session?.draftKey === draftKey) showReplyComposer(state.session);
    }
    if (attachment && imageDrafts.get(draftKey) === attachment) {
      imageDrafts.delete(draftKey);
      if (state.session?.draftKey === draftKey) renderAttachment(state.session);
    }
    if (state.session === current) {
      if (reply.ai === 'disconnected') toast(current.room.host ? 'Message sent. Connect ChatGPT to get a reply.' : 'Message sent. Ask the host to connect ChatGPT.');
      if (reply.ai === 'busy') toast('Message sent. ChatGPT is already replying to an earlier request.');
      if (reply.ai === 'queued') $('ai-thinking').hidden = false;
      if (current.through) openRoom(room, channel);
      else void refresh(current);
    }
  } catch (failure) {
    failedMessages.set(draftKey, attempt);
    if (state.session === current) toast(failure.message);
  } finally {
    pendingMessages.delete(draftKey);
    if (state.session?.draftKey === draftKey) updateComposer();
  }
}
