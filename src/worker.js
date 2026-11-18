import { assets } from './assets.js';

const encoder = new TextEncoder();
const model = 'gpt-5.4-mini';
const onlineWindow = 60_000;
const voiceWindow = 30_000;
const tokenPattern = /^[a-f0-9]{48}$/;
const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;
const channelPattern = /^[a-z\d]+(?:-[a-z\d]+)*$/;
const slowModes = [0, 5, 10, 30, 60, 120];
const usernamePattern = /^[a-z0-9_]{3,24}$/;
const reservedUsernames = new Set([
  'alessdefles#0000',
  'romeestorm#0000',
  'elaramoon#0000',
  'hergametech#0000',
  'tydex#0000',
  'pedroootje#0000',
  'twinkieletissier#0000',
  'specialneedsmusic#0000',
]);
const gifLimit = 3_000_000;
const gifMaxDimension = 4096;
const reactionOptions = new Set(['👍', '💜', '😂', '🎉', '👀', '🔥']);
const activityCache = new Map();
const security = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { ...security, 'Cache-Control': 'no-store' } });
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function token() {
  return hex(crypto.getRandomValues(new Uint8Array(24)));
}

async function hash(value) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

function toBytes(base64) {
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

async function roomKey(env) {
  if (!env.ROOM_KEY_ENCRYPTION) throw new AppError(503, 'ChatGPT setup is unavailable on this deployment.');
  return crypto.subtle.importKey('raw', toBytes(env.ROOM_KEY_ENCRYPTION), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptKey(env, roomId, apiKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await roomKey(env);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(roomId) }, key, encoder.encode(apiKey));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(ciphertext)))}`;
}

async function decryptKey(env, roomId, value) {
  const [iv, ciphertext] = value.split('.').map(toBytes);
  const key = await roomKey(env);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(roomId) }, key, ciphertext);
  return new TextDecoder().decode(plain);
}

async function body(request, limit = 24_000) {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json' || !request.body) {
    throw new AppError(415, 'Send a JSON request.');
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError(413, 'This request is too large.');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try {
    const parsed = JSON.parse(text + decoder.decode());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Return a consistent error for malformed JSON.
  }
  throw new AppError(400, 'Send a valid JSON object.');
}

function requiredText(value, limit, label) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || trimmed.length > limit) throw new AppError(400, `${label} must be 1–${limit} characters.`);
  return trimmed;
}

function personName(value) {
  const name = requiredText(value, 32, 'Display name');
  if (/^(chat\s*gpt|room update)$/i.test(name)) throw new AppError(400, 'Choose a different display name.');
  if (reservedUsernames.has(name.normalize('NFKC').toLowerCase().replace(/\s*#\s*/g, '#'))) {
    throw new AppError(400, 'This name is reserved. Choose a different display name.');
  }
  return name;
}

function usernameBase(value) {
  const base = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!usernamePattern.test(base)) throw new AppError(400, 'Use 3–24 letters, numbers, or underscores. Duo Chat adds your four-digit tag.');
  return base;
}

function accountId(request) {
  return request.headers.get('oai-authenticated-user-id') || null;
}

function accountAssignment(env, email) {
  if (!email || !env.DUO_ACCOUNT_ASSIGNMENTS) return null;
  try {
    return JSON.parse(env.DUO_ACCOUNT_ASSIGNMENTS)?.[email] ?? null;
  } catch {
    return null;
  }
}

function optionalText(value, limit, label) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.trim().length > limit) throw new AppError(400, `${label} is too long or invalid.`);
  return value.trim();
}

function accentColor(value) {
  if (!Number.isInteger(value) || value < 0 || value > 4) throw new AppError(400, 'Choose an accent color.');
  return value;
}

function detailsList(value) {
  if (!Array.isArray(value) || value.length > 5) throw new AppError(400, 'Add up to five profile details.');
  return value.map(detail => ({ label: requiredText(detail?.label, 25, 'Detail label'), value: requiredText(detail?.value, 100, 'Detail value') }));
}

function mediaUrl(key) {
  return key ? `/media/${key}` : '';
}

function picture(value, limit) {
  const header = typeof value === 'string' && value.match(/^data:image\/(webp|jpeg|png|gif);base64,/);
  if (!header) throw new AppError(400, 'Choose a PNG, JPEG, WebP, or GIF image.');
  const type = header[1];
  const byteLimit = type === 'gif' ? gifLimit : limit;
  if (value.length - header[0].length > Math.ceil(byteLimit / 3) * 4) throw new AppError(400, 'This picture is too large. Choose a smaller image.');
  let bytes;
  try {
    bytes = toBytes(value.slice(header[0].length));
  } catch {
    throw new AppError(400, 'This image cannot be read.');
  }
  const prefix = hex(bytes.subarray(0, 12));
  const signatures = { webp: /^52494646.{8}57454250$/, png: /^89504e470d0a1a0a/, jpeg: /^ffd8ff/, gif: /^474946383[79]61/ };
  if (!signatures[type].test(prefix) || bytes.length > byteLimit) throw new AppError(400, 'This image cannot be read or is too large.');
  if (type === 'gif') {
    if (bytes.length < 14) throw new AppError(400, 'This GIF cannot be read.');
    const width = bytes[6] + bytes[7] * 256;
    const height = bytes[8] + bytes[9] * 256;
    if (!width || !height || Math.max(width, height) > gifMaxDimension) throw new AppError(400, 'Choose a GIF no wider or taller than 4096 pixels.');
  }
  return { bytes, contentType: `image/${type}` };
}

async function prunePictures(env, keys) {
  for (const key of keys.filter(Boolean)) {
    try {
      const used = await env.DB.prepare(`SELECT 1 FROM profiles WHERE avatar_key = ? OR banner_key = ?
        UNION ALL SELECT 1 FROM rooms WHERE icon_key = ? UNION ALL SELECT 1 FROM messages WHERE image_key = ? LIMIT 1`).bind(key, key, key, key).first();
      if (!used) await env.BUCKET.delete(key);
    } catch {
      console.error('Duo Chat could not remove an unused picture.');
    }
  }
}

async function savePictures(env, ctx, fields, write) {
  const keys = {};
  const staged = [];
  const replaced = [];
  let saved = false;
  try {
    for (const { name, input, old, limit } of fields) {
      const previous = old ?? null;
      if (input === undefined) {
        keys[name] = previous;
        continue;
      }
      if (!env.BUCKET) throw new AppError(503, 'Picture storage is unavailable.');
      keys[name] = null;
      if (input !== null) {
        const { bytes, contentType } = picture(input, limit);
        const key = crypto.randomUUID();
        staged.push(key);
        await env.BUCKET.put(key, bytes, { httpMetadata: { contentType } });
        keys[name] = key;
      }
      if (previous) replaced.push(previous);
    }
    const entry = await write(keys);
    if (!entry) throw new AppError(409, 'These pictures changed in another tab. Reopen the editor and try again.');
    saved = true;
    return entry;
  } finally {
    const cleanup = saved ? replaced : staged;
    if (cleanup.length) ctx.waitUntil(prunePictures(env, cleanup));
  }
}

async function servePicture(request, env, key) {
  const viewer = accountId(request);
  if (!viewer || !env.DB || !env.BUCKET || !idPattern.test(key)) return new Response(null, { status: 404 });
  const permitted = await env.DB.prepare(`
    SELECT 1 FROM profiles p WHERE (p.avatar_key = ? OR p.banner_key = ?) AND (p.account_id = ? OR EXISTS (
      SELECT 1 FROM members owner JOIN members guest ON guest.room_id = owner.room_id
      WHERE owner.account_id = p.account_id AND guest.account_id = ?
        AND NOT EXISTS (SELECT 1 FROM room_bans b WHERE b.room_id = guest.room_id AND b.actor IN ('account:' || guest.account_id, 'account:' || owner.account_id))) OR (
      EXISTS (SELECT 1 FROM friendships f WHERE f.state = 'accepted' AND ((f.first_account = p.account_id AND f.second_account = ?) OR (f.second_account = p.account_id AND f.first_account = ?)))
      AND NOT EXISTS (SELECT 1 FROM account_blocks b WHERE (b.blocker = p.account_id AND b.blocked = ?) OR (b.blocked = p.account_id AND b.blocker = ?))))
    UNION ALL SELECT 1 FROM rooms r JOIN members m ON m.room_id = r.id WHERE r.icon_key = ? AND m.account_id = ?
      AND NOT EXISTS (SELECT 1 FROM room_bans b WHERE b.room_id = m.room_id AND b.actor = 'account:' || m.account_id)
    UNION ALL SELECT 1 FROM messages msg JOIN members m ON m.room_id = msg.room_id WHERE msg.image_key = ? AND m.account_id = ?
      AND msg.hidden_at IS NULL AND msg.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM room_bans b WHERE b.room_id = m.room_id AND b.actor = 'account:' || m.account_id) LIMIT 1
  `).bind(key, key, viewer, viewer, viewer, viewer, viewer, viewer, key, viewer, key, viewer).first();
  if (!permitted) return new Response(null, { status: 404 });
  const file = await env.BUCKET.get(key);
  if (!file) return new Response(null, { status: 404 });
  return new Response(request.method === 'HEAD' ? null : file.body, {
    headers: { 'Content-Type': file.httpMetadata.contentType, 'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" },
  });
}

function accountLink(value, provider) {
  const labels = { steam: 'Steam', lastfm: 'Last.fm', spotify: 'Spotify' };
  const text = optionalText(value, 500, labels[provider]);
  if (!text) return '';
  const hosts = { steam: 'steamcommunity.com', lastfm: 'www.last.fm', spotify: 'open.spotify.com' };
  const paths = { steam: /^\/(id|profiles)\/([\w-]+)\/?$/, lastfm: /^\/user\/([\w-]+)\/?$/, spotify: /^\/user\/([\w.-]+)\/?$/ };
  try {
    if (provider === 'lastfm' && /^[\w-]{1,32}$/.test(text)) return text;
    if (provider === 'steam' && /^\d{17}$/.test(text)) return `profiles/${text}`;
    const url = new URL(text);
    const path = url.pathname.match(paths[provider]);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && path && url.hostname === hosts[provider]) {
      if (provider === 'steam') {
        if ((path[1] === 'profiles' && /^\d{17}$/.test(path[2])) || (path[1] === 'id' && path[2].length <= 32)) return `${path[1]}/${path[2]}`;
      } else if (path[1].length <= (provider === 'lastfm' ? 32 : 96)) return path[1];
    }
  } catch {
    // Invalid or unrelated URLs use the same field-level error.
  }
  throw new AppError(400, `Enter ${provider === 'lastfm' ? 'your Last.fm username or profile link' : `a valid ${labels[provider]} profile link${provider === 'steam' ? ' or SteamID64' : ''}`}.`);
}

function connections(entry) {
  return {
    steam: entry.steam ? `https://steamcommunity.com/${entry.steam}/` : '',
    lastfm: entry.lastfm ? `https://www.last.fm/user/${entry.lastfm}` : '',
    spotify: entry.spotify ? `https://open.spotify.com/user/${entry.spotify}` : '',
  };
}

function profileData(entry) {
  return {
    displayName: entry?.display_name || '', username: entry?.username || '', bio: entry?.bio || '', color: entry?.color ?? 0,
    usernameAssigned: reservedUsernames.has(entry?.username),
    status: activeStatus(entry),
    game: entry?.game || '', music: entry?.music || '', shareActivity: Boolean(entry?.share_activity),
    connections: connections(entry || {}), avatar: mediaUrl(entry?.avatar_key), banner: mediaUrl(entry?.banner_key),
    details: JSON.parse(entry?.details_json || '[]'),
  };
}

function activeStatus(profile, now = Date.now()) {
  return profile?.status_text && (profile.status_until === null || profile.status_until > now) ? profile.status_text : '';
}

async function updateStatus(db, id, input) {
  if (!id) throw new AppError(401, 'Sign in to set a status.');
  const status = optionalText(input.status, 80, 'Status');
  const { minutes } = input;
  if (![0, 60, 240, 1440].includes(minutes)) throw new AppError(400, 'Choose when to clear your status.');
  const until = status && minutes ? Date.now() + minutes * 60_000 : null;
  await db.prepare('UPDATE profiles SET status_text = ?, status_until = ? WHERE account_id = ?').bind(status, until, id).run();
  return { status };
}

function liveProviders(env) {
  return { steam: Boolean(env.DUO_STEAM_API_KEY), lastfm: Boolean(env.DUO_LASTFM_API_KEY) };
}

function usernameConflict(error) {
  return String(error.message).includes('UNIQUE constraint failed: profiles.username');
}

