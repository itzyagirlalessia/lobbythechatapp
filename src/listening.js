// The Spotify card loads only while a room profile is open.
import { state } from './state.js';
import { $, api, element, icon } from './ui.js';
import { positionMemberCard } from './people.js';

const slots = new WeakMap();

function timeLabel(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function drawTrack(node, details, track) {
  const focused = node.contains(document.activeElement) && details.track?.url === track?.url;
  details.track = track;
  details.updateProgress = null;
  node.hidden = !track;
  node.replaceChildren();
  if (!track) {
    if (node.isConnected) positionMemberCard();
    return;
  }

  const heading = element('div', 'listening-heading');
  const label = element('span', '', track.live ? 'Now listening' : 'Shared track');
  const logo = element('img', 'listening-provider');
  logo.src = '/spotify-logo.svg';
  logo.alt = 'Spotify';
  heading.append(label, logo);

  const link = element('a', 'listening-track');
  link.href = track.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const fallback = element('span', 'listening-cover-placeholder');
  fallback.innerHTML = icon('music');
  if (track.image) {
    const cover = element('img', 'listening-cover');
    cover.src = track.image;
    cover.alt = '';
    cover.addEventListener('error', () => cover.replaceWith(fallback), { once: true });
    link.append(cover);
  } else {
    link.append(fallback);
  }
  const info = element('span', 'listening-info');
  info.append(element('strong', '', track.title));
  if (track.artist) info.append(element('span', 'listening-artist', track.artist));
  info.append(element('span', 'listening-open', 'Open in Spotify'));
  link.append(info);
  node.append(heading, link);

  if (track.live && track.position != null && track.duration) {
    const elapsed = element('span');
    const duration = element('span', '', timeLabel(track.duration));
    const meter = element('progress');
    meter.max = track.duration;
    meter.setAttribute('aria-label', 'Track playback progress');
    const controls = element('div', 'listening-progress');
    controls.append(elapsed, meter, duration);
    node.append(controls);
    const received = performance.now();
    details.updateProgress = () => {
      const position = Math.min(track.duration, track.position + track.age + performance.now() - received);
      elapsed.textContent = timeLabel(position);
      meter.value = position;
    };
    details.updateProgress();
  }
  if (node.isConnected) positionMemberCard();
  if (focused) link.focus({ preventScroll: true });
}

function runProgress(node, details) {
  if (!details.updateProgress || details.timer) return;
  details.timer = setInterval(() => {
    if (!details.updateProgress || !node.isConnected || !$('member-card').matches(':popover-open')) {
      clearInterval(details.timer);
      details.timer = null;
      return;
    }
    if (Date.now() > details.expires) {
      drawTrack(node, details, details.fallback);
      return;
    }
    if (!document.hidden) details.updateProgress();
  }, 1000);
}

export function listeningSlot(member, previous) {
  const activity = member.activity;
  const live = Boolean(activity?.spotifyLive && member.online);
  const url = activity?.spotifyTrack;
  if (!live && !url) return null;
  const current = state.session;
  const key = JSON.stringify([current?.room.id, member.id, live, url, activity.spotifyArtist]);
  if (slots.get(previous)?.key === key) return previous;
  const node = element('section', 'listening-card');
  node.setAttribute('aria-label', 'Spotify activity');
  const fallback = url ? { title: 'Spotify track', url, artist: activity.spotifyArtist } : null;
  const details = { key, live, fallback, nextRead: 0 };
  slots.set(node, details);
  drawTrack(node, details, fallback);
  return node;
}

export async function refreshProfileListening(current) {
  if (!current || current !== state.session || document.hidden || !$('member-card').matches(':popover-open')) return;
  const panel = $('member-profile');
  const node = panel.querySelector('.listening-card');
  const details = slots.get(node);
  if (!details) return;
  if (details.track?.live && Date.now() > details.expires) drawTrack(node, details, details.fallback);
  runProgress(node, details);
  if (details.loading || Date.now() < details.nextRead) return;
  details.loading = true;
  try {
    const { track } = await api('/rooms/' + current.room.id + '/listening?member=' + panel.dataset.memberId, { access: current.room.access });
    if (current !== state.session || !node.isConnected || !$('member-card').matches(':popover-open')) return;
    details.nextRead = Date.now() + (details.live ? 12_000 : 300_000);
    details.expires = Date.now() + 22_000 - (track?.age || 0);
    drawTrack(node, details, track);
    runProgress(node, details);
  } catch {
    details.nextRead = Date.now() + 15_000;
  } finally {
    details.loading = false;
  }
}
