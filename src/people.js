// Member list, member profile cards, live activity and the ChatGPT status.
import { state } from './state.js';
import { $, api, avatar, closeDialog, closeMemberCard, color, element, icon, showDialog, toast } from './ui.js';
import { paintCover } from './profile.js';
import { showAiSettings, showRoomBan } from './room-settings.js';
import { social } from './app.js';

let memberCardAnchorTop = 0;

function linkedActivityKey(member) {
  const linked = member.activity?.connections;
  return member.online && linked ? `${linked.steam}|${linked.lastfm}` : '';
}

function activityRows(member) {
  const activity = member.activity;
  if (!activity) return [];
  const live = state.session?.live.get(member.id);
  const fresh = live?.key && live.key === linkedActivityKey(member) && live.expires > Date.now() ? live : {};
  return [
    { icon: 'game', label: 'Playing', title: fresh.game || activity.game, source: fresh.game ? 'Steam' : '' },
    { icon: 'music', label: 'Listening to', title: fresh.music || activity.music, source: fresh.music ? 'Last.fm' : '' },
  ].filter(row => row.title);
}

export function roomMember(current, id) {
  return current.members.find(member => member.id === id || member.memberIds?.includes(id));
}

export function showMemberProfile(member, trigger, isOwn = Boolean(member.mine) || member.id === state.session?.room.memberId) {
  memberCardAnchorTop = trigger.getBoundingClientRect().top;
  closeDialog();
  const popup = $('member-card');
  const panel = $('member-profile');
  panel.dataset.memberId = member.id;
  panel.dataset.own = String(isOwn);
  $('member-card-actions').hidden = !isOwn;
  renderMemberProfile(member);
  if (!popup.matches(':popover-open')) popup.showPopover();
  positionMemberCard();
}

export function positionMemberCard() {
  const popup = $('member-card');
  if (!popup.matches(':popover-open')) return;
  const available = window.innerHeight - popup.offsetHeight;
  const top = window.innerWidth <= 620 ? available / 2 : memberCardAnchorTop - 20;
  popup.style.setProperty('--card-top', `${Math.max(12, Math.min(top, available - 12))}px`);
}