function usernameRequired() {
  return new AppError(409, 'Choose a username before entering a room.', 'username_required');
}

async function assignReservedUsername(db, id, username) {
  try {
    return await db.prepare(`INSERT INTO profiles (account_id, username) VALUES (?, ?)
      ON CONFLICT(account_id) DO UPDATE SET username = excluded.username RETURNING *`).bind(id, username).first();
  } catch (error) {
    if (usernameConflict(error)) throw new AppError(409, 'This assigned username is linked to another account.');
    throw error;
  }
}

async function withRandomTag(db, base, save) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { results } = await db.prepare('SELECT username FROM profiles WHERE username BETWEEN ? AND ?')
      .bind(`${base}#0000`, `${base}#9999`).all();
    const used = new Set(results.map(entry => entry.username));
    if (reservedUsernames.has(`${base}#0000`)) used.add(`${base}#0000`);
    if (used.size >= 10_000) throw new AppError(409, 'All tags for this username are taken. Choose another name.');
    let index = crypto.getRandomValues(new Uint32Array(1))[0] % (10_000 - used.size);
    for (let tag = 0; tag < 10_000; tag += 1) {
      const candidate = `${base}#${String(tag).padStart(4, '0')}`;
      if (used.has(candidate) || index-- > 0) continue;
      try {
        return await save(candidate);
      } catch (error) {
        if (!usernameConflict(error)) throw error;
        break;
      }
    }
  }
  throw new AppError(409, 'Couldn’t assign a tag. Try again.');
}

async function ownProfile(env, ctx, request, id, admin, assigned, usernameOnly = false) {
  const providers = liveProviders(env);
  const profileResponse = entry => ({ admin, signedIn: Boolean(id), profile: profileData(entry), providers });
  let previous = id && await env.DB.prepare('SELECT * FROM profiles WHERE account_id = ?').bind(id).first();
  if (assigned && previous?.username !== assigned) previous = await assignReservedUsername(env.DB, id, assigned);
  if (request.method === 'GET') return profileResponse(previous);
  if (!id) throw new AppError(401, 'Sign in to edit your profile.');
  const input = await body(request, usernameOnly ? 1024 : 2 * Math.ceil(gifLimit / 3) * 4 + 32_000);
  const wantsUsername = Object.hasOwn(input, 'username');
  if (usernameOnly && previous?.username) return profileResponse(previous);
  if (wantsUsername && reservedUsernames.has(previous?.username)) throw new AppError(409, 'This username is assigned to your account.');
  const base = wantsUsername ? usernameBase(input.username) : null;
  if (!base && !previous?.username) throw usernameRequired();
  if (usernameOnly) {
    const entry = await withRandomTag(env.DB, base, username => env.DB.prepare(`INSERT INTO profiles (account_id, username) VALUES (?, ?)
      ON CONFLICT(account_id) DO UPDATE SET username = coalesce(profiles.username, excluded.username)
      RETURNING *`).bind(id, username).first());
    return profileResponse(entry);
  }
  const displayName = personName(input.displayName);
  const bio = optionalText(input.bio, 160, 'About me');
  const game = optionalText(input.game, 80, 'Game');
  const music = optionalText(input.music, 100, 'Music');
  const color = accentColor(input.color);
  const steam = accountLink(input.steam, 'steam');
  const lastfm = accountLink(input.lastfm, 'lastfm');
  const spotify = accountLink(input.spotify, 'spotify');
  const details = input.details === undefined ? (previous?.details_json || '[]') : JSON.stringify(detailsList(input.details));
  const entry = await savePictures(env, ctx, [
    { name: 'avatar', input: input.avatarImage, old: previous?.avatar_key, limit: 180_000 },
    { name: 'banner', input: input.bannerImage, old: previous?.banner_key, limit: 600_000 },
  ], ({ avatar, banner }) => {
    const write = username => env.DB.prepare(`
        INSERT INTO profiles (account_id, display_name, username, bio, color, game, music, steam, lastfm, spotify, share_activity, avatar_key, banner_key, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET
          display_name = excluded.display_name, bio = excluded.bio, color = excluded.color,
          username = coalesce(excluded.username, profiles.username),
          game = excluded.game, music = excluded.music, steam = excluded.steam, lastfm = excluded.lastfm,
          spotify = excluded.spotify, share_activity = excluded.share_activity, details_json = excluded.details_json,
          avatar_key = excluded.avatar_key, banner_key = excluded.banner_key
        WHERE profiles.avatar_key IS ? AND profiles.banner_key IS ?
          AND (excluded.username IS NULL OR profiles.username IS ?)
        RETURNING *
      `).bind(id, displayName, username, bio, color, game, music, steam, lastfm, spotify, input.shareActivity === true ? 1 : 0,
        avatar, banner, details, previous?.avatar_key ?? null, previous?.banner_key ?? null, previous?.username ?? null).first();
    return base && base !== previous?.username?.split('#')[0] ? withRandomTag(env.DB, base, write) : write(null);
  });
  return profileResponse(entry);
}

async function providerJson(base, params) {
  const url = new URL(base);
  url.search = new URLSearchParams(params);
  const response = await fetch(url.href, { redirect: 'error', signal: AbortSignal.timeout(3500) });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  return response.json();
}

function cachedActivity(key, get) {
  const now = Date.now();
  const cached = activityCache.get(key);
  if (cached?.expires > now) return cached.value;
  if (activityCache.size >= 350) activityCache.delete(activityCache.keys().next().value);
  const value = get().catch(() => '');
  activityCache.set(key, { value, expires: now + 45_000 });
  return value;
}

async function steamGame(key, connection) {
  const [kind, handle] = connection.split('/');
  let steamId = handle;
  if (kind === 'id') {
    const account = await providerJson('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/', { key, vanityurl: handle });
    steamId = account?.response?.steamid;
    if (!/^\d{17}$/.test(steamId ?? '')) return '';
  }
  const data = await providerJson('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/', { key, steamids: steamId });
  const player = data?.response?.players?.find(person => person.steamid === steamId);
  return player?.communityvisibilitystate === 3 && typeof player.gameextrainfo === 'string' ? player.gameextrainfo.slice(0, 80) : '';
}

async function lastfmTrack(key, user) {
  const data = await providerJson('https://ws.audioscrobbler.com/2.0/', { method: 'user.getrecenttracks', user, limit: '1', api_key: key, format: 'json' });
  const track = data?.recenttracks?.track?.[0];
  if (track?.['@attr']?.nowplaying !== 'true' || typeof track.name !== 'string') return '';
  const artist = track.artist?.['#text'];
  return (typeof artist === 'string' && artist ? `${track.name} · ${artist}` : track.name).slice(0, 100);
}

async function roomActivity(env, roomId, memberId) {
  if (!memberId || !idPattern.test(memberId)) throw new AppError(400, 'Choose a room member.');
  const entry = await env.DB.prepare(`SELECT p.steam, p.lastfm FROM members m JOIN profiles p ON p.account_id = m.account_id
    WHERE m.id = ? AND m.room_id = ? AND p.share_activity = 1 AND EXISTS (
      SELECT 1 FROM members active WHERE active.room_id = m.room_id AND active.account_id = m.account_id AND active.last_seen > ?)`)
    .bind(memberId, roomId, Date.now() - onlineWindow).first();
  if (!entry) return { game: '', music: '' };
  const keys = liveProviders(env);
  const [game, music] = await Promise.all([
    keys.steam && entry.steam ? cachedActivity(`steam:${entry.steam}`, () => steamGame(env.DUO_STEAM_API_KEY, entry.steam)) : '',
    keys.lastfm && entry.lastfm ? cachedActivity(`lastfm:${entry.lastfm.toLowerCase()}`, () => lastfmTrack(env.DUO_LASTFM_API_KEY, entry.lastfm)) : '',
  ]);
  return { game, music };
}

function isAdmin(env, email, assignment) {
  return Boolean(email && (assignment?.admin === true
    || (env.DUO_ADMIN_EMAILS ?? '').toLowerCase().split(',').some(entry => entry.trim() === email)));
}

function requireModerator(member, admin) {
  if (!member.is_host && !admin) throw new AppError(403, 'A room host or Duo Chat admin can do this.');
}

async function getChannel(db, roomId, name) {
  if (name === undefined || name === null || name === 'general') return 'general';
  if (typeof name === 'string' && name.length <= 30 && channelPattern.test(name)) {
    const channel = await db.prepare('SELECT name FROM channels WHERE room_id = ? AND name = ?').bind(roomId, name).first();
    if (channel) return channel.name;
  }
  throw new AppError(404, 'This channel does not exist in the room.');
}

async function updateChannelSettings(db, roomId, member, admin, input) {
  requireModerator(member, admin);
  const channel = await getChannel(db, roomId, input.channel);
  const topic = optionalText(input.topic, 120, 'Channel topic');
  const { slowSeconds } = input;
  if (!slowModes.includes(slowSeconds)) throw new AppError(400, 'Choose a slow mode interval.');
  await db.prepare(`INSERT INTO channel_settings (room_id, channel, topic, slow_seconds) VALUES (?, ?, ?, ?)
    ON CONFLICT(room_id, channel) DO UPDATE SET topic = excluded.topic, slow_seconds = excluded.slow_seconds`)
    .bind(roomId, channel, topic, slowSeconds).run();
  return { topic, slowSeconds };
}

const slowModePosts = `SELECT settings.slow_seconds FROM channel_settings settings JOIN messages recent
  ON recent.room_id = settings.room_id AND recent.channel = settings.channel
  WHERE settings.room_id = ? AND settings.channel = ? AND settings.slow_seconds > 0
    AND recent.kind = 'person' AND recent.created_at > ? - settings.slow_seconds * 1000
    AND (recent.member_id = ? OR recent.member_id IN (SELECT id FROM members WHERE room_id = ? AND account_id = ?)) LIMIT 1`;

function slowModeArgs(roomId, channel, member, now) {
  return [roomId, channel, now, member.id, roomId, member.account_id];
}

async function postingError(db, roomId, channel, member, exempt) {
  const blocked = !exempt && await db.prepare(slowModePosts).bind(...slowModeArgs(roomId, channel, member, Date.now())).first();
  if (blocked) return new AppError(429, `Slow mode is on. Allow ${blocked.slow_seconds} seconds between posts in this channel.`, 'slow_mode');
  return new AppError(429, 'Give the room a moment, then try again.');
}

async function createChannel(db, roomId, member, admin, input) {
  requireModerator(member, admin);
  const name = requiredText(input.name, 30, 'Channel name').toLowerCase().replace(/\s+/g, '-');
  if (name === 'general' || !channelPattern.test(name)) {
    throw new AppError(400, 'Choose a new channel name using letters, numbers, and single hyphens.');
  }
  const section = optionalText(input.section, 32, 'Channel group');
  const channel = await db.prepare(`
    INSERT OR IGNORE INTO channels (room_id, name, section, created_at)
    SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM channels WHERE room_id = ?) < 30
    RETURNING name, section
  `).bind(roomId, name, section, Date.now(), roomId).first();
  if (!channel) throw new AppError(409, 'That channel already exists or this room has reached its channel limit.');
  return channel;
}

async function voiceChannel(db, roomId, name) {
  if (name === 'lounge') return name;
  if (typeof name === 'string' && name.length <= 30 && channelPattern.test(name)
    && await db.prepare('SELECT 1 FROM voice_channels WHERE room_id = ? AND name = ?').bind(roomId, name).first()) return name;
  throw new AppError(404, 'This voice channel does not exist.');
}

async function createVoiceChannel(db, roomId, member, admin, input) {
  requireModerator(member, admin);
  const name = requiredText(input.name, 30, 'Voice channel name').toLowerCase().replace(/\s+/g, '-');
  if (name === 'lounge' || !channelPattern.test(name)) throw new AppError(400, 'Choose a new name using letters, numbers and single hyphens.');
  const channel = await db.prepare(`INSERT OR IGNORE INTO voice_channels (room_id, name, created_at)
    SELECT ?, ?, ? WHERE (SELECT count(*) FROM voice_channels WHERE room_id = ?) < 12 RETURNING name`)
    .bind(roomId, name, Date.now(), roomId).first();
  if (!channel) throw new AppError(409, 'That channel already exists or this room has reached its voice channel limit.');
  return channel;
}

function voiceId(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new AppError(400, 'Voice session is invalid.');
  return value;
}

