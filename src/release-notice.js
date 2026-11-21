// Shows a release once after startup or username setup, and lets members reopen it from Help.
import { latestRelease } from './releases.js';
import { $, api, element, icon } from './ui.js';

let storageKey;
let signedIn;
let awaitingDismissal = false;

function dismissedOnThisBrowser() {
  try {
    return Number(localStorage.getItem(storageKey)) >= latestRelease.number;
  } catch {
    return false;
  }
}

function saveToAccount() {
  if (signedIn) {
    // The browser receipt lets the next visit retry if the request fails during navigation.
    void api('/profile/seen-release', { input: { release: latestRelease.number }, keepalive: true }).catch(() => {});
  }
}

function showPendingRelease() {
  if (!awaitingDismissal || document.hidden || $('dialog').open || $('release-dialog').open) return;
  if (dismissedOnThisBrowser()) {
    awaitingDismissal = false;
    saveToAccount();
    return;
  }
  showReleaseNotes();
}

export function prepareReleaseNotice(data) {
  signedIn = data.signedIn;
  storageKey = `lobby-seen-release:${data.browserAccount || 'guest'}`;
  awaitingDismissal = data.seenRelease < latestRelease.number;
  showPendingRelease();
}

export function bindReleaseNotice() {
  $('dialog').addEventListener('close', showPendingRelease);
  document.addEventListener('visibilitychange', showPendingRelease);
  $('release-dialog').addEventListener('close', () => {
    if (!awaitingDismissal) return;
    awaitingDismissal = false;
    try {
      if (!dismissedOnThisBrowser()) localStorage.setItem(storageKey, String(latestRelease.number));
    } catch {
      // Signed-in members can still save their receipt to their account.
    }
    saveToAccount();
  });
}

export function showReleaseNotes() {
  const dialog = $('release-dialog');
  if (dialog.open) return;
  const date = $('release-date');
  date.dateTime = latestRelease.date;
  date.textContent = new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'long', timeZone: 'UTC' })
    .format(new Date(latestRelease.date));
  const highlights = latestRelease.highlights.map(([glyph, title, description]) => {
    const item = element('li');
    const marker = element('span', 'release-icon');
    marker.innerHTML = icon(glyph);
    const text = element('div');
    text.append(element('strong', '', title), element('p', '', description));
    item.append(marker, text);
    return item;
  });
  $('release-highlights').replaceChildren(...highlights);
  dialog.showModal();
}