function renderMemberProfile(member) {
  const panel = $('member-profile');
  if (panel?.dataset.memberId !== member.id) return;
  const activities = activityRows(member);
  const isAdmin = panel.dataset.own === 'true' && state.admin;
  const signature = JSON.stringify([member, activities, isAdmin]);
  if (panel.dataset.profileSignature === signature) return;
  panel.dataset.profileSignature = signature;
  const header = element('div', 'member-popup-header');
  const cover = element('div', 'profile-cover');
  paintCover(cover, member.color ?? color(member.id), member.banner);
  const picture = avatar(member.name, member.id, member.color, member.avatar);
  picture.classList.toggle('online', member.online);
  const title = element('h2', 'member-popup-name', member.name);
  title.id = 'member-card-title';
  const meta = element('div', 'member-popup-meta');
  meta.append(element('span', member.online ? 'member-presence online' : 'member-presence', member.online ? 'Online' : 'Away'));
  if (member.host) meta.append(element('span', 'member-role', 'Room host'));
  if (isAdmin) meta.append(element('span', 'member-role', 'Lobby admin'));
  header.append(cover, picture, title);
  if (member.username) header.append(element('p', 'member-popup-username', member.username));
  header.append(meta);
  const details = element('div', 'member-popup-details');
  if (member.status) details.append(element('p', 'profile-status', member.status));
  if (member.bio) details.append(element('p', 'member-bio', member.bio));
  if (member.details?.length) {
    const facts = element('dl', 'profile-facts');
    for (const { label, value } of member.details) {
      const fact = element('div');
      fact.append(element('dt', '', label), element('dd', '', value));
      facts.append(fact);
    }
    details.append(facts);
  }
  for (const activity of activities) {
    const row = element('div', 'member-activity');
    const glyph = element('span', 'activity-glyph');
    glyph.innerHTML = icon(activity.icon);
    const info = element('div');
    info.append(element('small', '', activity.source ? `${activity.label} · ${activity.source}` : activity.label));
    info.append(element('strong', '', activity.title));
    row.append(glyph, info);
    details.append(row);
  }
  const links = element('div', 'profile-links');
  for (const [key, label] of [['steam', 'Steam'], ['lastfm', 'Last.fm'], ['spotify', 'Spotify']]) {
    const href = member.activity?.connections[key];
    if (!href) continue;
    const link = element('a', 'button outline');
    link.innerHTML = icon('link');
    link.append(label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
  }
  if (links.childElementCount) details.append(links);
  if (panel.dataset.own !== 'true') {
    const tools = element('div', 'profile-links');
    if (member.username && member.username !== state.selfProfile?.username) {
      const add = element('button', 'button subtle', 'Add friend');
      add.addEventListener('click', () => void social.addFriend(member.username).catch(error => toast(error.message)));
      const message = element('button', 'button primary', 'Message');
      message.addEventListener('click', () => void social.startDirect(member.username).catch(error => toast(error.message)));
      const block = element('button', 'button outline', 'Block');
      block.addEventListener('click', () => social.blockPerson(member));
      tools.append(add, message, block);
    }
    if (state.session?.canManage && !member.host && member.username !== state.selfProfile?.username && member.id !== state.session.room.memberId) {
      const ban = element('button', 'button outline', 'Ban from room');
      ban.addEventListener('click', () => showRoomBan(member));
      tools.append(ban);
    }
    if (tools.childElementCount) details.append(tools);
  }
  panel.replaceChildren(header);
  if (details.childElementCount) panel.append(details);
  positionMemberCard();
}

function makePeople(members) {
  return members.map(member => {
    const node = element('button', 'person');
    node.dataset.memberId = member.id;
    node.setAttribute('aria-label', `View ${member.name}’s profile`);
    node.setAttribute('aria-haspopup', 'dialog');
    node.addEventListener('click', () => showMemberProfile(member, node));
    const initials = avatar(member.name, member.id, member.color, member.avatar);
    initials.classList.toggle('online', member.online);
    const detail = element('span', 'person-detail');
    detail.append(element('strong', '', member.name + (member.mine || state.session.room.memberId === member.id ? ' (you)' : '')));
    detail.append(element('small', '', `${member.host ? 'Host · ' : ''}${member.online ? 'Online' : 'Away'}`));
    if (member.status) detail.append(element('small', 'person-status', member.status));
    for (const activity of activityRows(member)) {
      const badge = element('small', 'activity-line');
      badge.innerHTML = icon(activity.icon);
      badge.append(element('span', '', `${activity.label} ${activity.title}`));
      detail.append(badge);
    }
    node.append(initials, detail);
    return node;
  });
}

export function renderPeople(members) {
  for (const list of [$('people-list'), $('mobile-members')]) {
    if (!list) continue;
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.memberId : null;
    list.replaceChildren(...makePeople(members));
    if (focused) Array.from(list.children).find(button => button.dataset.memberId === focused)?.focus();
  }
  $('people-count').textContent = members.length;
  const online = members.filter(member => member.online).length;
  $('room-subtitle').textContent = members.length ? `${members.length} ${members.length === 1 ? 'person' : 'people'} · ${online} online` : 'Connecting…';
  if ($('member-card').matches(':popover-open')) {
    const shown = members.find(member => member.id === $('member-profile').dataset.memberId);
    if (shown) renderMemberProfile(shown);
    else closeMemberCard();
  }
}

export async function refreshActivity(current) {
  if (document.hidden || current.refreshingActivity || Date.now() < (current.nextActivityRefresh ?? 0)) return;
  const candidates = current.members.filter(member => member.online && member.activity &&
    ((state.providers.steam && member.activity.connections.steam) || (state.providers.lastfm && member.activity.connections.lastfm)));
  if (!candidates.length) return;
  current.nextActivityRefresh = Date.now() + 45_000;
  current.refreshingActivity = true;
  try {
    for (let start = 0; start < candidates.length && state.session === current; start += 6) {
      const results = await Promise.allSettled(candidates.slice(start, start + 6).map(async member => {
        const status = await api(`/rooms/${current.room.id}/activity?member=${member.id}`, { access: current.room.access });
        return [member.id, { ...status, key: linkedActivityKey(member), expires: Date.now() + 55_000 }];
      }));
      if (state.session !== current) return;
      for (const result of results) if (result.status === 'fulfilled') current.live.set(...result.value);
      renderPeople(current.members);
    }
  } finally {
    current.refreshingActivity = false;
  }
}

export function showPeople() {
  if (!state.session) return;
  showDialog('People in this room', '<div id="mobile-members"></div><div class="dialog-actions below"><button class="button subtle" id="mobile-ai"></button></div>');
  $('mobile-members').append(...makePeople(state.session.members));
  $('mobile-ai').textContent = state.session.aiConnected ? 'ChatGPT connected' : 'ChatGPT setup';
  $('mobile-ai').addEventListener('click', showAiSettings);
}

export function updateAi(current) {
  $('ai-status').textContent = current.aiConnected ? 'Ready to mention' : 'Needs an API key';
  $('ai-settings').textContent = current.aiConnected ? 'Manage connection' : 'Connect ChatGPT';
  $('ai-settings').hidden = !current.room.host;
}