async function joinVoice(db, roomId, member, input) {
  const id = voiceId(input.id);
  const channel = await voiceChannel(db, roomId, input.channel);
  const now = Date.now();
  const [, inserted] = await db.batch([
    db.prepare('DELETE FROM voice_members WHERE last_seen <= ?').bind(now - voiceWindow),
    db.prepare(`INSERT OR IGNORE INTO voice_members (id, room_id, channel, member_id, actor, last_seen, muted)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM voice_members WHERE room_id = ? AND channel = ?) < 8 RETURNING id`)
      .bind(id, roomId, channel, member.id, memberActor(member), now, input.muted === true ? 1 : 0, roomId, channel),
  ]);
  if (inserted.results.length) return { id };
  const existing = await db.prepare('SELECT id, room_id, channel, member_id FROM voice_members WHERE actor = ?').bind(memberActor(member)).first();
  if (existing?.id === id && existing.room_id === roomId && existing.channel === channel && existing.member_id === member.id) return { id };
  if (existing) throw new AppError(409, 'Leave voice in your other tab or device first.');
  throw new AppError(409, 'This voice channel is full.');
}

async function voiceState(db, roomId, member, input) {
  const id = voiceId(input.id);
  if (typeof input.muted !== 'boolean' || typeof input.deafened !== 'boolean' || !Number.isSafeInteger(input.after) || input.after < 0) {
    throw new AppError(400, 'Voice state is invalid.');
  }
  const now = Date.now();
  const cutoff = now - voiceWindow;
  const muted = input.muted || input.deafened ? 1 : 0;
  const deafened = input.deafened ? 1 : 0;
  const [, peers, signals] = await db.batch([
    db.prepare(`UPDATE voice_members SET last_seen = ?, muted = ?, deafened = ?
      WHERE id = ? AND room_id = ? AND member_id = ? AND last_seen > ?
        AND (last_seen <= ? OR muted <> ? OR deafened <> ?)`)
      .bind(now, muted, deafened, id, roomId, member.id, cutoff, now - 5000, muted, deafened),
    db.prepare(`SELECT peer.id, coalesce(p.display_name, m.name) AS name, peer.muted, peer.deafened
      FROM voice_members own JOIN voice_members peer ON peer.room_id = own.room_id AND peer.channel = own.channel
      JOIN members m ON m.id = peer.member_id LEFT JOIN profiles p ON p.account_id = m.account_id
      WHERE own.id = ? AND own.room_id = ? AND own.member_id = ? AND own.last_seen > ? AND peer.last_seen > ? ORDER BY peer.id`)
      .bind(id, roomId, member.id, cutoff, cutoff),
    db.prepare(`SELECT signal.id, signal.sender, signal.kind, signal.sdp FROM voice_signals signal
      JOIN voice_members own ON own.id = signal.recipient JOIN voice_members peer ON peer.id = signal.sender
      WHERE own.id = ? AND own.room_id = ? AND own.member_id = ? AND own.last_seen > ? AND peer.last_seen > ? AND signal.id > ? ORDER BY signal.id LIMIT 24`)
      .bind(id, roomId, member.id, cutoff, cutoff, input.after),
  ]);
  if (!peers.results.some(peer => peer.id === id)) throw new AppError(410, 'Your voice session expired. Join the channel again.');
  return { peers: peers.results, signals: signals.results };
}

async function signalVoice(db, roomId, member, input) {
  const sender = voiceId(input.id);
  const recipient = voiceId(input.to);
  const { kind, sdp } = input;
  if (!['offer', 'answer'].includes(kind) || sender === recipient || (kind === 'offer') !== (sender < recipient) || typeof sdp !== 'string' || sdp.length > 20_000
    || !sdp.startsWith('v=0') || !/(?:^|\n)m=audio /.test(sdp) || /(?:^|\n)m=(?!audio )/.test(sdp)) {
    throw new AppError(400, 'Voice signal is invalid.');
  }
  const cutoff = Date.now() - voiceWindow;
  const signal = await db.prepare(`INSERT OR IGNORE INTO voice_signals (sender, recipient, kind, sdp)
    SELECT own.id, peer.id, ?, ? FROM voice_members own JOIN voice_members peer ON peer.room_id = own.room_id AND peer.channel = own.channel
    WHERE own.id = ? AND peer.id = ? AND own.room_id = ? AND own.member_id = ? AND own.last_seen > ? AND peer.last_seen > ? RETURNING id`)
    .bind(kind, sdp, sender, recipient, roomId, member.id, cutoff, cutoff).first();
  return { sent: Boolean(signal) };
}

async function leaveVoice(db, roomId, member, input) {
  await db.prepare('DELETE FROM voice_members WHERE id = ? AND room_id = ? AND member_id = ?').bind(voiceId(input.id), roomId, member.id).run();
  return { left: true };
}

async function groupChannel(db, roomId, member, admin, input) {
  requireModerator(member, admin);
  const name = requiredText(input.name, 30, 'Channel name');
  const section = optionalText(input.section, 32, 'Channel group');
  const entry = await db.prepare('UPDATE channels SET section = ? WHERE room_id = ? AND name = ? RETURNING name, section')
    .bind(section, roomId, name).first();
  if (!entry) throw new AppError(404, 'Choose a custom text channel in this room.');
  return entry;
}

function roomIdentity(room) {
  return { title: room.title, description: room.description, accent: room.accent, icon: mediaUrl(room.icon_key) };
}

async function updateRoom(env, ctx, request, roomId, member, admin) {
  requireModerator(member, admin);
  const input = await body(request, Math.ceil(gifLimit / 3) * 4 + 24_000);
  const title = requiredText(input.title, 60, 'Room name');
  const description = optionalText(input.description, 260, 'Room description');
  const accent = accentColor(input.accent);
  const entry = await savePictures(env, ctx, [{ name: 'icon', input: input.iconImage, old: member.icon_key, limit: 180_000 }],
    ({ icon }) => env.DB.prepare(`UPDATE rooms SET title = ?, description = ?, accent = ?, icon_key = ?
      WHERE id = ? AND icon_key IS ? RETURNING title, description, accent, icon_key`)
      .bind(title, description, accent, icon, roomId, member.icon_key).first());
  return roomIdentity(entry);
}

async function moderateMessage(db, roomId, member, admin, input) {
  requireModerator(member, admin);
  if (!Number.isSafeInteger(input.messageId) || input.messageId < 1 || typeof input.hidden !== 'boolean') {
    throw new AppError(400, 'Choose a message and moderation action.');
  }
  const [changed] = await db.batch([
    db.prepare('UPDATE messages SET hidden_at = ?, pinned_at = CASE WHEN ? THEN NULL ELSE pinned_at END WHERE room_id = ? AND id = ? AND deleted_at IS NULL RETURNING id')
      .bind(input.hidden ? Date.now() : null, input.hidden ? 1 : 0, roomId, input.messageId),
    db.prepare('UPDATE rooms SET moderation_version = moderation_version + 1 WHERE id = ? AND changes() = 1').bind(roomId),
  ]);
  if (!changed.results.length) throw new AppError(404, 'This message does not exist in the room.');
  return { hidden: input.hidden };
}

async function editMessage(db, roomId, member, input) {
  if (!Number.isSafeInteger(input.messageId) || input.messageId < 1) throw new AppError(400, 'Choose a message to edit.');
  const text = optionalText(input.text, 4000, 'Message');
  const [changed] = await db.batch([
    db.prepare(`UPDATE messages SET text = ?, edited_at = ? WHERE room_id = ? AND id = ? AND kind = 'person' AND hidden_at IS NULL AND deleted_at IS NULL
      AND (? <> '' OR image_key IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM message_polls WHERE message_id = messages.id)
      AND (member_id = ? OR member_id IN (SELECT id FROM members WHERE room_id = ? AND account_id = ?)) RETURNING id, edited_at`)
      .bind(text, Date.now(), roomId, input.messageId, text, member.id, roomId, member.account_id),
    db.prepare('UPDATE rooms SET moderation_version = moderation_version + 1 WHERE id = ? AND changes() = 1').bind(roomId),
  ]);
  if (!changed.results.length) throw new AppError(403, 'You can only edit your own visible messages.');
  return changed.results[0];
}

function messageId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new AppError(400, 'Choose a valid message.');
  return value;
}

function memberActor(member) {
  return member.account_id ? `account:${member.account_id}` : `member:${member.id}`;
}

function uniqueRoomPeople(rows, viewer) {
  const people = new Map();
  for (const row of rows) {
    const actor = memberActor(row);
    let person = people.get(actor);
    if (!person) {
      person = { ...row, memberIds: [], mine: actor === memberActor(viewer) };
      people.set(actor, person);
    }
    person.memberIds.push(row.id);
    person.last_seen = Math.max(person.last_seen, row.last_seen);
  }
  return [...people.values()].sort((a, b) => b.is_host - a.is_host || (a.display_name || a.name).localeCompare(b.display_name || b.name, undefined, { sensitivity: 'base' }));
}

function bumpRoomRevision(db, roomId) {
  return db.prepare('UPDATE rooms SET moderation_version = moderation_version + 1 WHERE id = ? AND changes() > 0').bind(roomId);
}

function boardId(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new AppError(400, 'Choose a valid room item.');
  return value;
}

async function roomBoard(db, roomId, member) {
  const actor = memberActor(member);
  const [items, responses] = await db.batch([
    db.prepare(`SELECT item.*, coalesce(p.display_name, creator.name) AS creator,
      coalesce(ap.display_name, assignee.name) AS assignee, item.owner_actor = ? AS mine
      FROM room_board_items item JOIN members creator ON creator.id = item.member_id
      LEFT JOIN profiles p ON p.account_id = creator.account_id
      LEFT JOIN members assignee ON assignee.id = item.assignee_id
      LEFT JOIN profiles ap ON ap.account_id = assignee.account_id
      WHERE item.room_id = ? ORDER BY item.archived, item.updated_at DESC LIMIT 120`).bind(actor, roomId),
    db.prepare(`SELECT r.event_id, r.response, r.actor = ? AS mine, coalesce(p.display_name, m.name) AS name
      FROM room_event_rsvps r JOIN room_board_items event ON event.id = r.event_id
      JOIN members m ON m.id = r.member_id LEFT JOIN profiles p ON p.account_id = m.account_id
      WHERE event.room_id = ? ORDER BY name COLLATE NOCASE`).bind(actor, roomId),
  ]);
  return { items: items.results.map(({ owner_actor, room_id, member_id, ...item }) => ({
    ...item, responses: item.kind === 'event' ? responses.results.filter(response => response.event_id === item.id)
      .map(({ event_id, ...response }) => response) : [],
  })) };
}

async function saveBoardItem(db, roomId, member, admin, input) {
  const id = boardId(input.id);
  const previous = await db.prepare('SELECT * FROM room_board_items WHERE id = ? AND room_id = ?').bind(id, roomId).first();
  const actor = memberActor(member);
  const { kind } = input;
  if (!['event', 'task', 'announcement'].includes(kind) || (previous && kind !== previous.kind)) throw new AppError(400, 'Choose an event, task, or announcement.');
  if (kind === 'announcement') requireModerator(member, admin);
  if (previous && previous.owner_actor !== actor && !member.is_host && !admin) throw new AppError(403, 'You can edit your own items. A room host or admin can edit any item.');
  const title = requiredText(input.title, 100, 'Title');
  const body = optionalText(input.body, 1200, 'Details');
  const location = kind === 'event' ? optionalText(input.location, 100, 'Location') : '';
  const startsAt = kind === 'event' ? input.startsAt : null;
  const duration = kind === 'event' ? input.duration : 60;
  const now = Date.now();
  if (kind === 'event' && (!Number.isSafeInteger(startsAt) || startsAt < now - 86_400_000 || startsAt > now + 366 * 86_400_000
    || ![30, 60, 90, 120, 180, 240, 480, 1440].includes(duration))) throw new AppError(400, 'Choose an event time within the next year and a valid duration.');
  const assignee = kind === 'task' && input.assigneeId ? boardId(input.assigneeId) : null;
  if (assignee && !await db.prepare('SELECT 1 FROM members WHERE id = ? AND room_id = ?').bind(assignee, roomId).first()) throw new AppError(400, 'Choose someone in this room.');
  if (!previous) {
    const { results } = await db.prepare(`INSERT OR IGNORE INTO room_board_items
      (id, room_id, kind, title, body, member_id, owner_actor, starts_at, duration, location, assignee_id, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT count(*) FROM room_board_items WHERE room_id = ? AND archived = 0) < 80 RETURNING id`)
      .bind(id, roomId, kind, title, body, member.id, actor, startsAt, duration, location, assignee, now, now, roomId).all();
    if (results.length) return { id };
    const duplicate = await db.prepare('SELECT owner_actor FROM room_board_items WHERE id = ? AND room_id = ?').bind(id, roomId).first();
    if (duplicate?.owner_actor === actor) return { id };
    throw new AppError(409, 'The room board is full. Archive an older item first.');
  }
  if (input.version === undefined && previous.owner_actor === actor) return { id };
  if (!Number.isSafeInteger(input.version)) throw new AppError(400, 'Reopen this item before saving it.');
  const changed = await db.prepare(`UPDATE room_board_items SET title = ?, body = ?, starts_at = ?, duration = ?, location = ?,
      assignee_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND room_id = ? AND version = ? RETURNING id`)
    .bind(title, body, startsAt, duration, location, assignee, now, id, roomId, input.version).first();
  if (!changed) throw new AppError(409, 'This item changed in another tab. Reopen it to edit the latest version.');
  return changed;
}

