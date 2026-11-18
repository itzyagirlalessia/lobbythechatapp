function inline(text, linkedText, depth = 0) {
  const result = document.createDocumentFragment();
  if (depth > 3) {
    result.append(linkedText(text));
    return result;
  }
  let position = 0;
  const pattern = /(\*\*|~~|\|\||\*|\x60)([^\n]+?)\1/g;
  for (const match of text.matchAll(pattern)) {
    result.append(linkedText(text.slice(position, match.index)));
    const [full, mark, content] = match;
    let node;
    if (mark === '\x60') {
      node = document.createElement('code');
      node.textContent = content;
    } else if (mark === '||') {
      node = document.createElement('button');
      node.type = 'button';
      node.className = 'spoiler';
      node.setAttribute('aria-expanded', 'false');
      node.setAttribute('aria-label', 'Reveal spoiler');
      node.textContent = 'Spoiler';
      node.addEventListener('click', () => {
        const expanded = node.getAttribute('aria-expanded') !== 'true';
        node.setAttribute('aria-expanded', String(expanded));
        node.setAttribute('aria-label', expanded ? 'Hide spoiler' : 'Reveal spoiler');
        node.textContent = expanded ? content : 'Spoiler';
      });
    } else {
      node = document.createElement({ '**': 'strong', '*': 'em', '~~': 's' }[mark]);
      node.append(inline(content, linkedText, depth + 1));
    }
    result.append(node);
    position = match.index + full.length;
  }
  result.append(linkedText(text.slice(position)));
  return result;
}

function codeBlock(text) {
  const block = document.createElement('div');
  block.className = 'message-code-block';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'code-copy';
  copy.textContent = 'Copy code';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed';
    }
  });
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = text;
  pre.append(code);
  block.append(copy, pre);
  return block;
}

export function formatContent(text, linkedText) {
  const result = document.createDocumentFragment();
  const lines = text.split('\n');
  let block;
  let quoted;
  let list;
  for (const line of lines) {
    if (/^\x60{3}/.test(line)) {
      if (block) {
        result.append(codeBlock(block.join('\n')));
        block = undefined;
      } else block = [];
      quoted = list = undefined;
      continue;
    }
    if (block) {
      block.push(line);
      continue;
    }
    if (/^> ?/.test(line)) {
      if (!quoted) {
        quoted = document.createElement('blockquote');
        result.append(quoted);
      } else quoted.append('\n');
      quoted.append(inline(line.replace(/^> ?/, ''), linkedText));
      list = undefined;
      continue;
    }
    if (/^[-*] /.test(line)) {
      if (!list) {
        list = document.createElement('ul');
        result.append(list);
      }
      const item = document.createElement('li');
      item.append(inline(line.slice(2), linkedText));
      list.append(item);
      quoted = undefined;
      continue;
    }
    quoted = list = undefined;
    result.append(inline(line, linkedText), '\n');
  }
  if (block) result.append(codeBlock(block.join('\n')));
  return result;
}
