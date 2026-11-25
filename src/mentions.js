// Room mention labels and their corresponding account handles in editable text.
export const roomLinks = /https?:\/\/[^\s<>"']+|(?<![a-z0-9_@])@([a-z0-9_]{3,24}#[0-9]{4})(?![a-z0-9_#])/gi;

export function displayMentions(source, members) {
  let text = '', position = 0;
  const tags = [];
  for (const match of source.matchAll(roomLinks)) {
    if (!match[1]) continue;
    const member = members.find(person => person.username === match[1].toLowerCase());
    if (!member) continue;
    text += source.slice(position, match.index);
    const label = '@' + member.name;
    tags.push({ start: text.length, label, username: member.username });
    text += label;
    position = match.index + match[0].length;
  }
  return { text: text + source.slice(position), tags };
}

export function encodeMentions({ text, tags }) {
  let result = '', position = 0;
  for (const tag of tags) {
    result += text.slice(position, tag.start) + '@' + tag.username;
    position = tag.start + tag.label.length;
  }
  return result + text.slice(position);
}

// Keep only tags wholly outside the edit. The caret disambiguates identical adjacent labels.
export function editMentionText(draft, text, caret = text.length) {
  if (draft.text === text) return;
  const previous = draft.text;
  let end = text.length, oldEnd = previous.length;
  while (end > caret && oldEnd > 0 && text[end - 1] === previous[oldEnd - 1]) { end--; oldEnd--; }
  let start = 0;
  while (start < end && start < oldEnd && text[start] === previous[start]) start++;
  draft.tags = draft.tags.filter(tag => {
    if (tag.start + tag.label.length <= start) return true;
    if (tag.start < oldEnd) return false;
    tag.start += end - oldEnd;
    return true;
  });
  draft.text = text;
}