async function changeBoardItem(db, roomId, member, admin, input) {
  const id = boardId(input.id);
  const item = await db.prepare('SELECT kind, owner_actor FROM room_board_items WHERE id = ? AND room_id = ?').bind(id, roomId).first();
  if (!item) throw new AppError(404, 'This room item is unavailable.');
  if (!Number.isSafeInteger(input.version) || typeof input.active !== 'boolean' || !['completed', 'archived'].includes(input.action)) throw new AppError(400, 'Choose a valid item action.');
  if (input.action === 'completed' && item.kind !== 'task') throw new AppError(400, 'Only tasks can be checked off.');
  if (item.kind === 'announcement') requireModerator(member, admin);
  if (input.action === 'archived' && item.owner_actor !== memberActor(member) && !member.is_host && !admin) throw new AppError(403, 'The author, room host, or an admin can archive this item.');
  const changed = await db.prepare(`UPDATE room_board_items SET ${input.action} = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND room_id = ? AND version = ? RETURNING id`)
    .bind(input.active ? 1 : 0, Date.now(), id, roomId, input.version).first();
  if (!changed) throw new AppError(409, 'This item changed. Refresh the board and try again.');
  return changed;
}

async function eventResponse(db, roomId, member, input) {
  const id = boardId(input.id);
  const { response } = input;
  if (!['going', 'maybe', 'declined'].includes(response)) throw new AppError(400, 'Choose Going, Maybe, or Can’t make it.');
  const saved = await db.prepare(`INSERT INTO room_event_rsvps (event_id, actor, member_id, response)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM room_board_items WHERE id = ? AND room_id = ? AND kind = 'event'
      AND archived = 0 AND starts_at + duration * 60000 > ?)
    ON CONFLICT(event_id, actor) DO UPDATE SET response = excluded.response, member_id = excluded.member_id RETURNING response`)
    .bind(id, memberActor(member), member.id, response, id, roomId, Date.now()).first();
  if (!saved) throw new AppError(409, 'This event ended or was canceled.');
  return saved;
}

async function saveQueueItem(db, roomId, member, input) {
  const id = boardId(input.id);
  const actor = memberActor(member);
  const prior = await db.prepare('SELECT id FROM room_queue WHERE id = ? AND room_id = ? AND actor = ?').bind(id, roomId, actor).first();
  if (prior) return prior;
  const { kind, dueAt } = input;
  if (!['message', 'reminder'].includes(kind)) throw new AppError(400, 'Choose a scheduled message or reminder.');
  if (!Number.isSafeInteger(dueAt) || dueAt < Date.now() + 60_000 || dueAt > Date.now() + 30 * 86_400_000) throw new AppError(400, 'Choose a time between one minute and 30 days from now.');
  const text = requiredText(input.text, kind === 'message' ? 4000 : 200, kind === 'message' ? 'Message' : 'Reminder');
  const channel = await getChannel(db, roomId, input.channel);
  const original = input.messageId ? messageId(input.messageId) : null;
  if (original && (kind !== 'reminder' || !await db.prepare(`SELECT 1 FROM messages WHERE id = ? AND room_id = ? AND channel = ?
    AND hidden_at IS NULL AND deleted_at IS NULL`).bind(original, roomId, channel).first())) throw new AppError(409, 'This message is unavailable.');
  const saved = await db.prepare(`INSERT OR IGNORE INTO room_queue (id, room_id, channel, member_id, actor, kind, text, due_at, message_id, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM room_queue WHERE actor = ? AND state = 'pending') < 40 RETURNING id`)
    .bind(id, roomId, channel, member.id, actor, kind, text, dueAt, original, Date.now(), actor).first();
  if (!saved) {
    const duplicate = await db.prepare('SELECT id FROM room_queue WHERE id = ? AND room_id = ? AND actor = ?').bind(id, roomId, actor).first();
    if (duplicate) return duplicate;
    throw new AppError(409, 'You have 40 pending plans. Clear an older one first.');
  }
  return saved;
}

async function personalQueue(db, roomId, member) {
  const { results } = await db.prepare(`SELECT q.id, q.kind, CASE WHEN q.message_id IS NOT NULL AND
      (source.hidden_at IS NOT NULL OR source.deleted_at IS NOT NULL) THEN 'Message unavailable' ELSE q.text END AS text,
      q.channel, q.due_at, q.message_id, q.state FROM room_queue q LEFT JOIN messages source ON source.id = q.message_id
    WHERE q.room_id = ? AND q.actor = ? AND q.state IN ('pending', 'sent') ORDER BY q.state, q.due_at LIMIT 60`)
    .bind(roomId, memberActor(member)).all();
  return { items: results };
}

async function changeQueueItem(db, roomId, member, input) {
  const id = boardId(input.id);
  const changed = await db.prepare(`UPDATE room_queue SET state = CASE WHEN state = 'pending' THEN 'canceled' ELSE 'dismissed' END
    WHERE id = ? AND room_id = ? AND actor = ? AND state IN ('pending', 'sent') RETURNING id`)
    .bind(id, roomId, memberActor(member)).first();
  if (!changed) throw new AppError(409, 'This plan has already changed. Refresh your plans.');
  return changed;
}

async function deliverScheduled(db, roomId) {
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO messages (room_id, channel, member_id, text, request_id, created_at)
      SELECT q.room_id, q.channel, q.member_id, q.text, q.id, ? FROM room_queue q
      WHERE q.room_id = ? AND q.kind = 'message' AND q.state = 'pending' AND q.due_at <= ?
        AND NOT EXISTS (SELECT 1 FROM room_bans b WHERE b.room_id = q.room_id AND b.actor = q.actor)
        AND q.id = (SELECT earlier.id FROM room_queue earlier WHERE earlier.room_id = q.room_id AND earlier.actor = q.actor
          AND earlier.channel = q.channel AND earlier.kind = 'message' AND earlier.state = 'pending' ORDER BY earlier.due_at, earlier.id LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM channel_settings setting JOIN messages recent ON recent.room_id = q.room_id AND recent.channel = q.channel
          JOIN members author ON author.id = recent.member_id JOIN members sender ON sender.id = q.member_id
          WHERE setting.room_id = q.room_id AND setting.channel = q.channel AND setting.slow_seconds > 0
            AND recent.kind = 'person' AND recent.created_at > ? - setting.slow_seconds * 1000
            AND (author.id = sender.id OR (author.account_id IS NOT NULL AND author.account_id = sender.account_id)))
      ORDER BY q.due_at LIMIT 20`).bind(now, roomId, now, now),
    db.prepare(`UPDATE room_queue SET state = 'sent', message_id = (SELECT m.id FROM messages m
      WHERE m.room_id = room_queue.room_id AND m.member_id = room_queue.member_id AND m.request_id = room_queue.id)
      WHERE room_id = ? AND kind = 'message' AND state = 'pending' AND EXISTS (
        SELECT 1 FROM messages m WHERE m.room_id = room_queue.room_id AND m.member_id = room_queue.member_id AND m.request_id = room_queue.id)`).bind(roomId),
  ]);
}

async function deleteMessage(env, ctx, roomId, member, input) {
  const db = env.DB;
  const id = messageId(input.messageId);
  const [previous, changed] = await db.batch([
    db.prepare('SELECT image_key FROM messages WHERE room_id = ? AND id = ?').bind(roomId, id),
    db.prepare(`UPDATE messages SET text = '', deleted_at = ?, pinned_at = NULL, edited_at = NULL, reply_to = NULL, image_key = NULL, image_alt = ''
      WHERE room_id = ? AND id = ? AND kind = 'person' AND deleted_at IS NULL
      AND (member_id = ? OR member_id IN (SELECT id FROM members WHERE room_id = ? AND account_id = ?)) RETURNING id`)
      .bind(Date.now(), roomId, id, member.id, roomId, member.account_id),
    bumpRoomRevision(db, roomId),
    db.prepare(`DELETE FROM message_reactions WHERE message_id = ? AND EXISTS (
      SELECT 1 FROM messages WHERE id = ? AND room_id = ? AND deleted_at IS NOT NULL)`)
      .bind(id, id, roomId),
    db.prepare(`DELETE FROM message_polls WHERE message_id = ? AND EXISTS (
      SELECT 1 FROM messages WHERE id = ? AND room_id = ? AND deleted_at IS NOT NULL)`)
      .bind(id, id, roomId),
  ]);
  if (!changed.results.length) throw new AppError(403, 'You can delete your own messages.');
  if (previous.results[0]?.image_key) ctx.waitUntil(prunePictures(env, [previous.results[0].image_key]));
  return { id };
}

async function setReaction(db, roomId, member, input) {
  const id = messageId(input.messageId);
  if (!reactionOptions.has(input.emoji) || typeof input.active !== 'boolean') throw new AppError(400, 'Choose a reaction.');
  const actor = memberActor(member);
  const visible = 'SELECT 1 FROM messages WHERE room_id = ? AND id = ? AND hidden_at IS NULL AND deleted_at IS NULL';
  const change = input.active
    ? db.prepare(`INSERT OR IGNORE INTO message_reactions (message_id, actor, emoji) SELECT ?, ?, ? WHERE EXISTS (${visible})`)
    : db.prepare(`DELETE FROM message_reactions WHERE message_id = ? AND actor = ? AND emoji = ? AND EXISTS (${visible})`);
  const [target] = await db.batch([
    db.prepare(visible).bind(roomId, id),
    change.bind(id, actor, input.emoji, roomId, id),
    bumpRoomRevision(db, roomId),
  ]);
  if (!target.results.length) throw new AppError(404, 'This message is unavailable.');
  return { active: input.active };
}

function messageRequestId(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new AppError(400, 'Message ID is invalid.');
  return value;
}

async function createPoll(db, roomId, member, admin, input) {
  const question = requiredText(input.question, 180, 'Poll question');
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 5) throw new AppError(400, 'Add two to five poll choices.');
  const options = input.options.map(option => requiredText(option, 60, 'Poll choice'));
  if (new Set(options.map(option => option.toLowerCase())).size !== options.length) throw new AppError(400, 'Give each choice a different label.');
  const requestId = messageRequestId(input.id);
  const channel = await getChannel(db, roomId, input.channel);
  const now = Date.now();
  const exempt = admin || member.is_host ? 1 : 0;
  const [, poll] = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO messages (room_id, channel, member_id, text, request_id, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM messages WHERE member_id = ? AND created_at > ?)
      AND (? = 1 OR NOT EXISTS (${slowModePosts}))`)
      .bind(roomId, channel, member.id, question, requestId, now, member.id, now - 400, exempt, ...slowModeArgs(roomId, channel, member, now)),
    db.prepare(`INSERT INTO message_polls (message_id, options_json)
      SELECT id, ? FROM messages WHERE room_id = ? AND member_id = ? AND request_id = ? AND changes() = 1
      RETURNING message_id`).bind(JSON.stringify(options), roomId, member.id, requestId),
  ]);
  const id = poll.results[0]?.message_id;
  if (id) return { id };
  const prior = await db.prepare(`SELECT msg.id FROM messages msg JOIN message_polls poll ON poll.message_id = msg.id
    WHERE msg.room_id = ? AND msg.member_id = ? AND msg.request_id = ? AND msg.deleted_at IS NULL`).bind(roomId, member.id, requestId).first();
  if (prior) return prior;
  throw await postingError(db, roomId, channel, member, exempt);
}

