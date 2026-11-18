// Saved browser data (rooms, drafts, preferences) and the shared `state` object.
import { toast } from './ui.js';

const storageKey = 'duo-chat-rooms-v1';

export const saved = readStorage();

export const drafts = new Map(Object.entries(saved.drafts ?? {}));
export const preferences = { compact: false, largeText: false, enterSends: true, desktopNotifications: false, ...saved.preferences };

function readStorage() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(value?.rooms)) return value;
  } catch {
    // A new profile also works with storage disabled.
  }
  return { rooms: [], active: null, name: '' };
}

export function saveStorage() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    toast('This browser couldn’t save your rooms for next time.');
  }
}

// Values that several modules read and replace. Always use state.session (etc.), never a local copy.
export const state = {
  admin: false,
  selfProfile: undefined,
  providers: {},
  session: undefined,
  usernameSetup: false,
  refreshTimer: undefined,
  mentionSuggestions: undefined,
  bookmarks: Array.isArray(saved.bookmarks) ? saved.bookmarks.slice(0, 40) : [],
};
