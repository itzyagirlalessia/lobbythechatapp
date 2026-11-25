// Saved browser data (rooms, drafts, preferences) and the shared `state` object.
import { toast } from './ui.js';

const legacyStorageKey = 'duo-chat-rooms-v1';
let storageKey;
const defaults = { compact: false, largeText: false, enterSends: true, desktopNotifications: false, sidebarWidth: 224 };

export const saved = { rooms: [], active: null, name: '' };

export const drafts = new Map();
export const preferences = { ...defaults };

function readStorage(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(value?.rooms)) return value;
  } catch {
    // A new profile also works with storage disabled.
  }
  return null;
}

function mergeLegacyStorage(legacy, ids) {
  const allowed = new Set(ids);
  const known = new Set(saved.rooms.map(room => room.id));
  const rooms = legacy.rooms.filter(room => allowed.has(room?.id));
  saved.rooms.push(...rooms.filter(room => !known.has(room.id)));
  saved.active ??= allowed.has(legacy.active) ? legacy.active : null;
  saved.name ||= rooms[0]?.name || '';
  const oldDrafts = Object.entries(legacy.drafts ?? {}).filter(([key]) => allowed.has(key.split(':')[0]));
  saved.drafts = { ...Object.fromEntries(oldDrafts), ...saved.drafts };
  const marks = [...(saved.bookmarks ?? []), ...(legacy.bookmarks ?? []).filter(mark => allowed.has(mark?.roomId))];
  saved.bookmarks = [...new Map(marks.map(mark => [mark.roomId + ':' + mark.id, mark])).values()].slice(0, 40);
  saved.preferences ??= legacy.preferences;
}

export async function loadAccountStorage(account, verify) {
  const key = legacyStorageKey + ':' + (account || 'guest');
  const stored = readStorage(key);
  Object.assign(saved, stored);
  if (!saved.importedLegacy) {
    const legacy = readStorage(legacyStorageKey);
    const candidates = legacy?.rooms.filter(room => room?.id && room?.access).map(({ id, access }) => ({ id, access })) ?? [];
    try {
      const allowed = [];
      for (let start = 0; start < candidates.length; start += 100) {
        const result = await verify(candidates.slice(start, start + 100));
        allowed.push(...result.rooms);
      }
      if (legacy) mergeLegacyStorage(legacy, allowed);
      saved.importedLegacy = true;
    } catch {
      // Retry importing next time, after room ownership can be confirmed.
    }
  }
  storageKey = key;
  Object.assign(preferences, defaults, saved.preferences);
  for (const [key, value] of Object.entries(saved.drafts ?? {})) drafts.set(key, value);
  state.bookmarks = Array.isArray(saved.bookmarks) ? saved.bookmarks.slice(0, 40) : [];
}

export function saveStorage() {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    toast('This browser couldn’t save your rooms for next time.');
  }
}

// Values that several modules read and replace. Always use state.session (etc.), never a local copy.
export const state = {
  admin: false,
  staging: false,
  selfProfile: undefined,
  providers: {},
  session: undefined,
  usernameSetup: false,
  refreshTimer: undefined,
  mentionSuggestions: undefined,
  signedIn: false,
  bookmarks: [],
};