async function voteInPoll(db, roomId, member, input) {
  const id = messageId(input.messageId);
  const option = input.option;
  if (option !== null && (!Number.isInteger(option) || option < 0 || option > 4)) throw new AppError(400, 'Choose a poll option.');
  const openPoll = `SELECT 1 FROM message_polls poll JOIN messages msg ON msg.id = poll.message_id
    WHERE msg.room_id = ? AND msg.id = ? AND msg.hidden_at IS NULL AND msg.deleted_at IS NULL AND poll.closed_at IS NULL`;
  const actor = memberActor(member);
  const vote = option === null
    ? db.prepare(`DELETE FROM poll_votes WHERE message_id = ? AND actor = ? AND EXISTS (${openPoll})`).bind(id, actor, roomId, id)
    : db.prepare(`INSERT INTO poll_votes (message_id, actor, option_index) SELECT ?, ?, ? WHERE EXISTS (
        ${openPoll} AND ? < json_array_length(poll.options_json))
        ON CONFLICT(message_id, actor) DO UPDATE SET option_index = excluded.option_index
        WHERE poll_votes.option_index <> excluded.option_index`).bind(id, actor, option, roomId, id, option);
  const [eligible] = await db.batch([
    db.prepare(`${openPoll} AND (? IS NULL OR ? < json_array_length(poll.options_json))`).bind(roomId, id, option, option),
    vote,
    bumpRoomRevision(db, roomId),
  ]);
  if (!eligible.results.length) throw new AppError(409, 'This poll or choice is unavailable.');
  return { option };
}

async function closePoll(db, roomId, member, admin, input) {
  const id = messageId(input.messageId);
  const [updated] = await db.batch([
    db.prepare(`UPDATE message_polls SET closed_at = ? WHERE message_id = ? AND closed_at IS NULL AND EXISTS (
      SELECT 1 FROM messages WHERE id = ? AND room_id = ? AND hidden_at IS NULL AND deleted_at IS NULL
      AND (? = 1 OR member_id = ? OR member_id IN (SELECT id FROM members WHERE room_id = ? AND account_id = ?))) RETURNING closed_at`)
      .bind(Date.now(), id, id, roomId, admin || member.is_host ? 1 : 0, member.id, roomId, member.account_id),
    bumpRoomRevision(db, roomId),
  ]);
  if (!updated.results.length) throw new AppError(403, 'Only the poll creator, room host or an admin can close an open poll.');
  return updated.results[0];
}

async function typingStatus(db, roomId, member, input) {
  if (typeof input.active !== 'boolean') throw new AppError(400, 'Choose a typing status.');
  const channel = await getChannel(db, roomId, input.channel);
  const now = Date.now();
  if (input.active) {
    await db.prepare(`UPDATE members SET typing_channel = ?, typing_until = ? WHERE id = ? AND (typing_channel IS NOT ? OR typing_until <= ?)`)
      .bind(channel, now + 7_000, member.id, channel, now + 4_000).run();
  } else {
    await db.prepare('UPDATE members SET typing_channel = NULL, typing_until = 0 WHERE id = ? AND typing_channel = ?').bind(member.id, channel).run();
  }
  return { active: input.active };
}

async function setPin(db, roomId, member, admin, input) {
  requireModerator(member, admin);
  const id = messageId(input.messageId);
  if (typeof input.active !== 'boolean') throw new AppError(400, 'Choose whether to pin this message.');
  const [changed] = await db.batch([
    db.prepare(`UPDATE messages AS msg SET pinned_at = ? WHERE id = ? AND room_id = ? AND hidden_at IS NULL AND deleted_at IS NULL
      AND (? = 0 OR pinned_at IS NOT NULL OR (SELECT count(*) FROM messages pinned WHERE pinned.room_id = msg.room_id
        AND pinned.channel = msg.channel AND pinned.pinned_at IS NOT NULL AND pinned.hidden_at IS NULL) < 20) RETURNING id`)
      .bind(input.active ? Date.now() : null, id, roomId, input.active ? 1 : 0),
    bumpRoomRevision(db, roomId),
  ]);
  if (!changed.results.length) throw new AppError(409, 'The message is unavailable or this channel has 20 pins.');
  return { active: input.active };
}

async function findMessages(db, roomId, query, channel, kind = 'all') {
  const search = optionalText(query ?? '', 100, 'Search');
  const filters = { all: '', images: 'AND msg.image_key IS NOT NULL', polls: 'AND poll.message_id IS NOT NULL' };
  if (!Object.hasOwn(filters, kind)) throw new AppError(400, 'Choose a search filter.');
  if ((search && search.length < 2) || (!search && kind === 'all')) throw new AppError(400, 'Enter at least two characters or choose Images or Polls.');
  const page = await db.prepare(`SELECT msg.id, msg.channel, msg.kind, msg.created_at, COALESCE(p.display_name, m.name) AS name,
      CASE WHEN ? <> '' AND instr(lower(msg.text), lower(?)) > 0 THEN substr(msg.text, max(1, instr(lower(msg.text), lower(?)) - 50), 200)
        ELSE substr(coalesce(nullif(msg.image_alt, ''), nullif(msg.text, ''), 'Shared image'), 1, 200) END AS text
    FROM messages msg LEFT JOIN members m ON m.id = msg.member_id LEFT JOIN profiles p ON p.account_id = m.account_id
    LEFT JOIN message_polls poll ON poll.message_id = msg.id
    WHERE msg.room_id = ? AND (? IS NULL OR msg.channel = ?) AND msg.hidden_at IS NULL AND msg.deleted_at IS NULL ${filters[kind]} AND
      (? = '' OR instr(lower(msg.text), lower(?)) > 0 OR (msg.image_key IS NOT NULL AND instr(lower(coalesce(nullif(msg.image_alt, ''), 'Shared image')), lower(?)) > 0))
    ORDER BY msg.id DESC LIMIT 30`).bind(search, search, search, roomId, channel, channel, search, search, search).all();
  return { messages: page.results };
}

async function roomMentions(db, roomId, member, after) {
  if (!member.account_id) return { messages: [], unread: 0 };
  const { results } = await db.prepare(`SELECT msg.id, msg.channel, msg.kind, msg.created_at, coalesce(msg.edited_at, msg.created_at) AS mentionedAt,
      coalesce(author_profile.display_name, author.name) AS name,
      substr(msg.text, max(1, instr(lower(msg.text), '@' || lower(viewer.username)) - 35), 200) AS text
    FROM messages msg JOIN members author ON author.id = msg.member_id
    JOIN profiles viewer ON viewer.account_id = ?
    LEFT JOIN profiles author_profile ON author_profile.account_id = author.account_id
    WHERE msg.room_id = ? AND msg.kind = 'person' AND msg.hidden_at IS NULL AND msg.deleted_at IS NULL
      AND msg.member_id <> ? AND author.account_id IS NOT ?
      AND (' ' || lower(msg.text) || ' ') GLOB ('*[^a-z0-9_@]@' || lower(viewer.username) || '[^a-z0-9_#]*')
    ORDER BY mentionedAt DESC, msg.id DESC LIMIT 30`).bind(member.account_id, roomId, member.id, member.account_id).all();
  return { messages: results, unread: results.filter(message => message.mentionedAt > after).length };
}

async function mediaGallery(db, roomId, channel, before) {
  const { results } = await db.prepare(`SELECT id, image_key, image_alt FROM messages
    WHERE room_id = ? AND channel = ? AND id < ? AND image_key IS NOT NULL AND hidden_at IS NULL AND deleted_at IS NULL
    ORDER BY id DESC LIMIT 25`).bind(roomId, channel, before).all();
  return {
    images: results.slice(0, 24).map(row => ({ id: row.id, url: mediaUrl(row.image_key), alt: row.image_alt })),
    next: results.length === 25 ? results[23].id : null,
  };
}

async function savedMessages(db, roomId, rawIds) {
  if (!rawIds || rawIds.length > 640) throw new AppError(400, 'Choose saved messages to load.');
  const parts = rawIds.split(',');
  if (parts.length > 40 || parts.some(part => !/^\d+$/.test(part))) throw new AppError(400, 'Choose up to 40 saved messages.');
  const ids = parts.map(part => messageId(Number(part)));
  const page = await db.prepare(`SELECT msg.id, msg.channel, msg.kind, msg.created_at, coalesce(p.display_name, m.name) AS name,
      substr(coalesce(nullif(msg.text, ''), nullif(msg.image_alt, ''), 'Shared image'), 1, 200) AS text
    FROM messages msg LEFT JOIN members m ON m.id = msg.member_id LEFT JOIN profiles p ON p.account_id = m.account_id
    WHERE msg.room_id = ? AND msg.hidden_at IS NULL AND msg.deleted_at IS NULL AND msg.id IN (${ids.map(() => '?').join(', ')})`)
    .bind(roomId, ...ids).all();
  return { messages: page.results };
}

async function pinnedMessages(db, roomId, channel) {
  const page = await db.prepare(`SELECT msg.id, msg.channel, msg.kind, msg.created_at, coalesce(p.display_name, m.name) AS name,
      substr(coalesce(nullif(msg.text, ''), nullif(msg.image_alt, ''), 'Shared image'), 1, 200) AS text
    FROM messages msg LEFT JOIN members m ON m.id = msg.member_id LEFT JOIN profiles p ON p.account_id = m.account_id
    WHERE msg.room_id = ? AND msg.channel = ? AND msg.hidden_at IS NULL AND msg.deleted_at IS NULL AND msg.pinned_at IS NOT NULL
    ORDER BY msg.pinned_at DESC LIMIT 20`).bind(roomId, channel).all();
  return { messages: page.results };
}

async function replaceInvite(db, roomId, member, input) {
  if (!member.is_host) throw new AppError(403, 'Only the room host can replace the invite link.');
  if (!Number.isSafeInteger(input.version) || input.version < 0) throw new AppError(400, 'Choose a valid invite version.');
  const invite = token();
  const updated = await db.prepare('UPDATE rooms SET invite_hash = ?, invite_version = invite_version + 1 WHERE id = ? AND invite_version = ? RETURNING invite_version')
    .bind(await hash(invite), roomId, input.version).first();
  if (!updated) throw new AppError(409, 'The invite link changed. Reopen Invite people and try again.');
  return { invite, inviteVersion: updated.invite_version };
}

async function createRoom(db, input, account) {
  const title = requiredText(input.title, 60, 'Room name');
  const description = optionalText(input.description, 260, 'Room description');
  const name = personName(input.name);
  const id = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const invite = token();
  const access = token();
  const now = Date.now();
  const [inviteHash, accessHash] = await Promise.all([hash(invite), hash(access)]);
  await db.batch([
    db.prepare('INSERT INTO rooms (id, title, description, invite_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, title, description, inviteHash, now),
    db.prepare('INSERT INTO members (id, room_id, token_hash, name, is_host, last_seen, account_id) VALUES (?, ?, ?, ?, 1, ?, ?)').bind(memberId, id, accessHash, name, now, account),
  ]);
  return { id, title, description, accent: 0, icon: '', invite, inviteVersion: 0, access, memberId, name, host: true };
}

async function joinRoom(db, input, account) {
  const invite = typeof input.invite === 'string' ? input.invite : '';
  if (!tokenPattern.test(invite)) throw new AppError(404, 'That invite link is invalid. Check the link and try again.');
  const name = personName(input.name);
  const inviteHash = await hash(invite);
  const room = await db.prepare('SELECT id, title, description, accent, icon_key, invite_version FROM rooms WHERE invite_hash = ?').bind(inviteHash).first();
  if (!room) throw new AppError(404, 'That invite link is invalid or has expired.');
  if (account && await db.prepare('SELECT 1 FROM room_bans WHERE room_id = ? AND actor = ?').bind(room.id, `account:${account}`).first()) {
    throw new AppError(403, 'You are banned from this room. Contact its host to appeal.', 'room_banned');
  }
  const memberId = crypto.randomUUID();
  const access = token();
  const joined = await db.prepare(`
    INSERT INTO members (id, room_id, token_hash, name, last_seen, account_id)
    SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM members WHERE room_id = ?) < 100
    AND EXISTS (SELECT 1 FROM rooms WHERE id = ? AND invite_hash = ?)
    RETURNING id
  `).bind(memberId, room.id, await hash(access), name, Date.now(), account, room.id, room.id, inviteHash).first();
  if (!joined) throw new AppError(409, 'This invite has changed or the room is full.');
  return { id: room.id, ...roomIdentity(room), invite, inviteVersion: room.invite_version, access, memberId, name, host: false };
}

async function authenticate(db, request, roomId) {
  const access = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{48})$/)?.[1];
  if (!access) throw new AppError(401, 'Join the room first.');
  const member = await db.prepare(`
    SELECT m.id, m.name, m.is_host, m.last_seen, m.account_id, r.title, r.description, r.accent, r.icon_key,
      r.ai_key, r.ai_until, r.ai_channel, r.moderation_version, r.invite_version
    FROM members m JOIN rooms r ON m.room_id = r.id
    WHERE m.room_id = ? AND m.token_hash = ?
  `).bind(roomId, await hash(access)).first();
  if (!member) throw new AppError(401, 'This room session has expired. Rejoin with an invite link.');
  const account = accountId(request);
  if (!member.account_id && account) {
    await db.prepare('UPDATE members SET account_id = ? WHERE id = ? AND account_id IS NULL').bind(account, member.id).run();
    const linked = await db.prepare('SELECT account_id FROM members WHERE id = ?').bind(member.id).first();
    member.account_id = linked.account_id;
  }
  if (member.account_id && account !== member.account_id) throw new AppError(401, 'This room session belongs to another account. Rejoin with an invite link.');
  if (await db.prepare('SELECT 1 FROM room_bans WHERE room_id = ? AND actor = ?').bind(roomId, memberActor(member)).first()) {
    throw new AppError(403, 'You are banned from this room. Contact its host to appeal.', 'room_banned');
  }
  return member;
}

