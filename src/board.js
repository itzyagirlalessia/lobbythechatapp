const eventDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const tabs = { overview: 'Overview', events: 'Events', tasks: 'Checklist', plans: 'My plans' };
const kindNames = { event: 'Event', task: 'Task', announcement: 'Announcement' };

function localTime(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function createRoomBoard(ui) {
  const { api, element, icon, getSession, showDialog, dialogForm, handleForm, closeDialog, toast } = ui;
  const $ = id => document.getElementById(id);
  let opened = false;
  let tab = 'overview';
  let roomId;
  let items = [];
  let plans = [];
  let refreshing = false;
  let refreshAgain = false;
  let nextRefresh = 0;
  let showArchived = false;
  let showCompleted = false;
  let signature;

  function roomApi(room, endpoint, input) {
    return api(`/rooms/${room.id}/${endpoint}`, { access: room.access, input });
  }

  function action(label, glyph, click, className = 'button outline') {
    const button = element('button', className);
    button.type = 'button';
    if (glyph) button.innerHTML = icon(glyph);
    button.append(label);
    button.addEventListener('click', click);
    return button;
  }

  async function mutate(button, room, endpoint, input) {
    button.disabled = true;
    try {
      await roomApi(room, endpoint, input);
      await refresh(true);
    } catch (error) {
      toast(error.message);
      void refresh(true);
    } finally {
      button.disabled = false;
    }
  }

  function section(title, nodes, empty, createLabel, create) {
    const block = element('section', 'board-section');
    const heading = element('div', 'board-section-head');
    heading.append(element('h2', '', title));
    if (create) heading.append(action(createLabel, 'plus', create, 'button subtle'));
    block.append(heading);
    const list = element('div', 'board-card-list');
    if (nodes.length) list.append(...nodes);
    else list.append(element('p', 'board-empty', empty));
    block.append(list);
    return block;
  }

  function archiveAndEdit(item, room) {
    const tools = element('div', 'board-item-tools');
    if (!item.mine && !getSession()?.canManage) return tools;
    const edit = action(`Edit ${kindNames[item.kind].toLowerCase()}`, 'edit', () => editItem(item.kind, item), 'icon-button');
    edit.title = edit.getAttribute('aria-label') || `Edit ${kindNames[item.kind].toLowerCase()}`;
    edit.setAttribute('aria-label', edit.title);
    edit.lastChild.remove();
    const label = item.archived ? 'Restore' : item.kind === 'event' ? 'Cancel event' : 'Archive';
    const archive = action(label, item.archived ? 'show' : 'hide', () => void mutate(archive, room, 'board-action', {
      id: item.id, version: item.version, action: 'archived', active: !item.archived,
    }), 'button subtle');
    tools.append(edit, archive);
    return tools;
  }

  function eventCard(item, room) {
    const card = element('article', 'board-card event-card');
    const timing = element('div', 'event-date');
    const start = new Date(item.starts_at);
    timing.append(element('strong', '', start.toLocaleDateString(undefined, { day: 'numeric' })),
      element('span', '', start.toLocaleDateString(undefined, { month: 'short' })));
    const content = element('div', 'board-card-content');
    const ended = item.starts_at + item.duration * 60000 < Date.now();
    content.append(element('h3', '', item.title), element('p', 'board-card-meta', eventDate.format(start)));
    if (item.location) content.append(element('p', 'board-card-meta', item.location));
    if (item.body) content.append(element('p', 'board-card-body', item.body));
    if (item.archived || ended) content.append(element('small', 'board-state', item.archived ? 'Canceled' : 'Ended'));
    const choices = element('div', 'rsvp-choices');
    for (const [value, label] of [['going', 'Going'], ['maybe', 'Maybe'], ['declined', 'Can’t make it']]) {
      const count = item.responses.filter(response => response.response === value).length;
      const button = action(`${label}${count ? ` · ${count}` : ''}`, '', () => void mutate(button, room, 'event-response', {
        id: item.id, response: value,
      }), 'button rsvp-button');
      button.setAttribute('aria-pressed', String(item.responses.some(response => response.mine && response.response === value)));
      button.disabled = Boolean(item.archived || ended);
      button.title = item.responses.filter(response => response.response === value).map(response => response.name).join(', ');
      choices.append(button);
    }
    content.append(choices);
    const tools = archiveAndEdit(item, room);
    const calendar = action('Add to calendar', 'calendar', () => exportCalendar(item), 'button subtle');
    calendar.disabled = Boolean(item.archived);
    tools.prepend(calendar);
    content.append(tools);
    card.append(timing, content);
    return card;
  }

  function taskCard(item, room) {
    const card = element('article', `board-card task-card${item.completed ? ' task-completed' : ''}`);
    const label = element('label', 'task-check');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(item.completed);
    checkbox.disabled = Boolean(item.archived);
    checkbox.setAttribute('aria-label', `Mark ${item.title} ${item.completed ? 'incomplete' : 'complete'}`);
    checkbox.addEventListener('change', () => void mutate(checkbox, room, 'board-action', {
      id: item.id, version: item.version, action: 'completed', active: checkbox.checked,
    }));
    label.append(checkbox);
    const content = element('div', 'board-card-content');
    content.append(element('h3', '', item.title));
    if (item.body) content.append(element('p', 'board-card-body', item.body));
    content.append(element('small', 'board-card-meta', item.assignee ? `Assigned to ${item.assignee}` : `Added by ${item.creator}`));
    if (item.archived) content.append(element('small', 'board-state', 'Archived'));
    content.append(archiveAndEdit(item, room));
    card.append(label, content);
    return card;
  }

  function announcementCard(item, room) {
    const card = element('article', 'board-card announcement-card');
    const content = element('div', 'board-card-content');
    content.append(element('p', 'board-card-meta', `${item.creator} · ${eventDate.format(new Date(item.updated_at))}`),
      element('h3', '', item.title), element('p', 'board-card-body', item.body));
    if (item.archived) content.append(element('small', 'board-state', 'Archived'));
    content.append(archiveAndEdit(item, room));
    card.append(content);
    return card;
  }

  function planCard(plan, room) {
    const card = element('article', 'board-card plan-card');
    const content = element('div', 'board-card-content');
    const due = plan.due_at <= Date.now();
    const label = plan.kind === 'message' ? (plan.state === 'sent' ? 'Sent message' : 'Scheduled message') : (due ? 'Reminder due' : 'Reminder');
    content.append(element('small', `board-state${due && plan.kind === 'reminder' ? ' reminder-due' : ''}`, label),
      element('p', 'board-card-body', plan.text),
      element('p', 'board-card-meta', `${eventDate.format(new Date(plan.due_at))} · #${plan.channel}`));
    const tools = element('div', 'board-item-tools');
    if (plan.message_id) tools.append(action('Open message', 'reply', () => ui.showMessage(room, plan.channel, plan.message_id), 'button subtle'));
    const remove = action(plan.state === 'sent' || (due && plan.kind === 'reminder') ? 'Dismiss' : 'Cancel', 'close',
      () => void mutate(remove, room, 'plan-action', { id: plan.id }), 'button subtle');
    tools.append(remove);
    content.append(tools);
    card.append(content);
    return card;
  }

  function render() {
    const current = getSession();
    if (!opened || !current || current.room.id !== roomId) return;
    const { room } = current;
    const next = JSON.stringify([room.title, items, plans, tab, showArchived, showCompleted, current.canManage, Math.floor(Date.now() / 60000)]);
    if (signature === next) return;
    signature = next;
    $('board-room-name').textContent = room.title;
    const content = $('board-content');
    const focused = content.contains(document.activeElement) ? document.activeElement.closest('[data-item-id]')?.dataset.itemId : null;
    content.replaceChildren();
    const visible = items.filter(item => showArchived || !item.archived);
    const upcoming = visible.filter(item => item.kind === 'event').sort((a, b) => a.starts_at - b.starts_at);
    const tasks = visible.filter(item => item.kind === 'task' && (showCompleted || !item.completed));
    const announcements = visible.filter(item => item.kind === 'announcement');
    $('board-filters').hidden = tab === 'plans';
    $('board-completed-label').hidden = tab !== 'tasks' && tab !== 'overview';
    for (const button of $('board-tabs').children) button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
    const renderCard = (item, make) => {
      const node = make(item, room);
      node.dataset.itemId = item.id;
      return node;
    };
    if (tab === 'overview') content.append(section('Announcements', announcements.map(item => renderCard(item, announcementCard)),
      'Announcements from your room hosts and admins will appear here.', 'Post announcement', current.canManage ? () => editItem('announcement') : null));
    if (tab === 'events' || tab === 'overview') content.append(section('Events', upcoming.map(item => renderCard(item, eventCard)),
      'Set a time for the next game, hangout, or meetup.', 'Create event', () => editItem('event')));
    if (tab === 'tasks' || tab === 'overview') content.append(section('Shared checklist', tasks.map(item => renderCard(item, taskCard)),
      'Keep track of what the group needs to do.', 'Add task', () => editItem('task')));
    if (tab === 'plans') {
      content.append(element('p', 'board-private-note', 'Your reminders and scheduled messages are visible to you. Scheduled messages become visible to the room when posted.'));
      const tools = element('div', 'board-plan-tools');
      tools.append(action('Schedule a message', 'send', () => planForm('message')), action('New reminder', 'clock', () => planForm('reminder')));
      content.append(tools, section('My plans', plans.map(plan => {
        const node = planCard(plan, room);
        node.dataset.itemId = plan.id;
        return node;
      }), 'Schedule a message or set a reminder to get started.'));
    }
    if (focused) [...content.querySelectorAll('[data-item-id]')].find(node => node.dataset.itemId === focused)?.querySelector('button, input')?.focus();
  }

  function editItem(kind, previous) {
    const current = getSession();
    if (!current) return;
    const { room } = current;
    const id = previous?.id ?? crypto.randomUUID();
    let extra = '';
    if (kind === 'event') extra = `<div class="profile-grid"><label class="field">Starts at<input type="datetime-local" name="startsAt" required></label>
      <label class="field">Duration<select name="duration">${[30, 60, 90, 120, 180, 240, 480, 1440].map(value => `<option value="${value}">${value < 60 ? '30 minutes' : `${value / 60} hours`}</option>`).join('')}</select></label></div>
      <label class="field">Location or voice channel<input name="location" maxlength="100" placeholder="e.g. Lounge voice channel"></label>`;
    if (kind === 'task') extra = '<label class="field">Assign to<select name="assigneeId"><option value="">Anyone</option></select></label>';
    const fields = `<label class="field">Title<input name="title" maxlength="100" required></label>${extra}
      <label class="field">Details<textarea name="body" maxlength="1200" rows="3"></textarea></label>`;
    showDialog(`${previous ? 'Edit' : 'New'} ${kindNames[kind].toLowerCase()}`, dialogForm(fields, previous ? 'Save changes' : `Create ${kindNames[kind].toLowerCase()}`));
    const form = document.querySelector('#dialog-body form');
    const { elements } = form;
    elements.title.value = previous?.title ?? '';
    elements.body.value = previous?.body ?? '';
    if (kind === 'event') {
      elements.startsAt.value = localTime(previous?.starts_at ?? Date.now() + 3600000);
      elements.duration.value = previous?.duration ?? 60;
      elements.location.value = previous?.location ?? '';
    }
    if (kind === 'task') {
      for (const member of current.members) elements.assigneeId.add(new Option(member.name, member.id));
      elements.assigneeId.value = previous?.assignee_id ?? '';
    }
    handleForm(async data => {
      const input = { ...Object.fromEntries(data), id, kind, version: previous?.version };
      if (kind === 'event') {
        input.startsAt = new Date(input.startsAt).getTime();
        input.duration = Number(input.duration);
      }
      await roomApi(room, 'board', input);
      if (form.isConnected) closeDialog();
      toast(previous ? 'Changes saved.' : `${kindNames[kind]} created.`);
      await refresh(true);
    });
  }

  function planForm(kind, source) {
    const current = getSession();
    if (!current) return;
    const { room, channel } = current;
    const id = crypto.randomUUID();
    const fields = `<label class="field">${kind === 'message' ? 'Message' : 'Reminder'}<textarea name="text" rows="3" maxlength="${kind === 'message' ? 4000 : 200}" required></textarea></label>
      <label class="field">${kind === 'message' ? 'Post at' : 'Remind me at'}<input name="dueAt" type="datetime-local" required></label>`;
    const intro = kind === 'message'
      ? `Scheduled messages post when someone has the room open at or after the chosen time. Channel slow mode applies. They are posted as text.`
      : 'Reminders appear while you have this room open, or the next time you open it.';
    showDialog(kind === 'message' ? 'Schedule a message' : 'Set a reminder', dialogForm(fields, kind === 'message' ? 'Schedule message' : 'Save reminder', intro));
    const form = document.querySelector('#dialog-body form');
    form.elements.text.value = source?.text?.slice(0, 200) ?? (kind === 'message' ? ui.getDraft() : '');
    form.elements.dueAt.value = localTime(Date.now() + 3600000);
    form.elements.dueAt.min = localTime(Date.now() + 120000);
    form.elements.dueAt.max = localTime(Date.now() + 30 * 86400000);
    handleForm(async data => {
      const input = { id, kind, channel, text: data.get('text'), dueAt: new Date(data.get('dueAt')).getTime(), messageId: source?.id };
      await roomApi(room, 'plans', input);
      if (form.isConnected) closeDialog();
      toast(kind === 'message' ? 'Message scheduled. Manage it in My plans.' : 'Reminder saved.');
      await refresh(true);
    });
  }

  function exportCalendar(item) {
    const escape = text => String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r/g, '');
    const stamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const fields = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Room Events//EN', 'BEGIN:VEVENT',
      `UID:${item.id}@room-events`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(item.starts_at)}`,
      `DTEND:${stamp(item.starts_at + item.duration * 60000)}`, `SUMMARY:${escape(item.title)}`,
      `DESCRIPTION:${escape(item.body)}`, `LOCATION:${escape(item.location)}`, 'END:VEVENT', 'END:VCALENDAR'];
    const url = URL.createObjectURL(new Blob([fields.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'room-event.ics';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function refresh(force = false) {
    const current = getSession();
    if (!current) return;
    if (refreshing) {
      refreshAgain ||= force;
      return;
    }
    if (!force && roomId === current.room.id && Date.now() < nextRefresh) return;
    const { room } = current;
    if (roomId !== room.id) {
      roomId = room.id;
      items = [];
      plans = [];
      signature = null;
    }
    refreshing = true;
    nextRefresh = Date.now() + (opened ? 8000 : 20000);
    try {
      const [board, personal] = await Promise.all([roomApi(room, 'board'), roomApi(room, 'plans')]);
      if (getSession()?.room.id !== room.id) return;
      items = board.items;
      plans = personal.items;
      $('board-feedback').textContent = '';
      const due = plans.filter(plan => plan.kind === 'reminder' && plan.state === 'pending' && plan.due_at <= Date.now());
      for (const plan of due) ui.remind(room.id, plan);
      $('board-plan-count').hidden = !due.length;
      $('board-plan-count').textContent = due.length;
      render();
    } catch (error) {
      if (opened && getSession()?.room.id === room.id) $('board-feedback').textContent = error.message;
    } finally {
      refreshing = false;
      if (refreshAgain) {
        refreshAgain = false;
        void refresh(true);
      }
    }
  }

  function open(selected = 'overview') {
    if (!getSession()) return;
    opened = true;
    tab = selected;
    signature = null;
    $('board-view').hidden = false;
    render();
    void refresh(true);
  }

  function close() {
    opened = false;
    $('board-view').hidden = true;
  }

  for (const [key, title] of Object.entries(tabs)) {
    const button = action(title, '', () => { tab = key; signature = null; render(); });
    button.dataset.tab = key;
    $('board-tabs').append(button);
  }
  $('board-archived').addEventListener('change', event => { showArchived = event.target.checked; render(); });
  $('board-completed').addEventListener('change', event => { showCompleted = event.target.checked; render(); });
  $('board-refresh').addEventListener('click', () => void refresh(true));
  return { get isOpen() { return opened; }, open, close, refresh, planForm };
}