async function roomBans(db, roomId, member, admin) {
  requireModerator(member, admin);
  const { results } = await db.prepare(`SELECT b.member_id AS id, coalesce(p.display_name, m.name) AS name, p.username, b.reason, b.created_at
    FROM room_bans b JOIN members m ON m.id = b.member_id LEFT JOIN profiles p ON p.account_id = m.account_id
    WHERE b.room_id = ? ORDER BY b.created_at DESC`).bind(roomId).all();
  return { bans: results };
}

async function changeRoomBan(db, roomId, member, admin, input) {
  requireModerator(member, admin);
  const target = await db.prepare('SELECT id, account_id, is_host FROM members WHERE id = ? AND room_id = ?').bind(boardId(input.memberId), roomId).first();
  if (!target) throw new AppError(404, 'This member is not in the room.');
  if (target.is_host || memberActor(target) === memberActor(member)) throw new AppError(403, 'The room host and your own account cannot be banned.');
  if (typeof input.banned !== 'boolean') throw new AppError(400, 'Choose ban or unban.');
  const actor = memberActor(target);
  if (!input.banned) {
    await db.prepare('DELETE FROM room_bans WHERE room_id = ? AND actor = ?').bind(roomId, actor).run();
    return { banned: false };
  }
  const reason = optionalText(input.reason, 160, 'Reason');
  await db.batch([
    db.prepare(`INSERT INTO room_bans (room_id, actor, member_id, reason, banned_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id, actor) DO UPDATE SET reason = excluded.reason`).bind(roomId, actor, target.id, reason, memberActor(member), Date.now()),
    db.prepare(`DELETE FROM voice_members WHERE room_id = ? AND member_id IN (SELECT id FROM members WHERE room_id = ? AND (id = ? OR account_id = ?))`).bind(roomId, roomId, target.id, target.account_id),
    db.prepare("UPDATE room_queue SET state = 'canceled' WHERE room_id = ? AND actor = ? AND state = 'pending'").bind(roomId, actor),
  ]);
  return { banned: true };
}

function accountPair(a, b) { return a < b ? [a, b] : [b, a]; }

async function socialPeer(db, username, account) {
  if (typeof username !== 'string' || !/^[a-z0-9_]{3,24}#[0-9]{4}$/.test(username.toLowerCase().trim())) throw new AppError(400, 'Enter the full username and tag, like moonlight#1234.');
  const peer = await db.prepare('SELECT * FROM profiles WHERE username = ?').bind(username.toLowerCase().trim()).first();
  if (!peer) throw new AppError(404, 'No account has that username. Ask them to sign in and check their tag.');
  if (peer.account_id === account) throw new AppError(400, 'Choose another person.');
  return peer;
}

function publicPerson(entry) {
  return { ...profileData(entry), name: entry.display_name || entry.username.split('#')[0] };
}

async function socialOverview(db, account) {
  const [friends, blocked, threads] = await db.batch([
    db.prepare(`SELECT p.*, f.state, f.requester = ? AS outgoing FROM friendships f JOIN profiles p
      ON p.account_id = CASE WHEN f.first_account = ? THEN f.second_account ELSE f.first_account END
      WHERE f.first_account = ? OR f.second_account = ? ORDER BY f.created_at DESC`).bind(account, account, account, account),
    db.prepare('SELECT p.* FROM account_blocks b JOIN profiles p ON p.account_id = b.blocked WHERE b.blocker = ? ORDER BY p.username').bind(account),
    db.prepare(`SELECT t.id, t.updated_at, p.*, CASE WHEN t.first_account = ? THEN t.first_read ELSE t.second_read END AS read_through,
      (SELECT count(*) FROM direct_messages m WHERE m.thread_id = t.id AND m.account_id != ? AND m.deleted_at IS NULL
        AND m.id > CASE WHEN t.first_account = ? THEN t.first_read ELSE t.second_read END) AS unread,
      (SELECT CASE WHEN m.deleted_at IS NULL THEN substr(m.text, 1, 100) ELSE 'Message deleted' END FROM direct_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS preview
      FROM direct_threads t JOIN profiles p ON p.account_id = CASE WHEN t.first_account = ? THEN t.second_account ELSE t.first_account END
      WHERE t.first_account = ? OR t.second_account = ? ORDER BY t.updated_at DESC LIMIT 100`).bind(account, account, account, account, account, account),
  ]);
  return {
    friends: friends.results.map(p => ({ ...publicPerson(p), state: p.state, outgoing: Boolean(p.outgoing) })),
    blocked: blocked.results.map(p => ({ username: p.username, name: p.display_name || p.username.split('#')[0] })),
    threads: threads.results.map(p => ({ ...publicPerson(p), id: p.id, unread: p.unread, preview: p.preview || 'Start the conversation', updatedAt: p.updated_at })),
  };
}

async function requestFriend(db, account, input) {
  const peer = await socialPeer(db, input.username, account);
  const [first, second] = accountPair(account, peer.account_id);
  const result = await db.prepare(`INSERT INTO friendships (first_account, second_account, requester, state, created_at)
    SELECT ?, ?, ?, 'pending', ? WHERE NOT EXISTS (SELECT 1 FROM account_blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?))
    ON CONFLICT(first_account, second_account) DO UPDATE SET state = CASE WHEN friendships.requester != excluded.requester THEN 'accepted' ELSE friendships.state END
    RETURNING state`).bind(first, second, account, Date.now(), account, peer.account_id, peer.account_id, account).first();
  if (!result) throw new AppError(403, 'A friend request cannot be sent to this person.');
  return { state: result.state };
}

async function friendAction(db, account, input) {
  const peer = await socialPeer(db, input.username, account);
  const [first, second] = accountPair(account, peer.account_id);
  if (input.action === 'block') {
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO account_blocks (blocker, blocked) VALUES (?, ?)').bind(account, peer.account_id),
      db.prepare('DELETE FROM friendships WHERE first_account = ? AND second_account = ?').bind(first, second),
    ]);
  } else if (input.action === 'unblock') {
    await db.prepare('DELETE FROM account_blocks WHERE blocker = ? AND blocked = ?').bind(account, peer.account_id).run();
  } else if (input.action === 'accept') {
    const updated = await db.prepare(`UPDATE friendships SET state = 'accepted' WHERE first_account = ? AND second_account = ? AND requester != ?
      AND NOT EXISTS (SELECT 1 FROM account_blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?)) RETURNING state`)
      .bind(first, second, account, account, peer.account_id, peer.account_id, account).first();
    if (!updated) throw new AppError(409, 'This request is no longer available.');
  } else if (['decline', 'cancel', 'remove'].includes(input.action)) {
    await db.prepare(`DELETE FROM friendships WHERE first_account = ? AND second_account = ? AND
      ((? = 'remove' AND state = 'accepted') OR (? = 'cancel' AND state = 'pending' AND requester = ?) OR (? = 'decline' AND state = 'pending' AND requester != ?))`)
      .bind(first, second, input.action, input.action, account, input.action, account).run();
  } else throw new AppError(400, 'Choose a friend action.');
  return { ok: true };
}

const directPermission = `EXISTS (SELECT 1 FROM friendships f WHERE f.first_account = t.first_account AND f.second_account = t.second_account AND f.state = 'accepted')
  AND NOT EXISTS (SELECT 1 FROM account_blocks b WHERE (b.blocker = t.first_account AND b.blocked = t.second_account) OR (b.blocker = t.second_account AND b.blocked = t.first_account))`;

async function openDirect(db, account, input) {
  const peer = await socialPeer(db, input.username, account);
  const [first, second] = accountPair(account, peer.account_id);
  const thread = await db.prepare(`INSERT INTO direct_threads (id, first_account, second_account, updated_at)
    SELECT ?, ?, ?, ? FROM friendships t WHERE t.first_account = ? AND t.second_account = ? AND t.state = 'accepted'
      AND NOT EXISTS (SELECT 1 FROM account_blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?))
    ON CONFLICT(first_account, second_account) DO UPDATE SET updated_at = direct_threads.updated_at RETURNING id`)
    .bind(crypto.randomUUID(), first, second, Date.now(), first, second, first, second, second, first).first();
  if (!thread) throw new AppError(403, 'Accept a friend request before starting a DM.');
  return thread;
}

async function directThread(db, account, id) {
  if (!idPattern.test(id)) throw new AppError(404, 'Conversation not found.');
  const thread = await db.prepare(`SELECT t.*, (${directPermission}) AS can_send FROM direct_threads t WHERE id = ? AND (first_account = ? OR second_account = ?)`)
    .bind(id, account, account).first();
  if (!thread) throw new AppError(404, 'Conversation not found.');
  return thread;
}

async function directHistory(db, account, thread, before) {
  const peerAccount = thread.first_account === account ? thread.second_account : thread.first_account;
  const peer = await db.prepare('SELECT * FROM profiles WHERE account_id = ?').bind(peerAccount).first();
  const { results } = await db.prepare(`SELECT id, account_id = ? AS mine, CASE WHEN deleted_at IS NULL THEN text END AS text, created_at, edited_at, deleted_at IS NOT NULL AS deleted
    FROM direct_messages WHERE thread_id = ? AND id < ? ORDER BY id DESC LIMIT 81`).bind(account, thread.id, before).all();
  return { id: thread.id, peer: publicPerson(peer), canSend: Boolean(thread.can_send), earlier: results.length > 80, messages: results.slice(0, 80).reverse() };
}

async function directAction(db, account, thread, action, input) {
  const now = Date.now();
  if (action === 'messages') {
    if (!thread.can_send) throw new AppError(403, 'Messaging is unavailable. You must be friends and neither person can be blocked.');
    const text = requiredText(input.text, 4000, 'Message');
    const requestId = boardId(input.id);
    const duplicate = await db.prepare('SELECT id FROM direct_messages WHERE thread_id = ? AND account_id = ? AND request_id = ?').bind(thread.id, account, requestId).first();
    if (duplicate) return duplicate;
    const inserted = await db.prepare(`INSERT INTO direct_messages (thread_id, account_id, text, request_id, created_at)
      SELECT t.id, ?, ?, ?, ? FROM direct_threads t WHERE t.id = ? AND (${directPermission})
        AND NOT EXISTS (SELECT 1 FROM direct_messages WHERE account_id = ? AND created_at > ?)
      ON CONFLICT(thread_id, account_id, request_id) DO UPDATE SET request_id = excluded.request_id RETURNING id`)
      .bind(account, text, requestId, now, thread.id, account, now - 600).first();
    if (!inserted) throw new AppError(429, 'Wait a moment and check you are still friends.');
    await db.prepare('UPDATE direct_threads SET updated_at = ? WHERE id = ?').bind(now, thread.id).run();
    return inserted;
  }
  if (action === 'read') {
    const through = messageId(input.through);
    const field = thread.first_account === account ? 'first_read' : 'second_read';
    await db.prepare(`UPDATE direct_threads SET ${field} = max(${field}, ?) WHERE id = ? AND EXISTS (SELECT 1 FROM direct_messages WHERE thread_id = ? AND id = ?)`)
      .bind(through, thread.id, thread.id, through).run();
    return { ok: true };
  }
  const id = messageId(input.id);
  if (action === 'edit') {
    const text = requiredText(input.text, 4000, 'Message');
    const result = await db.prepare(`UPDATE direct_messages SET text = ?, edited_at = ? WHERE id = ? AND thread_id = ? AND account_id = ? AND deleted_at IS NULL RETURNING id`)
      .bind(text, now, id, thread.id, account).first();
    if (!result) throw new AppError(404, 'Your message is no longer available.');
  } else if (action === 'delete') {
    const result = await db.prepare('UPDATE direct_messages SET text = ?, deleted_at = coalesce(deleted_at, ?) WHERE id = ? AND thread_id = ? AND account_id = ? RETURNING id')
      .bind('', now, id, thread.id, account).first();
    if (!result) throw new AppError(404, 'Your message is no longer available.');
  } else throw new AppError(405, 'This action is unavailable.');
  return { ok: true };
}

async function handleSocial(db, request, url, account) {
  if (!account) throw new AppError(401, 'Sign in and choose a username to use friends and DMs.');
  const path = url.pathname.slice('/api/social'.length);
  if (path === '' && request.method === 'GET') return json(await socialOverview(db, account));
  if (request.method === 'POST' && path === '/friends') return json(await requestFriend(db, account, await body(request)));
  if (request.method === 'POST' && path === '/friend-action') return json(await friendAction(db, account, await body(request)));
  if (request.method === 'POST' && path === '/direct') return json(await openDirect(db, account, await body(request)));
  const match = path.match(/^\/direct\/([a-f0-9-]+)(?:\/(messages|edit|delete|read))?$/);
  if (!match) throw new AppError(404, 'Social endpoint not found.');
  const thread = await directThread(db, account, match[1]);
  if (request.method === 'GET' && !match[2]) return json(await directHistory(db, account, thread, url.searchParams.has('before') ? messageId(Number(url.searchParams.get('before'))) : Number.MAX_SAFE_INTEGER));
  if (request.method === 'POST' && match[2]) return json(await directAction(db, account, thread, match[2], await body(request)));
  throw new AppError(405, 'This action is unavailable.');
}

async function getRoom(db, roomId, member, admin, channel, after, revision, through) {
  await deliverScheduled(db, roomId);
  const now = Date.now();
  if (member.last_seen < now - 22_000) {
    await db.prepare('UPDATE members SET last_seen = ? WHERE id = ?').bind(now, member.id).run();
  }
  const reset = revision !== null && revision !== String(member.moderation_version);
  const incremental = after > 0 && !reset;
  const [people, page, channels, voice] = await db.batch([
    db.prepare(`SELECT m.id, m.account_id, m.name, m.is_host, m.last_seen, m.typing_channel, m.typing_until, p.display_name, p.bio, p.color,
      p.game, p.music, p.share_activity, p.steam, p.lastfm, p.spotify, p.avatar_key, p.banner_key, p.details_json, p.username, p.status_text, p.status_until
      FROM members m LEFT JOIN profiles p ON p.account_id = m.account_id
      WHERE m.room_id = ? AND NOT EXISTS (SELECT 1 FROM room_bans b WHERE b.room_id = m.room_id AND b.actor = CASE WHEN m.account_id IS NOT NULL THEN 'account:' || m.account_id ELSE 'member:' || m.id END)
      ORDER BY m.is_host DESC, m.rowid`).bind(roomId),
    db.prepare(`SELECT msg.id, msg.member_id, msg.kind, msg.created_at, msg.edited_at, msg.pinned_at, msg.reply_to,
      coalesce(p.display_name, m.name) AS name, p.color,
      coalesce(m.id = ? OR m.account_id = ?, 0) AS mine,
      CASE WHEN msg.hidden_at IS NULL AND msg.deleted_at IS NULL THEN msg.text END AS text,
      msg.hidden_at IS NOT NULL AS hidden, msg.deleted_at IS NOT NULL AS deleted,
      CASE WHEN msg.hidden_at IS NULL AND msg.deleted_at IS NULL THEN msg.image_key END AS image_key,
      CASE WHEN msg.hidden_at IS NULL AND msg.deleted_at IS NULL THEN msg.image_alt END AS image_alt,
      CASE WHEN msg.hidden_at IS NULL AND msg.deleted_at IS NULL THEN poll.options_json END AS poll_options,
      poll.closed_at AS poll_closed_at,
      CASE WHEN original.hidden_at IS NULL AND original.deleted_at IS NULL THEN substr(coalesce(nullif(original.text, ''),
        CASE WHEN original.image_key IS NOT NULL THEN coalesce(nullif(original.image_alt, ''), 'Shared image') END), 1, 160) END AS reply_text,
      CASE WHEN original.hidden_at IS NULL AND original.deleted_at IS NULL THEN coalesce(rp.display_name, sender.name,
        CASE original.kind WHEN 'assistant' THEN 'ChatGPT' WHEN 'notice' THEN 'Room update' END) END AS reply_name
      FROM messages msg LEFT JOIN members m ON m.id = msg.member_id LEFT JOIN profiles p ON p.account_id = m.account_id
      LEFT JOIN message_polls poll ON poll.message_id = msg.id
      LEFT JOIN messages original ON original.id = msg.reply_to AND original.room_id = msg.room_id AND original.channel = msg.channel
      LEFT JOIN members sender ON sender.id = original.member_id LEFT JOIN profiles rp ON rp.account_id = sender.account_id
      WHERE msg.room_id = ? AND msg.channel = ? AND msg.id > ? AND msg.id <= ?
      ORDER BY msg.id ${incremental ? 'ASC' : 'DESC'} LIMIT 100`)
      .bind(member.id, member.account_id, roomId, channel, incremental ? after : 0, through ?? Number.MAX_SAFE_INTEGER),
    db.prepare(`SELECT available.name, available.section, settings.topic, settings.slow_seconds, (SELECT msg.id FROM messages msg WHERE msg.room_id = ?
      AND msg.channel = available.name AND msg.hidden_at IS NULL AND msg.deleted_at IS NULL ORDER BY msg.id DESC LIMIT 1) AS latest
      FROM (SELECT 'general' AS name, '' AS section, 0 AS created_at UNION ALL
        SELECT name, section, created_at FROM channels WHERE room_id = ?) available
      LEFT JOIN channel_settings settings ON settings.room_id = ? AND settings.channel = available.name
      ORDER BY available.created_at, available.name`).bind(roomId, roomId, roomId),
    db.prepare(`SELECT available.name, (SELECT count(*) FROM voice_members member
      WHERE member.room_id = ? AND member.channel = available.name AND member.last_seen > ?) AS people
      FROM (SELECT 'lounge' AS name, 0 AS created_at UNION ALL
        SELECT name, created_at FROM voice_channels WHERE room_id = ?) available ORDER BY available.created_at, available.name`)
      .bind(roomId, now - voiceWindow, roomId),
  ]);
  const messages = incremental ? page.results : page.results.reverse();
  const reactions = new Map();
  const votes = new Map();
  const actor = memberActor(member);
  let earlier;
  if (messages.length) {
    const lo = messages[0].id;
    const hi = messages.at(-1).id;
    const [counts, more, choices] = await db.batch([
      db.prepare(`SELECT reaction.message_id, reaction.emoji, count(*) AS count, max(reaction.actor = ?) AS mine
        FROM message_reactions reaction JOIN messages msg ON msg.id = reaction.message_id
        WHERE msg.room_id = ? AND msg.channel = ? AND msg.id BETWEEN ? AND ? AND msg.hidden_at IS NULL AND msg.deleted_at IS NULL
        GROUP BY reaction.message_id, reaction.emoji ORDER BY reaction.emoji`).bind(actor, roomId, channel, lo, hi),
      db.prepare('SELECT 1 FROM messages WHERE room_id = ? AND channel = ? AND id < ? LIMIT 1').bind(roomId, channel, lo),
      db.prepare(`SELECT vote.message_id, vote.option_index, count(*) AS count, max(vote.actor = ?) AS mine
        FROM poll_votes vote JOIN messages msg ON msg.id = vote.message_id
        WHERE msg.room_id = ? AND msg.channel = ? AND msg.id BETWEEN ? AND ? AND msg.hidden_at IS NULL AND msg.deleted_at IS NULL
        GROUP BY vote.message_id, vote.option_index`).bind(actor, roomId, channel, lo, hi),
    ]);
    earlier = more.results.length > 0;
    for (const { message_id, ...reaction } of counts.results) {
      if (!reactions.has(message_id)) reactions.set(message_id, []);
      reactions.get(message_id).push(reaction);
    }
    for (const { message_id, option_index, ...counts } of choices.results) {
      if (!votes.has(message_id)) votes.set(message_id, new Map());
      votes.get(message_id).set(option_index, counts);
    }
  }
  return {
    ...roomIdentity(member),
    admin,
    canManage: admin || Boolean(member.is_host),
    channels: channels.results.map(entry => entry.name),
    voiceChannels: voice.results,
    sections: Object.fromEntries(channels.results.filter(entry => entry.section).map(entry => [entry.name, entry.section])),
    channelSettings: Object.fromEntries(channels.results.filter(entry => entry.topic || entry.slow_seconds)
      .map(entry => [entry.name, { topic: entry.topic, slowSeconds: entry.slow_seconds }])),
    latest: Object.fromEntries(channels.results.map(entry => [entry.name, entry.latest ?? 0])),
    inviteVersion: member.invite_version,
    revision: member.moderation_version,
    reset,
    aiConnected: Boolean(member.ai_key),
    aiThinking: member.ai_until > now && (member.ai_channel ?? 'general') === channel,
    typing: [...new Map(people.results.filter(person => person.id !== member.id && (!member.account_id || person.account_id !== member.account_id)
      && person.typing_channel === channel && person.typing_until > now).map(person => [memberActor(person), person.display_name || person.name])).values()].slice(0, 3),
    members: uniqueRoomPeople(people.results, member).map(person => ({
      id: person.id, memberIds: person.memberIds, mine: person.mine,
      name: person.display_name || person.name, username: person.username || '', color: person.color, bio: person.bio || '',
      status: activeStatus(person, now),
      avatar: mediaUrl(person.avatar_key), banner: mediaUrl(person.banner_key), details: JSON.parse(person.details_json || '[]'),
      host: Boolean(person.is_host), online: person.last_seen > now - onlineWindow,
      activity: person.share_activity ? { game: person.game, music: person.music, connections: connections(person) } : null,
    })),
    earlier: incremental ? undefined : Boolean(earlier),
    messages: messages.map(({ image_key, image_alt, poll_options, poll_closed_at, ...message }) => ({
      ...message,
      image: image_key ? { url: mediaUrl(image_key), alt: image_alt } : null,
      poll: poll_options ? { closed: Boolean(poll_closed_at), options: JSON.parse(poll_options).map((label, index) => ({
        label, count: votes.get(message.id)?.get(index)?.count ?? 0, mine: Boolean(votes.get(message.id)?.get(index)?.mine),
      })) } : null,
      reactions: reactions.get(message.id) ?? [],
    })),
  };
}

function openAiKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function configureAi(env, roomId, member, input) {
  if (!member.is_host) throw new AppError(403, 'Only the host can connect ChatGPT.');
  const key = openAiKey(input.key);
  let encrypted = null;
  if (input.disconnect !== true) {
    if (!/^sk-[\w-]{15,256}$/.test(key)) throw new AppError(400, 'Enter a valid OpenAI API key.');
    encrypted = await encryptKey(env, roomId, key);
    let check;
    try {
      check = await fetch(`https://api.openai.com/v1/models/${model}`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError(502, 'Could not reach OpenAI. Try again in a moment.');
    }
    if (!check.ok) {
      await check.body?.cancel();
      throw new AppError(400, 'OpenAI could not verify this key. Check that it can access GPT-5.4 mini.');
    }
    await check.body?.cancel();
  }
  await env.DB.prepare('UPDATE rooms SET ai_key = ? WHERE id = ?').bind(encrypted, roomId).run();
  return { aiConnected: Boolean(encrypted) };
}

async function generateReply(env, roomId, channel, triggerId, encrypted, lock) {
  const db = env.DB;
  let kind = 'assistant';
  let answer;
  try {
    const history = await db.prepare(`
      SELECT msg.kind, coalesce(nullif(msg.text, ''), '[Image shared]') AS text, coalesce(p.display_name, m.name) AS name FROM messages msg
      LEFT JOIN members m ON m.id = msg.member_id LEFT JOIN profiles p ON p.account_id = m.account_id
      WHERE msg.room_id = ? AND msg.channel = ? AND msg.id <= ? AND msg.hidden_at IS NULL AND msg.deleted_at IS NULL
        AND msg.kind IN ('person', 'assistant') ORDER BY msg.id DESC LIMIT 24
    `).bind(roomId, channel, triggerId).all();
    if (!history.results.length) throw new Error('No visible messages for a reply.');
    const transcript = history.results.reverse().map(line => ({
      role: line.kind === 'assistant' ? 'assistant' : 'user',
      content: line.kind === 'assistant' ? line.text : `${line.name}: ${line.text}`,
    }));
    const key = await decryptKey(env, roomId, encrypted);
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(42_000),
      body: JSON.stringify({
        model, store: false, input: transcript, max_output_tokens: 1800,
        instructions: 'You are ChatGPT in a group room. The last message invited you to reply. Use the participants’ names where helpful and reply to the group. If asked to host a game, offer concise rules, keep track of play and invite everyone to take turns. Format legibly and keep replies conversational.',
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('The AI request failed.');
    }
    const result = await response.json();
    answer = result.output?.flatMap(item => item.content ?? []).map(part => part.text ?? part.refusal ?? '').filter(Boolean).join('\n').trim();
    if (!answer) throw new Error('The AI response was empty.');
  } catch {
    kind = 'notice';
    answer = 'ChatGPT couldn’t reply. Try again, or ask the host to check the room’s OpenAI API key and billing.';
  }
  await db.batch([
    db.prepare('INSERT INTO messages (room_id, channel, kind, text, created_at) VALUES (?, ?, ?, ?, ?)').bind(roomId, channel, kind, answer, Date.now()),
    db.prepare('UPDATE rooms SET ai_until = 0, ai_channel = NULL WHERE id = ? AND ai_until = ?').bind(roomId, lock),
  ]);
}

async function createMessage(env, ctx, roomId, member, admin, input) {
  const imageInput = input.image ?? undefined;
  const text = imageInput === undefined ? requiredText(input.text, 4000, 'Message') : optionalText(input.text, 4000, 'Caption');
  const alt = imageInput === undefined ? '' : optionalText(input.imageAlt, 160, 'Image description');
  const requestId = messageRequestId(input.id);
  const db = env.DB;
  const channel = await getChannel(db, roomId, input.channel);
  const exempt = admin || member.is_host ? 1 : 0;
  const replyTo = input.replyTo == null ? null : messageId(input.replyTo);
  const wantsAi = /(^|[^\w])@chatgpt\b/i.test(text);
  const findPrior = db.prepare('SELECT id FROM messages WHERE room_id = ? AND member_id = ? AND request_id = ?').bind(roomId, member.id, requestId);
  if (imageInput !== undefined) {
    const prior = await findPrior.first();
    if (prior) return prior;
  }
  return savePictures(env, ctx, [{ name: 'image', input: imageInput, limit: 2_000_000 }], async ({ image }) => {
    const now = Date.now();
    const statements = [db.prepare(`
      INSERT OR IGNORE INTO messages (room_id, channel, member_id, text, request_id, created_at, reply_to, image_key, image_alt)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM messages WHERE member_id = ? AND created_at > ?)
        AND (? = 1 OR NOT EXISTS (${slowModePosts}))
        AND (? IS NULL OR EXISTS (SELECT 1 FROM messages WHERE id = ? AND room_id = ? AND channel = ? AND hidden_at IS NULL AND deleted_at IS NULL))
      RETURNING id
    `).bind(roomId, channel, member.id, text, requestId, now, replyTo, image, alt, member.id, now - 400,
      exempt, ...slowModeArgs(roomId, channel, member, now), replyTo, replyTo, roomId, channel)];
    const lock = now + 60_000;
    if (wantsAi && member.ai_key) {
      statements.push(db.prepare(`UPDATE rooms SET ai_until = ?, ai_channel = ? WHERE id = ? AND ai_until < ? AND ai_key = ? AND changes() = 1 RETURNING id`)
        .bind(lock, channel, roomId, now, member.ai_key));
    }
    const [insert, claim] = await db.batch(statements);
    const id = insert.results[0]?.id;
    if (!id) {
      const prior = await findPrior.first();
      if (prior) {
        if (image) ctx.waitUntil(prunePictures(env, [image]));
        return prior;
      }
      if (replyTo && !await db.prepare('SELECT 1 FROM messages WHERE id = ? AND room_id = ? AND channel = ? AND hidden_at IS NULL AND deleted_at IS NULL')
        .bind(replyTo, roomId, channel).first()) throw new AppError(409, 'The message you’re replying to is unavailable.');
      throw await postingError(db, roomId, channel, member, exempt);
    }
    await db.prepare(`UPDATE members SET last_seen = ?, typing_until = CASE WHEN typing_channel = ? THEN 0 ELSE typing_until END WHERE id = ?`)
      .bind(now, channel, member.id).run();
    if (claim?.results.length) {
      ctx.waitUntil(generateReply(env, roomId, channel, id, member.ai_key, lock));
      return { id, ai: 'queued' };
    }
    return { id, ai: wantsAi ? (member.ai_key ? 'busy' : 'disconnected') : undefined };
  });
}

async function handleApi(request, env, ctx, url) {
  const method = request.method;
  if (method === 'POST' && request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) {
    throw new AppError(403, 'Open this room directly to send requests.');
  }
  if (!env.DB) throw new AppError(503, 'Room storage is unavailable.');
  const account = accountId(request);
  const email = account && request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const assignment = accountAssignment(env, email);
  const admin = isAdmin(env, email, assignment);
  const assigned = reservedUsernames.has(assignment?.username) ? assignment.username : null;
  if (url.pathname === '/api/profile' && (method === 'GET' || method === 'POST')) return json(await ownProfile(env, ctx, request, account, admin, assigned));
  if (url.pathname === '/api/profile/username' && method === 'POST') return json(await ownProfile(env, ctx, request, account, admin, assigned, true));
  if (account) {
    const profile = await env.DB.prepare('SELECT username FROM profiles WHERE account_id = ?').bind(account).first();
    if (assigned && profile?.username !== assigned) await assignReservedUsername(env.DB, account, assigned);
    else if (!profile?.username) throw usernameRequired();
  }
  if (method === 'POST' && url.pathname === '/api/profile/status') return json(await updateStatus(env.DB, account, await body(request)));
  if (url.pathname === '/api/social' || url.pathname.startsWith('/api/social/')) return handleSocial(env.DB, request, url, account);
  if (method === 'POST' && url.pathname === '/api/rooms') return json(await createRoom(env.DB, await body(request), account), 201);
  if (method === 'POST' && url.pathname === '/api/join') return json(await joinRoom(env.DB, await body(request), account), 201);
  const route = url.pathname.match(/^\/api\/rooms\/([a-f0-9-]+)(?:\/([a-z-]+))?$/);
  if (!route || !idPattern.test(route[1])) throw new AppError(404, 'Room endpoint not found.');
  const [, roomId, action] = route;
  const member = await authenticate(env.DB, request, roomId);
  if (method === 'GET' && action === 'bans') return json(await roomBans(env.DB, roomId, member, admin));
  if (method === 'POST' && action === 'ban') return json(await changeRoomBan(env.DB, roomId, member, admin, await body(request)));
  if (method === 'GET' && action === 'board') return json(await roomBoard(env.DB, roomId, member));
  if (method === 'POST' && action === 'board') return json(await saveBoardItem(env.DB, roomId, member, admin, await body(request)));
  if (method === 'POST' && action === 'board-action') return json(await changeBoardItem(env.DB, roomId, member, admin, await body(request)));
  if (method === 'POST' && action === 'event-response') return json(await eventResponse(env.DB, roomId, member, await body(request)));
  if (method === 'GET' && action === 'plans') return json(await personalQueue(env.DB, roomId, member));
  if (method === 'POST' && action === 'plans') return json(await saveQueueItem(env.DB, roomId, member, await body(request)));
  if (method === 'POST' && action === 'plan-action') return json(await changeQueueItem(env.DB, roomId, member, await body(request)));
  if (method === 'GET' && action === 'mentions') {
    const after = url.searchParams.has('after') ? messageId(Number(url.searchParams.get('after'))) : 0;
    return json(await roomMentions(env.DB, roomId, member, after));
  }
  if (method === 'GET' && action === 'gallery') {
    const channel = await getChannel(env.DB, roomId, url.searchParams.get('channel'));
    const before = url.searchParams.has('before') ? messageId(Number(url.searchParams.get('before'))) : Number.MAX_SAFE_INTEGER;
    return json(await mediaGallery(env.DB, roomId, channel, before));
  }
  if (method === 'GET' && action === 'activity') return json(await roomActivity(env, roomId, url.searchParams.get('member')));
  if (method === 'GET' && action === 'search') {
    const channel = url.searchParams.has('channel') ? await getChannel(env.DB, roomId, url.searchParams.get('channel')) : null;
    return json(await findMessages(env.DB, roomId, url.searchParams.get('q'), channel, url.searchParams.get('kind') ?? 'all'));
  }
  if (method === 'GET' && action === 'saved-messages') return json(await savedMessages(env.DB, roomId, url.searchParams.get('ids')));
  if (method === 'GET' && action === 'pins') return json(await pinnedMessages(env.DB, roomId, await getChannel(env.DB, roomId, url.searchParams.get('channel'))));
  if (method === 'GET' && !action) {
    const after = Math.max(0, Number.parseInt(url.searchParams.get('after') ?? '0', 10) || 0);
    const through = url.searchParams.has('through') ? messageId(Number(url.searchParams.get('through'))) : null;
    const channel = await getChannel(env.DB, roomId, url.searchParams.get('channel'));
    return json(await getRoom(env.DB, roomId, member, admin, channel, after, url.searchParams.get('revision'), through));
  }
  if (method === 'POST' && action === 'ai') return json(await configureAi(env, roomId, member, await body(request)));
  if (method === 'POST' && action === 'channels') return json(await createChannel(env.DB, roomId, member, admin, await body(request)), 201);
  if (method === 'POST' && action === 'channel-settings') return json(await updateChannelSettings(env.DB, roomId, member, admin, await body(request)));
  if (method === 'POST' && action === 'voice-channels') return json(await createVoiceChannel(env.DB, roomId, member, admin, await body(request)), 201);
  if (method === 'POST' && action === 'join-voice') return json(await joinVoice(env.DB, roomId, member, await body(request)), 201);
  if (method === 'POST' && action === 'voice-state') return json(await voiceState(env.DB, roomId, member, await body(request)));
  if (method === 'POST' && action === 'voice-signal') return json(await signalVoice(env.DB, roomId, member, await body(request)));
  if (method === 'POST' && action === 'leave-voice') return json(await leaveVoice(env.DB, roomId, member, await body(request)));
  if (method === 'POST' && action === 'channel-group') return json(await groupChannel(env.DB, roomId, member, admin, await body(request)));
  if (method === 'POST' && action === 'settings') return json(await updateRoom(env, ctx, request, roomId, member, admin));
  if (method === 'POST' && action === 'edit-message') return json(await editMessage(env.DB, roomId, member, await body(request)));
  if (method === 'POST' && action === 'delete-message') return json(await deleteMessage(env, ctx, roomId, member, await body(request)));
  if (method === 'POST' && action === 'reaction') return json(await setReaction(env.DB, roomId, member, await body(request)));
  if (method === 'POST' && action === 'pin') return json(await setPin(env.DB, roomId, member, admin, await body(request)));
  if (method === 'POST' && action === 'replace-invite') return json(await replaceInvite(env.DB, roomId, member, await body(request)));
  if (method === 'POST' && action === 'moderation') return json(await moderateMessage(env.DB, roomId, member, admin, await body(request)));
  if (method === 'POST' && action === 'polls') return json(await createPoll(env.DB, roomId, member, admin, await body(request)), 201);
  if (method === 'POST' && action === 'poll-vote') return json(await voteInPoll(env.DB, roomId, member, await body(request)));
  if (method === 'POST' && action === 'close-poll') return json(await closePoll(env.DB, roomId, member, admin, await body(request)));
  if (method === 'POST' && action === 'typing') return json(await typingStatus(env.DB, roomId, member, await body(request)));
  if (method === 'POST' && action === 'messages') return json(await createMessage(env, ctx, roomId, member, admin, await body(request, Math.ceil(gifLimit / 3) * 4 + 32_000)), 201);
  throw new AppError(405, 'This action is unavailable.');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, ctx, url);
      } catch (error) {
        if (error instanceof AppError) return json({ error: error.message, code: error.code }, error.status);
        console.error('Duo Chat request failed', error.name);
        return json({ error: 'Something went wrong. Try again in a moment.' }, 500);
      }
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/media/')) {
      try {
        return await servePicture(request, env, url.pathname.slice(7));
      } catch {
        return new Response(null, { status: 503 });
      }
    }
    const asset = assets[url.pathname];
    if (!asset) return new Response('Page not found', { status: 404, headers: security });
    const [type, data] = asset;
    return new Response(request.method === 'HEAD' ? null : data, {
      headers: { ...security, 'Content-Type': type, 'Cache-Control': 'no-cache' },
    });
  },
};
