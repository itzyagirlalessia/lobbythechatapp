import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openLocalDatabase } from './local-db.mjs';
import { latestRelease } from '../src/releases.js';
import './build.mjs';

const { default: app } = await import('../dist/server/index.js');
const objects = new Map();
const bucket = {
  async put(key, body, { httpMetadata }) { objects.set(key, { body, httpMetadata }); },
  async get(key) { return objects.get(key); },
  async delete(key) { objects.delete(key); },
};
const env = { DB: openLocalDatabase(':memory:'), BUCKET: bucket, ROOM_KEY_ENCRYPTION: randomBytes(32).toString('base64'), DUO_ADMIN_EMAILS: 'moderator@example.test' };
env.DUO_ACCOUNT_ASSIGNMENTS = JSON.stringify({
  'aless@example.test': { username: 'alessdefles#0000', admin: true },
  'romee@example.test': { username: 'romeestorm#0000' },
  'dex@example.test': { username: 'tydex#0000' },
  'elara@example.test': { username: 'elaramoon#0000' },
  'bodhi@example.test': { username: 'pedroootje#0000' },
  'twinkie@example.test': { username: 'twinkieletissier#0000' },
  'welton@example.test': { username: 'specialneedsmusic#0000' },
});
const jobs = [];
const context = { waitUntil: task => jobs.push(task) };
const fakeKey = 'sk-test-key-for-room-verification';
const moderator = { 'oai-authenticated-user-id': 'test-account', 'oai-authenticated-user-email': 'moderator@example.test' };
const plainBlair = { 'oai-authenticated-user-id': moderator['oai-authenticated-user-id'] };
const namedAccount = (id, email) => ({ 'oai-authenticated-user-id': id, 'oai-authenticated-user-email': email });
const identities = new Map();
let inferenceCount = 0;
let providerCalls = 0;
const songUrl = 'https://open.spotify.com/track/0123456789TestTrackABC';
const songImage = 'https://i.scdn.co/image/testcover';
const previewImage = 'https://image-cdn-ak.spotifycdn.com/image/testcover';
let spotifyPrivate = true;
let spotifyPlaybackStatus = 200;
let spotifyChallenge;
let spotifyTokenCalls = 0;
let spotifyRefreshes = 0;

globalThis.fetch = async (url, options) => {
  const requestUrl = new URL(url);
  if (options.redirect === 'error') throw new TypeError('Worker fetch does not accept redirect mode error.');
  if (requestUrl.hostname === 'api.steampowered.com') {
    assert.equal(requestUrl.searchParams.get('key'), env.DUO_STEAM_API_KEY);
    assert.equal(requestUrl.searchParams.get('steamids'), '76561198000000000');
    providerCalls++;
    return Response.json({ response: { players: [{ steamid: '76561198000000000', communityvisibilitystate: 3, gameextrainfo: 'Test Game' }] } });
  }
  if (requestUrl.hostname === 'ws.audioscrobbler.com') {
    assert.equal(requestUrl.searchParams.get('api_key'), env.DUO_LASTFM_API_KEY);
    assert.equal(requestUrl.searchParams.get('user'), 'test-user');
    providerCalls++;
    return Response.json({ recenttracks: { track: [{ name: 'Test Song', artist: { '#text': 'Test Artist' }, '@attr': { nowplaying: 'true' } }] } });
  }
  if (requestUrl.href.startsWith('https://open.spotify.com/oembed?')) {
    assert.equal(requestUrl.searchParams.get('url'), songUrl);
    return Response.json({ title: 'Paper Satellites', thumbnail_url: previewImage, html: '<script>ignored</script>' });
  }
  if (requestUrl.href === 'https://accounts.spotify.com/api/token') {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(options.body);
    assert.equal(params.get('client_id'), env.DUO_SPOTIFY_CLIENT_ID);
    if (params.get('grant_type') === 'refresh_token') {
      spotifyRefreshes++;
      assert.equal(params.get('refresh_token'), 'spotify-test-refresh');
      return Response.json({ access_token: 'spotify-test-access', expires_in: 3600 });
    }
    spotifyTokenCalls++;
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(params.get('code'), 'spotify-test-code');
    assert.equal(params.get('redirect_uri'), env.DUO_SPOTIFY_REDIRECT_URI);
    const verifier = params.get('code_verifier');
    assert.match(verifier, /^[a-f0-9]{96}$/);
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), spotifyChallenge);
    return Response.json({ access_token: 'spotify-test-access', refresh_token: 'spotify-test-refresh', expires_in: spotifyPrivate ? 3600 : 1 });
  }
  if (requestUrl.href === 'https://api.spotify.com/v1/me/player') {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, 'Bearer spotify-test-access');
    if (spotifyPlaybackStatus !== 200) return new Response(null, { status: spotifyPlaybackStatus });
    return Response.json({ is_playing: true, device: { is_private_session: spotifyPrivate }, progress_ms: 45_000,
      item: { type: 'track', id: songUrl.split('/').at(-1), name: 'Paper Satellites', duration_ms: 180_000,
        artists: [{ name: 'Night Signal' }], album: { images: [{ width: 300, url: songImage }] } } });
  }
  assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
  if (url.endsWith('/models/gpt-5.4-mini')) return Response.json({ id: 'gpt-5.4-mini' });
  assert.equal(url, 'https://api.openai.com/v1/responses');
  const payload = JSON.parse(options.body);
  assert.equal(payload.store, false);
  assert(payload.input.some(turn => turn.content === 'Cameron: I’m ready!'));
  assert(payload.input.some(turn => turn.content.startsWith('Blair: @ChatGPT')));
  assert(!payload.input.some(turn => turn.content.includes('Spoiler')));
  inferenceCount++;
  return Response.json({ output: [{ content: [{ text: 'First trivia question!' }] }] });
};

async function request(path, input, access, expected = 200, identity = identities.get(access)) {
  const headers = { ...identity };
  if (access) headers.Authorization = `Bearer ${access}`;
  if (input) headers['Content-Type'] = 'application/json';
  const response = await app.fetch(new Request(`http://127.0.0.1${path}`, {
    method: input ? 'POST' : 'GET', headers, body: input ? JSON.stringify(input) : undefined,
  }), env, context);
  const value = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  return value;
}

const host = await request('/api/rooms', { name: 'Alex', title: 'Friday game night' }, null, 201);
assert.equal((await request('/api/profile')).environment, 'production');
env.DUO_ENVIRONMENT = 'staging';
assert.equal((await request('/api/profile')).environment, 'staging');
delete env.DUO_ENVIRONMENT;
const roomPath = `/api/rooms/${host.id}`;
await request(roomPath, null, null, 401);
await request('/api/join', { name: 'Cameron', invite: 'invalid' }, null, 404);
const blockedJoin = await request('/api/join', { name: 'Blair', invite: host.invite }, null, 409, plainBlair);
assert.equal(blockedJoin.code, 'username_required');
await request('/api/rooms', { name: 'Blair', title: 'Before setup' }, null, 409, plainBlair);
await request('/api/profile/username', { username: 'blair' }, null, 401);
await request('/api/profile/username', { username: 'blair#0000' }, null, 400, plainBlair);
const onboarded = await request('/api/profile/username', { username: 'BLAIR' }, null, 200, plainBlair);
assert.match(onboarded.profile.username, /^blair#\d{4}$/);
assert.equal((await request('/api/profile/username', { username: 'another' }, null, 200, plainBlair)).profile.username, onboarded.profile.username);
const [blair, cameron] = await Promise.all([
  request('/api/join', { name: 'Blair', invite: host.invite }, null, 201, plainBlair),
  request('/api/join', { name: 'Cameron', invite: host.invite }, null, 201),
]);
identities.set(blair.access, plainBlair);
const initial = await request(roomPath, null, blair.access);
assert.deepEqual(initial.members.map(member => member.name), ['Alex', 'Blair', 'Cameron']);
const browserRooms = '/api/profile/browser-rooms';
assert.match(onboarded.browserAccount, /^[a-f0-9]{64}$/);
assert.equal((await request('/api/profile', null, null, 200, moderator)).browserAccount, onboarded.browserAccount);
const anotherBrowser = await request('/api/profile', null, null, 200, namedAccount('different-user'));
assert.notEqual(anotherBrowser.browserAccount, onboarded.browserAccount);
const releasePath = '/api/profile/seen-release';
const release = latestRelease.number;
assert.equal(onboarded.seenRelease, 0);
assert.equal(anotherBrowser.seenRelease, 0);
await request(releasePath, { release }, null, 401);
await request(releasePath, { release }, null, 409, namedAccount('different-user'));
await request(releasePath, { release: release + 1 }, null, 400, plainBlair);
await request(releasePath, { release: String(release) }, null, 400, plainBlair);
assert.deepEqual(await Promise.all([
  request(releasePath, { release }, null, 200, plainBlair),
  request(releasePath, { release }, null, 200, plainBlair),
]), [{ seen: true }, { seen: true }]);
assert.equal((await request('/api/profile', null, null, 200, moderator)).seenRelease, release);
assert.equal((await request('/api/profile', null, null, 200, namedAccount('different-user'))).seenRelease, 0);
assert.deepEqual(await request(browserRooms, { rooms: [{ id: blair.id, access: blair.access }] }, null, 200, plainBlair), { rooms: [host.id] });
assert.deepEqual(await request(browserRooms, { rooms: [{ id: blair.id, access: blair.access }] }, null, 200, namedAccount('different-user')), { rooms: [] });
assert.deepEqual(await request(browserRooms, { rooms: [{ id: host.id, access: host.access }] }, null, 200, plainBlair), { rooms: [] });
assert.deepEqual(await request(browserRooms, { rooms: [{ id: host.id, access: host.access }] }, null), { rooms: [host.id] });
assert.deepEqual(initial.channels, ['general']);
assert.equal(initial.canManage, false);
assert.equal((await request('/api/profile', null, null, 200, moderator)).admin, true);
assert.equal((await request('/api/profile', null, null, 200, { 'oai-authenticated-user-email': moderator['oai-authenticated-user-email'] })).admin, false);
await request(`${roomPath}/channels`, { name: 'trivia' }, blair.access, 403);
await request(`${roomPath}/channels`, { name: 'trivia' }, null, 401, moderator);
assert.equal((await request(`${roomPath}/channels`, { name: 'Trivia Club' }, blair.access, 201, moderator)).name, 'trivia-club');
await request(`${roomPath}/channels`, { name: 'trivia-club' }, host.access, 409);
assert.deepEqual((await request(roomPath, null, host.access)).channels, ['general', 'trivia-club']);
const spacingPath = roomPath + '/sidebar-spacer';
await request(spacingPath, { kind: 'voice', name: 'lounge', style: 'divider' }, blair.access, 403);
await request(spacingPath, { kind: 'voice', name: 'unavailable', style: 'divider' }, host.access, 404);
await request(spacingPath, { kind: 'voice', name: 'lounge', style: 'arbitrary' }, host.access, 400);
assert.deepEqual(await request(spacingPath, { kind: 'voice', name: 'lounge', style: 'divider' }, host.access), { spacers: { 'voice:lounge': 'divider' } });
assert.deepEqual(await request(spacingPath, { kind: 'text', name: 'general', style: 'large' }, host.access), { spacers: { 'voice:lounge': 'divider', 'text:general': 'large' } });
assert.deepEqual((await request(roomPath, null, blair.access)).spacers, { 'voice:lounge': 'divider', 'text:general': 'large' });
assert.deepEqual(await request(spacingPath, { kind: 'voice', name: 'lounge', style: 'none' }, host.access), { spacers: { 'text:general': 'large' } });

const original = { id: randomUUID(), text: 'Welcome friends!' };
const first = await request(`${roomPath}/messages`, original, host.access, 201);
const duplicate = await request(`${roomPath}/messages`, original, host.access, 201);
assert.equal(duplicate.id, first.id);
await request(`${roomPath}/messages`, { id: randomUUID(), text: 'I’m ready!' }, cameron.access, 201);
await request(`${roomPath}/messages`, { id: randomUUID(), text: 'Spoiler', channel: 'trivia-club' }, blair.access, 201);
const privateChannel = await request(`${roomPath}?channel=trivia-club`, null, host.access);
assert.deepEqual(privateChannel.messages.map(message => message.text), ['Spoiler']);

await request(`${roomPath}/ai`, { key: fakeKey }, blair.access, 403, moderator);
assert.equal((await request(`${roomPath}/ai`, { key: fakeKey }, host.access)).aiConnected, true);
const stored = await env.DB.prepare('SELECT ai_key FROM rooms WHERE id = ?').bind(host.id).first();
assert(!stored.ai_key.includes(fakeKey));

await delay(410);
const ask = await request(`${roomPath}/messages`, { id: randomUUID(), text: '@ChatGPT Start a trivia game' }, blair.access, 201);
assert.equal(ask.ai, 'queued');
await Promise.all(jobs);
assert.equal(inferenceCount, 1);
for (const player of [host, blair, cameron]) {
  const all = await request(roomPath, null, player.access);
  assert.equal(all.messages.length, 4);
  assert.equal(all.messages.at(-1).text, 'First trivia question!');
  const newMessages = await request(`${roomPath}?after=${ask.id}`, null, player.access);
  assert.deepEqual(newMessages.messages.map(message => message.kind), ['assistant']);
}

const otherRoom = await request('/api/rooms', { name: 'Alex', title: 'Another room' }, null, 201);
await request(`/api/rooms/${otherRoom.id}`, null, blair.access, 401);
await request(`/api/rooms/${otherRoom.id}/moderation`, { messageId: first.id, hidden: true }, otherRoom.access, 404, moderator);
await request(`${roomPath}/moderation`, { messageId: first.id, hidden: true }, cameron.access, 403);
await request(`${roomPath}/moderation`, { messageId: first.id, hidden: true }, blair.access, 200, moderator);
const hidden = await request(`${roomPath}?after=${ask.id}&revision=${initial.revision}`, null, cameron.access);
assert.equal(hidden.reset, true);
assert.equal(hidden.messages[0].hidden, 1);
assert.equal(hidden.messages[0].text, null);
await request(`${roomPath}/moderation`, { messageId: first.id, hidden: false }, host.access, 200);
assert.equal((await request(roomPath, null, cameron.access)).messages[0].text, original.text);
assert.equal((await request(`${roomPath}/ai`, { disconnect: true }, host.access)).aiConnected, false);
assert.equal((await request('/api/profile', null, null)).signedIn, false);
await request(roomPath, null, blair.access, 401, {});
const profile = { displayName: 'Blair Arcade', bio: 'Here to play', color: 2, game: 'Manual game', music: 'Manual song', steam: '76561198000000000', lastfm: 'test-user', spotify: 'https://open.spotify.com/user/test-user?si=1234' };
await request('/api/profile', profile, null, 401);
await request('/api/profile', { ...profile, steam: 'https://steamcommunity.com.evil.test/id/anyone' }, null, 400, plainBlair);
const savedProfile = await request('/api/profile', profile, null, 200, plainBlair);
assert.equal(savedProfile.profile.displayName, 'Blair Arcade');
assert.equal(savedProfile.profile.username, onboarded.profile.username);
for (const username of ['alessdefles#0000', 'romeestorm#0000', 'elaramoon#0000', 'hergametech#0000', 'tydex#0000']) {
  const result = await request('/api/profile', { ...profile, username: ` ${username.toUpperCase()} ` }, null, 400, moderator);
  assert.match(result.error, /adds your four-digit tag/);
}
await request('/api/profile', { ...profile, displayName: 'ELARAMOON # 0000' }, null, 400, plainBlair);
await request('/api/rooms', { title: 'Test room', name: 'HerGameTech#0000' }, null, 400);
await request('/api/join', { name: 'RomeeStorm#0000', invite: host.invite }, null, 400);
await request('/api/profile', { ...profile, username: 'Bad name!' }, null, 400, plainBlair);
const claimed = await request('/api/profile', { ...profile, username: 'BLair_Arcade' }, null, 200, plainBlair);
assert.match(claimed.profile.username, /^blair_arcade#\d{4}$/);
const sameOwner = await request('/api/profile', { ...profile, username: 'blair_arcade' }, null, 200, plainBlair);
assert.equal(sameOwner.profile.username, claimed.profile.username);
const anotherAccount = { 'oai-authenticated-user-id': 'second-username-test' };
const sameBase = await request('/api/profile', { ...profile, username: 'BLAIR_ARCADE' }, null, 200, anotherAccount);
assert.match(sameBase.profile.username, /^blair_arcade#\d{4}$/);
assert.notEqual(sameBase.profile.username, claimed.profile.username);
const otherTag = await request('/api/profile', { ...profile, username: 'tydex' }, null, 200, anotherAccount);
assert.match(otherTag.profile.username, /^tydex#\d{4}$/);
assert.notEqual(otherTag.profile.username, 'tydex#0000');
const legacyUpdate = await request('/api/profile', profile, null, 200, plainBlair);
assert.equal(legacyUpdate.profile.username, claimed.profile.username);
assert.equal((await request(roomPath, null, host.access)).members.find(member => member.id === blair.memberId).username, claimed.profile.username);
await request('/api/profile', { ...profile, username: '' }, null, 400, anotherAccount);
const aless = namedAccount('test-aless', ' ALESS@EXAMPLE.TEST ');
assert.equal((await request('/api/profile', null, null, 200, { 'oai-authenticated-user-email': 'aless@example.test' })).admin, false);
const alessProfile = await request('/api/profile', null, null, 200, aless);
assert.equal(alessProfile.admin, true);
assert.equal(alessProfile.profile.username, 'alessdefles#0000');
assert.equal(alessProfile.profile.usernameAssigned, true);
assert.equal((await request('/api/profile', profile, null, 200, aless)).profile.username, 'alessdefles#0000');
await request('/api/profile', { ...profile, username: 'aless' }, null, 409, namedAccount('test-aless'));
for (const [email, username] of [['romee', 'romeestorm'], ['dex', 'tydex'], ['elara', 'elaramoon'], ['twinkie', 'twinkieletissier'], ['welton', 'specialneedsmusic']]) {
  const account = namedAccount(`test-${email}`, `${email}@example.test`);
  const membership = await request('/api/join', { name: email, invite: host.invite }, null, 201, account);
  const response = await request('/api/profile', null, null, 200, account);
  assert.equal(response.profile.username, `${username}#0000`);
  assert.equal(response.profile.usernameAssigned, true);
  assert.equal(response.admin, false);
  await request('/api/profile', { ...profile, username }, null, 409, account);
  await request('/api/rooms', { name: `${username.toUpperCase()}#0000`, title: 'Reserved name' }, null, 400);
  assert.equal((await request(roomPath, null, membership.access, 200, account)).members.find(person => person.id === membership.memberId).username, `${username}#0000`);
}
env.DUO_ADDITIONAL_ADMIN_EMAILS = ' other-admin@example.test, TWINKIE@EXAMPLE.TEST ';
const addedAdmin = await request('/api/profile', null, null, 200, namedAccount('test-twinkie', 'twinkie@example.test'));
assert.equal(addedAdmin.profile.username, 'twinkieletissier#0000');
assert.equal(addedAdmin.admin, true);
assert.equal((await request('/api/profile', null, null, 200, moderator)).admin, true);
assert.equal((await request('/api/profile', null, null, 200, aless)).admin, true);
assert.equal((await request('/api/profile', null, null, 200, namedAccount('test-welton', 'welton@example.test'))).admin, false);
const badgeRoom = await request('/api/rooms', { name: 'Admin', title: 'Badge checks' }, null, 201, aless);
const badgeGuest = await request('/api/join', { name: 'New joiner', invite: badgeRoom.invite, admin: true }, null, 201);
const readBadges = () => request('/api/rooms/' + badgeRoom.id, null, badgeGuest.access);
const twinkie = namedAccount('test-twinkie', 'twinkie@example.test');
await request('/api/join', { name: 'Developer', invite: badgeRoom.invite }, null, 201, twinkie);
const rosterModerator = await request('/api/join', { name: 'Moderator', invite: badgeRoom.invite }, null, 201, moderator);
// Simulate an existing reserved profile whose owner has not returned since the migration.
await env.DB.prepare('UPDATE profiles SET admin_badge_key = NULL WHERE username = ?').bind('twinkieletissier#0000').run();
const guestView = await readBadges();
assert.equal(guestView.canManage, false);
assert.equal(guestView.members.find(p => p.username === 'alessdefles#0000').admin, true);
assert.equal(guestView.members.find(p => p.username === 'twinkieletissier#0000').admin, true);
assert.equal(guestView.members.find(p => p.id === rosterModerator.memberId).admin, true);
assert.equal(guestView.members.find(p => p.mine).admin, false);
assert(!JSON.stringify(guestView.members).match(/@example\.test|admin_badge_key|test-twinkie/));
await request('/api/rooms/' + badgeRoom.id + '/channels', { name: 'forged', admin: true }, badgeGuest.access, 403);
await request('/api/social/friends', { username: 'twinkieletissier#0000' }, null, 200, aless);
await request('/api/social/friend-action', { username: 'alessdefles#0000', action: 'accept' }, null, 200, twinkie);
assert.equal((await request('/api/social', null, null, 200, aless)).friends[0].admin, true);
const badgeThread = await request('/api/social/direct', { username: 'twinkieletissier#0000' }, null, 200, aless);
assert.equal((await request('/api/social/direct/' + badgeThread.id, null, null, 200, aless)).peer.admin, true);
delete env.DUO_ADDITIONAL_ADMIN_EMAILS;
assert.equal((await readBadges()).members.find(p => p.username === 'twinkieletissier#0000').admin, false);
assert.equal((await request('/api/social', null, null, 200, aless)).threads[0].admin, false);
const bodhi = namedAccount('test-bodhi', ' BODHI@EXAMPLE.TEST ');
const bodhiMembership = await request('/api/join', { name: 'Bodhi', invite: host.invite }, null, 201, bodhi);
const bodhiProfiles = await Promise.all([
  request('/api/profile', null, null, 200, bodhi),
  request('/api/profile', null, null, 200, bodhi),
]);
assert.equal(bodhiProfiles[0].profile.username, 'pedroootje#0000');
assert.equal(bodhiProfiles[0].profile.username, bodhiProfiles[1].profile.username);
assert.equal(bodhiProfiles[0].admin, false);
assert.equal(bodhiProfiles[0].profile.usernameAssigned, true);
assert.equal((await request('/api/profile', null, null, 200, { 'oai-authenticated-user-email': 'bodhi@example.test' })).profile.username, '');
assert.equal((await request('/api/profile', null, null, 200, namedAccount('other-bodhi'))).profile.username, '');
assert.equal((await request('/api/profile', profile, null, 200, bodhi)).profile.username, 'pedroootje#0000');
await request('/api/profile', { ...profile, username: 'pedro' }, null, 409, bodhi);
await request('/api/profile', { ...profile, username: 'pedroootje#0000' }, null, 400, plainBlair);
await request('/api/rooms', { name: 'PEDROOOTJE#0000', title: 'Reserved name' }, null, 400);
assert.equal((await request(roomPath, null, bodhiMembership.access, 200, bodhi)).members.find(person => person.id === bodhiMembership.memberId).username, 'pedroootje#0000');
assert.equal(savedProfile.profile.shareActivity, false);
assert.equal(savedProfile.profile.connections.spotify, 'https://open.spotify.com/user/test-user');
assert.equal((await request('/api/profile', null, null, 200, { 'oai-authenticated-user-id': 'different-user' })).profile.displayName, '');
const privateRoster = (await request(roomPath, null, host.access)).members.find(person => person.id === blair.memberId);
assert.equal(privateRoster.name, 'Blair Arcade');
assert.equal(privateRoster.bio, 'Here to play');
assert.equal(privateRoster.color, 2);
assert.equal(privateRoster.activity, null);
assert(!Object.hasOwn(privateRoster, 'account_id'));
assert((await request(roomPath, null, host.access)).messages.some(message => message.name === 'Blair Arcade'));

env.DUO_STEAM_API_KEY = 'test-steam-key';
env.DUO_LASTFM_API_KEY = 'test-lastfm-key';
const activityPath = `${roomPath}/activity?member=${blair.memberId}`;
assert.deepEqual(await request(activityPath, null, host.access), { game: '', music: '' });
assert.equal(providerCalls, 0);
await request('/api/profile', { ...profile, shareActivity: true }, null, 200, plainBlair);
const shared = (await request(roomPath, null, host.access)).members.find(person => person.id === blair.memberId);
assert.equal(shared.activity.game, 'Manual game');
assert.equal(shared.activity.connections.lastfm, 'https://www.last.fm/user/test-user');
assert.deepEqual(await request(activityPath, null, host.access), { game: 'Test Game', music: 'Test Song · Test Artist' });
assert.equal(providerCalls, 2);
await request(activityPath, null, null, 401);
assert.deepEqual(await request(`/api/rooms/${otherRoom.id}/activity?member=${blair.memberId}`, null, otherRoom.access, 200, moderator), { game: '', music: '' });
await request(activityPath, null, host.access);
assert.equal(providerCalls, 2);
await request('/api/profile', profile, null, 200, plainBlair);
assert.deepEqual(await request(activityPath, null, host.access), { game: '', music: '' });

const listeningPath = roomPath + '/listening?member=' + blair.memberId;
const songProfile = { ...profile, spotifyTrack: songUrl + '?si=private-share-token', spotifyArtist: 'Night Signal' };
await request('/api/profile', { ...songProfile, spotifyTrack: 'https://open.spotify.com.example/track/0123456789TestTrackABC' }, null, 400, plainBlair);
assert.equal((await request('/api/profile', songProfile, null, 200, plainBlair)).profile.spotifyTrack, songUrl);
assert.deepEqual(await request(listeningPath, null, host.access), { track: null });
await request('/api/profile', { ...songProfile, shareActivity: true }, null, 200, plainBlair);
await request(listeningPath, null, null, 401);
assert.deepEqual(await request('/api/rooms/' + otherRoom.id + '/listening?member=' + blair.memberId, null, otherRoom.access, 200, moderator), { track: null });
const manualTrack = { url: songUrl, title: 'Paper Satellites', artist: 'Night Signal', image: previewImage, live: false };
assert.deepEqual(await request(listeningPath, null, host.access), { track: manualTrack });
assert.equal((await request('/api/profile', { ...profile, shareActivity: true }, null, 200, plainBlair)).profile.spotifyTrack, songUrl);

const spotifyOrigin = 'https://lobby.example.test';
const spotifyPath = '/api/profile/spotify/';
env.DUO_SPOTIFY_REDIRECT_URI = spotifyOrigin + spotifyPath + 'callback';
env.DUO_SPOTIFY_CLIENT_ID = '0123456789abcdef0123456789abcdef';
function spotifyRequest(path, { identity = plainBlair, access, input } = {}) {
  const headers = new Headers(identity);
  if (access) headers.set('Authorization', 'Bearer ' + access);
  if (input) headers.set('Content-Type', 'application/json');
  return app.fetch(new Request(spotifyOrigin + path, {
    method: input ? 'POST' : 'GET', headers, body: input ? JSON.stringify(input) : undefined,
  }), env, context);
}

async function connectSpotify({ checkState = false, result = 'connected' } = {}) {
  const start = await spotifyRequest(spotifyPath + 'connect', { input: {} });
  assert.equal(start.status, 200);
  const { url } = await start.json();
  const authorize = new URL(url);
  assert.equal(authorize.origin, 'https://accounts.spotify.com');
  assert.equal(authorize.searchParams.get('scope'), 'user-read-playback-state');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  spotifyChallenge = authorize.searchParams.get('code_challenge');
  const callback = spotifyPath + 'callback?code=spotify-test-code&state=' + authorize.searchParams.get('state');
  if (checkState) {
    const tokenCalls = spotifyTokenCalls;
    assert.equal((await spotifyRequest(callback, { identity: {} })).headers.get('Location'), '/?spotify=session');
    assert.equal((await spotifyRequest(callback, { identity: namedAccount('different-user') })).headers.get('Location'), '/?spotify=expired');
    assert.equal((await spotifyRequest(spotifyPath + 'callback?code=spotify-test-code&state=' + 'a'.repeat(48))).headers.get('Location'), '/?spotify=expired');
    assert.equal(spotifyTokenCalls, tokenCalls);
  }
  const tokenCalls = spotifyTokenCalls;
  const returns = await Promise.all([spotifyRequest(callback), spotifyRequest(callback)]);
  assert.deepEqual(returns.map(response => response.headers.get('Location')).sort(), ['/?spotify=' + result, '/?spotify=expired'].sort());
  assert.equal(spotifyTokenCalls, tokenCalls + 1);
}

assert.equal((await spotifyRequest(spotifyPath + 'connect', { input: {}, identity: {} })).status, 401);
spotifyPlaybackStatus = 403;
await connectSpotify({ checkState: true, result: 'access' });
assert.equal((await (await spotifyRequest('/api/profile')).json()).profile.spotifyConnected, false);
spotifyPlaybackStatus = 204;
await connectSpotify();
spotifyPlaybackStatus = 200;
const viewing = { access: host.access, identity: {} };
assert.deepEqual(await (await spotifyRequest(listeningPath, viewing)).json(), { track: manualTrack });
const disconnect = () => spotifyRequest(spotifyPath + 'disconnect', { input: {} });
assert.equal((await disconnect()).status, 200);
spotifyPrivate = false;
await connectSpotify();
assert.equal((await (await spotifyRequest('/api/profile')).json()).profile.spotifyConnected, true);
const dbSpotify = await env.DB.prepare('SELECT credentials FROM spotify_connections WHERE account_id = ?').bind('test-account').first();
assert(!dbSpotify.credentials.includes('spotify-test-'));
const liveTrack = (await (await spotifyRequest(listeningPath, viewing)).json()).track;
assert(liveTrack.live);
assert.equal(liveTrack.position, 45_000);
assert.equal(liveTrack.duration, 180_000);
assert.equal(liveTrack.artist, 'Night Signal');
assert.equal(spotifyRefreshes, 1);
assert(!JSON.stringify(liveTrack).includes('spotify-test-'));
await request('/api/profile', songProfile, null, 200, plainBlair);
assert.deepEqual(await (await spotifyRequest(listeningPath, viewing)).json(), { track: null });
await request('/api/profile', { ...songProfile, shareActivity: true }, null, 200, plainBlair);
assert.equal((await disconnect()).status, 200);
assert.deepEqual(await (await spotifyRequest(listeningPath, viewing)).json(), { track: manualTrack });
await request('/api/profile', { ...profile, spotifyTrack: '' }, null, 200, plainBlair);
assert.deepEqual(await request(listeningPath, null, host.access), { track: null });
delete env.DUO_SPOTIFY_CLIENT_ID;
delete env.DUO_SPOTIFY_REDIRECT_URI;

const html = '<section class="card"><h2>Blair’s corner</h2></section>';
const css = '.card { color: #faa; }';
const style = { accent: '#9bd5ff', surface: '#242e42', avatar: 'circle', banner: 'none', layout: 'center', customEnabled: true, customHeight: 900, html, css };
const ownDesign = (await request('/api/profile', { ...profile, design: style }, null, 200, plainBlair)).profile.design;
assert.equal(ownDesign.avatar, 'circle');
assert.equal(ownDesign.customHeight, 420);
assert.equal(ownDesign.html, html);
const designedPerson = (await request(roomPath, null, host.access)).members.find(person => person.id === blair.memberId);
assert.equal(designedPerson.design.accent, style.accent);
assert.equal(designedPerson.design.customEnabled, true);
assert(!Object.hasOwn(designedPerson.design, 'html'));
const profileCodePath = roomPath + '/profile-code?member=' + blair.memberId;
await request(profileCodePath, null, null, 401);
assert.deepEqual(await request(profileCodePath, null, host.access), { code: { html, css } });
assert.deepEqual(await request('/api/rooms/' + otherRoom.id + '/profile-code?member=' + blair.memberId, null, otherRoom.access, 200, moderator), { code: null });
const savedDraft = (await request('/api/profile', { ...profile, design: { ...style, customEnabled: false } }, null, 200, plainBlair)).profile.design;
assert.equal(savedDraft.html, html);
assert.deepEqual(await request(profileCodePath, null, host.access), { code: null });
await request('/api/profile', { ...profile, design: null }, null, 200, plainBlair);
const profileCanvas = await app.fetch(new Request('http://127.0.0.1/profile-canvas'), env, context);
assert.equal(profileCanvas.status, 200);
assert.match(profileCanvas.headers.get('Content-Security-Policy'), /default-src 'none'/);
assert.match(profileCanvas.headers.get('Content-Security-Policy'), /form-action 'none'/);

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/a9xkAAAAASUVORK5CYII=';
const details = [{ label: 'Interests', value: 'Puzzle games' }, { label: 'Languages', value: 'English and Dutch' }];
await request('/api/profile', { ...profile, avatarImage: 'data:image/svg+xml;base64,PGI+', details }, null, 400, plainBlair);
await request('/api/profile', { ...profile, details: Array(6).fill(details[0]) }, null, 400, plainBlair);
const illustrated = (await request('/api/profile', { ...profile, avatarImage: png, bannerImage: png, details }, null, 200, plainBlair)).profile;
assert.equal(objects.size, 2);
assert.deepEqual(illustrated.details, details);

function media(path, identity = {}) {
  return app.fetch(new Request(`http://127.0.0.1${path}`, { headers: identity }), env, context);
}

const cameronIdentity = { 'oai-authenticated-user-id': 'cameron-user' };
await request(roomPath, null, cameron.access, 409, cameronIdentity);
await request('/api/profile/username', { username: 'cameron' }, null, 200, cameronIdentity);
await request(roomPath, null, cameron.access, 200, cameronIdentity);
identities.set(cameron.access, cameronIdentity);
assert.equal((await media(illustrated.avatar, { 'oai-authenticated-user-id': 'nonmember' })).status, 404);
assert.equal((await media(illustrated.avatar)).status, 404);
const pictureResponse = await media(illustrated.avatar, cameronIdentity);
assert.equal(pictureResponse.status, 200);
assert.equal(pictureResponse.headers.get('Content-Type'), 'image/png');
assert((await pictureResponse.arrayBuffer()).byteLength > 0);
assert.equal((await media(illustrated.banner, plainBlair)).status, 200);
const restyled = (await request('/api/profile', { ...profile, avatarImage: null }, null, 200, plainBlair)).profile;
assert.equal(restyled.avatar, '');
assert.equal(restyled.banner, illustrated.banner);
assert.deepEqual(restyled.details, details);
assert.equal((await media(illustrated.avatar, cameronIdentity)).status, 404);
await Promise.all(jobs);
assert.equal(objects.size, 1);

const animatedGif = Buffer.from([
  '47494638396101000100800000', '9969e1aaf2d5', '21ff0b4e45545343415045322e300301000000',
  '21f90400140000002c0000000001000100000202440100', '21f90400140000002c00000000010001000002024c0100', '3b',
].join(''), 'hex');
const gif = bytes => `data:image/gif;base64,${bytes.toString('base64')}`;
const wideGif = Buffer.from(animatedGif);
wideGif.writeUInt16LE(4097, 6);
await request('/api/profile', { ...profile, bannerImage: gif(wideGif) }, null, 400, plainBlair);
await request('/api/profile', { ...profile, avatarImage: png.replace('image/png', 'image/gif') }, null, 400, plainBlair);
const animations = (await request('/api/profile', { ...profile, avatarImage: gif(animatedGif), bannerImage: gif(animatedGif) }, null, 200, plainBlair)).profile;
for (const path of [animations.avatar, animations.banner]) {
  const image = await media(path, cameronIdentity);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('Content-Type'), 'image/gif');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), animatedGif);
}

const customization = { title: 'The Puzzle Room', description: 'A space for puzzles and games.', accent: 3, iconImage: png };
await request(`${roomPath}/settings`, customization, cameron.access, 403);
const updatedRoom = await request(`${roomPath}/settings`, { ...customization, iconImage: gif(animatedGif) }, blair.access, 200, moderator);
assert.equal(updatedRoom.description, customization.description);
assert.equal(updatedRoom.accent, 3);
const roomAnimation = await media(updatedRoom.icon, cameronIdentity);
assert.equal(roomAnimation.status, 200);
assert.equal(roomAnimation.headers.get('Content-Type'), 'image/gif');
assert.deepEqual(Buffer.from(await roomAnimation.arrayBuffer()), animatedGif);
assert.equal((await media(updatedRoom.icon, { 'oai-authenticated-user-id': 'nonmember' })).status, 404);
await request(`${roomPath}/channels`, { name: 'Game talk', section: 'Games' }, host.access, 201);
await request(`${roomPath}/channel-group`, { name: 'trivia-club', section: 'Puzzles' }, cameron.access, 403);
await request(`${roomPath}/channel-group`, { name: 'trivia-club', section: 'Puzzles' }, host.access);
const currentRoom = await request(roomPath, null, cameron.access);
assert.equal(currentRoom.title, customization.title);
assert.equal(currentRoom.icon, updatedRoom.icon);
assert.deepEqual(currentRoom.sections, { 'trivia-club': 'Puzzles', 'game-talk': 'Games' });
assert.deepEqual(currentRoom.members.find(person => person.id === blair.memberId).details, details);

await request(`${roomPath}/edit-message`, { messageId: first.id, text: 'Someone else’s update' }, blair.access, 403, moderator);
await request(`${roomPath}/edit-message`, { messageId: first.id, text: 'Welcome to our puzzle room!' }, host.access);
const edited = await request(`${roomPath}?after=${ask.id}&revision=${currentRoom.revision}`, null, cameron.access);
assert.equal(edited.reset, true);
assert.equal(edited.messages[0].text, 'Welcome to our puzzle room!');
assert(edited.messages[0].edited_at >= edited.messages[0].created_at);
const secondDevice = await request('/api/join', { name: 'Blair', invite: host.invite }, null, 201, plainBlair);
identities.set(secondDevice.access, plainBlair);
const mergedPeople = (await request(roomPath, null, cameron.access)).members;
const blairPerson = mergedPeople.find(person => person.id === blair.memberId);
assert.equal(mergedPeople.length, currentRoom.members.length);
assert.equal(mergedPeople.filter(person => person.memberIds.includes(blair.memberId) || person.memberIds.includes(secondDevice.memberId)).length, 1);
assert.deepEqual(blairPerson.memberIds, [blair.memberId, secondDevice.memberId]);
assert.equal(blairPerson.mine, false);
assert(!Object.hasOwn(blairPerson, 'account_id'));
const otherDeviceSelf = (await request(roomPath, null, secondDevice.access)).members.find(person => person.mine);
assert.equal(otherDeviceSelf.id, blair.memberId);
assert(otherDeviceSelf.memberIds.includes(secondDevice.memberId));
await env.DB.prepare('UPDATE members SET last_seen = ? WHERE id = ?').bind(Date.now() - 120000, blair.memberId).run();
assert.equal((await request(roomPath, null, cameron.access)).members.find(person => person.id === blair.memberId).online, true);
await env.DB.prepare('UPDATE members SET last_seen = ? WHERE account_id = ?').bind(Date.now() - 120000, plainBlair['oai-authenticated-user-id']).run();
assert.equal((await request(roomPath, null, cameron.access)).members.find(person => person.id === blair.memberId).online, false);
await request(roomPath, null, blair.access);
assert.equal((await request(roomPath, null, cameron.access)).members.find(person => person.id === blair.memberId).online, true);
const voiceIds = [randomUUID(), randomUUID(), randomUUID()].sort();
const [alexVoice, blairVoice, cameronVoice] = voiceIds;
const voiceState = { after: 0, muted: false, deafened: false };
assert.deepEqual((await request(roomPath, null, host.access)).voiceChannels, [{ name: 'lounge', people: 0 }]);
await request(`${roomPath}/voice-channels`, { name: 'Team talk' }, cameron.access, 403);
assert.deepEqual(await request(`${roomPath}/voice-channels`, { name: 'Team talk' }, host.access, 201), { name: 'team-talk' });
await request(`${roomPath}/join-voice`, { id: alexVoice, channel: 'missing' }, host.access, 404);
await request(`${roomPath}/join-voice`, { id: alexVoice, channel: 'lounge' }, host.access, 201);
await request(`${roomPath}/join-voice`, { id: blairVoice, channel: 'lounge', muted: true }, blair.access, 201);
await request(`${roomPath}/join-voice`, { id: randomUUID(), channel: 'team-talk' }, secondDevice.access, 409);
await request(`${roomPath}/join-voice`, { id: cameronVoice, channel: 'team-talk' }, cameron.access, 201);
assert.deepEqual((await request(roomPath, null, host.access)).voiceChannels, [{ name: 'lounge', people: 2 }, { name: 'team-talk', people: 1 }]);
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const offer = { id: alexVoice, to: blairVoice, kind: 'offer', sdp };
assert.deepEqual(await request(`${roomPath}/voice-signal`, offer, host.access), { sent: true });
assert.deepEqual(await request(`${roomPath}/voice-signal`, offer, host.access), { sent: false });
assert.deepEqual(await request(`${roomPath}/voice-signal`, { ...offer, to: cameronVoice }, host.access), { sent: false });
await request(`${roomPath}/voice-signal`, { ...offer, sdp: sdp + 'm=video 9 UDP/TLS/RTP/SAVPF 111\r\n' }, host.access, 400);
await request(`${roomPath}/voice-state`, { ...voiceState, id: blairVoice }, cameron.access, 410);
const blairCall = await request(`${roomPath}/voice-state`, { ...voiceState, id: blairVoice, deafened: true }, blair.access);
assert.deepEqual(blairCall.peers.map(peer => [peer.id, peer.muted, peer.deafened]), [[alexVoice, 0, 0], [blairVoice, 1, 1]]);
assert.equal(blairCall.signals.length, 1);
assert.equal(blairCall.signals[0].sender, alexVoice);
assert.equal(blairCall.signals[0].sdp, sdp);
await request(`${roomPath}/voice-signal`, { id: blairVoice, to: alexVoice, kind: 'answer', sdp }, blair.access);
assert.equal((await request(`${roomPath}/voice-state`, { ...voiceState, id: alexVoice }, host.access)).signals[0].kind, 'answer');
assert.deepEqual((await request(`${roomPath}/voice-state`, { ...voiceState, id: blairVoice, after: blairCall.signals[0].id }, blair.access)).signals, []);
await request(`${roomPath}/leave-voice`, { id: blairVoice }, blair.access);
assert.deepEqual((await request(`${roomPath}/voice-state`, { ...voiceState, id: alexVoice }, host.access)).peers.map(peer => peer.id), [alexVoice]);
await env.DB.prepare('UPDATE voice_members SET last_seen = ? WHERE id = ?').bind(Date.now() - 31_000, alexVoice).run();
await request(`${roomPath}/voice-state`, { ...voiceState, id: alexVoice }, host.access, 410);
assert.equal((await request(roomPath, null, host.access)).voiceChannels[0].people, 0);
await request(`${roomPath}/leave-voice`, { id: cameronVoice }, cameron.access);
await request(`${roomPath}/edit-message`, { messageId: ask.id, text: '@ChatGPT Start a different trivia game' }, secondDevice.access);
assert.equal(inferenceCount, 1);
assert.equal((await request(roomPath, null, secondDevice.access)).messages.find(message => message.id === ask.id).mine, 1);
await request(`${roomPath}/moderation`, { messageId: first.id, hidden: true }, host.access);
await request(`${roomPath}/edit-message`, { messageId: first.id, text: 'Hidden' }, host.access, 403);

await request(`${roomPath}/messages`, { id: randomUUID(), text: 'Cross-channel reply', channel: 'game-talk', replyTo: ask.id }, cameron.access, 409);
await request(`${roomPath}/messages`, { id: randomUUID(), text: 'Hidden reply', replyTo: first.id }, cameron.access, 409);
const reply = await request(`${roomPath}/messages`, { id: randomUUID(), text: 'Thread marker for everyone', replyTo: ask.id }, cameron.access, 201);
const sharedChat = await request(roomPath, null, host.access);
assert.equal(sharedChat.latest.general, reply.id);
assert.equal(sharedChat.messages.at(-1).reply_to, ask.id);
assert.equal(sharedChat.messages.at(-1).reply_name, 'Blair Arcade');
assert.equal(sharedChat.messages.at(-1).reply_text, '@ChatGPT Start a different trivia game');
assert.deepEqual((await request(`${roomPath}/search?q=THREAD%20marker`, null, host.access)).messages.map(item => item.id), [reply.id]);
assert.deepEqual((await request(`${roomPath}/search?q=puzzle%20room`, null, host.access)).messages, []);
assert.equal((await request(`${roomPath}?through=${ask.id}`, null, cameron.access)).messages.at(-1).id, ask.id);

const reaction = { messageId: ask.id, emoji: '💜', active: true };
await request(`${roomPath}/reaction`, reaction, cameron.access);
await request(`${roomPath}/reaction`, reaction, blair.access);
await request(`${roomPath}/reaction`, reaction, secondDevice.access);
const reacted = await request(`${roomPath}?after=${reply.id}&revision=${sharedChat.revision}`, null, blair.access);
assert(reacted.reset);
assert.deepEqual(reacted.messages.find(item => item.id === ask.id).reactions, [{ emoji: '💜', count: 2, mine: 1 }]);
await request(`${roomPath}/reaction`, { ...reaction, active: false }, blair.access);
assert.deepEqual((await request(roomPath, null, blair.access)).messages.find(item => item.id === ask.id).reactions, [{ emoji: '💜', count: 1, mine: 0 }]);

const pin = { messageId: ask.id, active: true };
await request(`${roomPath}/pin`, pin, cameron.access, 403);
await request(`${roomPath}/pin`, pin, host.access);
assert.equal((await request(`${roomPath}/pins?channel=general`, null, cameron.access)).messages[0].id, ask.id);
assert.deepEqual((await request(`${roomPath}/pins?channel=game-talk`, null, cameron.access)).messages, []);
await request(`${roomPath}/delete-message`, { messageId: ask.id }, host.access, 403);
await request(`${roomPath}/delete-message`, { messageId: ask.id }, secondDevice.access);
const afterDelete = await request(roomPath, null, cameron.access);
const removed = afterDelete.messages.find(item => item.id === ask.id);
assert.equal(removed.deleted, 1);
assert.equal(removed.text, null);
assert.deepEqual(removed.reactions, []);
assert.equal(afterDelete.messages.find(item => item.id === reply.id).reply_text, null);
assert.deepEqual((await request(`${roomPath}/pins?channel=general`, null, cameron.access)).messages, []);
assert.deepEqual((await request(`${roomPath}/search?q=different%20trivia`, null, cameron.access)).messages, []);
assert.equal((await env.DB.prepare('SELECT text FROM messages WHERE id = ?').bind(ask.id).first()).text, '');

const replace = { version: 0 };
await request(`${roomPath}/replace-invite`, replace, blair.access, 403, moderator);
const newInvite = await request(`${roomPath}/replace-invite`, replace, host.access);
assert.equal(newInvite.inviteVersion, 1);
await request(`${roomPath}/replace-invite`, replace, host.access, 409);
await request('/api/join', { name: 'Guest', invite: host.invite }, null, 404);
const guest = await request('/api/join', { name: 'Guest', invite: newInvite.invite }, null, 201);
assert.equal(guest.id, host.id);
assert.equal((await request(roomPath, null, cameron.access)).inviteVersion, 1);

await request(`${roomPath}/typing`, { channel: 'game-talk', active: true }, secondDevice.access);
await request(`${roomPath}/typing`, { channel: 'game-talk', active: true }, blair.access);
assert.deepEqual((await request(`${roomPath}?channel=game-talk`, null, cameron.access)).typing, ['Blair Arcade']);
assert.deepEqual((await request(roomPath, null, cameron.access)).typing, []);
assert.deepEqual((await request(`${roomPath}?channel=game-talk`, null, blair.access)).typing, []);
await request(`${roomPath}/typing`, { channel: 'general', active: false }, secondDevice.access);
await request(`${roomPath}/typing`, { channel: 'general', active: false }, blair.access);
assert.deepEqual((await request(`${roomPath}?channel=game-talk`, null, cameron.access)).typing, ['Blair Arcade']);

await request(`${roomPath}/typing`, { channel: 'game-talk', active: false }, blair.access);
const photo = { id: randomUUID(), text: '', image: gif(animatedGif), imageAlt: 'Puzzle animation', channel: 'game-talk' };
const imagePost = await request(`${roomPath}/messages`, photo, secondDevice.access, 201);
const storedImages = objects.size;
assert.equal((await request(`${roomPath}/messages`, photo, secondDevice.access, 201)).id, imagePost.id);
assert.equal(objects.size, storedImages);
const imageRoom = await request(`${roomPath}?channel=game-talk`, null, cameron.access);
assert.deepEqual(imageRoom.typing, []);
const sharedImage = imageRoom.messages.find(item => item.id === imagePost.id);
assert.equal(sharedImage.text, '');
assert.equal(sharedImage.image.alt, photo.imageAlt);
const loaded = await media(sharedImage.image.url, cameronIdentity);
assert.equal(loaded.headers.get('Content-Type'), 'image/gif');
assert.deepEqual(Buffer.from(await loaded.arrayBuffer()), animatedGif);
assert.equal((await media(sharedImage.image.url, { 'oai-authenticated-user-id': 'image-outsider' })).status, 404);
assert.equal((await request(`${roomPath}/search?q=puzzle%20animation`, null, cameron.access)).messages[0].id, imagePost.id);
const galleryPath = `${roomPath}/gallery?channel=game-talk`;
assert.deepEqual(await request(galleryPath, null, cameron.access), {
  images: [{ id: imagePost.id, url: sharedImage.image.url, alt: photo.imageAlt }], next: null,
});
assert.deepEqual((await request(`${galleryPath}&before=${imagePost.id}`, null, cameron.access)).images, []);
assert.deepEqual((await request(`${roomPath}/gallery?channel=general`, null, cameron.access)).images, []);
await request(galleryPath, null, otherRoom.access, 401);
assert.deepEqual((await request(`${roomPath}/search?channel=game-talk&kind=images`, null, cameron.access)).messages.map(item => item.id), [imagePost.id]);
assert.deepEqual((await request(`${roomPath}/search?channel=general&kind=images`, null, cameron.access)).messages, []);
const bookmarkPath = `${roomPath}/saved-messages?ids=${first.id},${reply.id},${imagePost.id}`;
assert.deepEqual((await request(bookmarkPath, null, cameron.access)).messages.map(item => item.id).sort((a, b) => a - b), [reply.id, imagePost.id]);
await request(bookmarkPath, null, otherRoom.access, 401);
await request(`${roomPath}/moderation`, { messageId: imagePost.id, hidden: true }, host.access);
assert.deepEqual((await request(galleryPath, null, cameron.access)).images, []);
assert.equal((await media(sharedImage.image.url, cameronIdentity)).status, 404);
assert.deepEqual((await request(bookmarkPath, null, cameron.access)).messages.map(item => item.id), [reply.id]);
await request(`${roomPath}/moderation`, { messageId: imagePost.id, hidden: false }, host.access);
assert.equal((await media(sharedImage.image.url, cameronIdentity)).status, 200);
await request(`${roomPath}/delete-message`, { messageId: imagePost.id }, secondDevice.access);
assert.equal((await media(sharedImage.image.url, cameronIdentity)).status, 404);
await Promise.all(jobs);
assert(!objects.has(sharedImage.image.url.slice(7)));

await request(`${roomPath}/typing`, { active: true }, cameron.access);
assert.deepEqual((await request(roomPath, null, host.access)).typing, ['Cameron']);
await env.DB.prepare('UPDATE members SET typing_until = ? WHERE id = ?').bind(Date.now() - 1, cameron.memberId).run();
assert.deepEqual((await request(roomPath, null, host.access)).typing, []);

const pollInput = { id: randomUUID(), question: 'What shall we play?', options: ['Trivia', 'Word games'], channel: 'game-talk' };
await request(`${roomPath}/polls`, { ...pollInput, options: ['Trivia', 'trivia'] }, guest.access, 400);
const poll = await request(`${roomPath}/polls`, pollInput, guest.access, 201);
assert.deepEqual((await request(`${roomPath}/search?kind=polls`, null, cameron.access)).messages.map(item => item.id), [poll.id]);
assert.equal((await request(`${roomPath}/polls`, pollInput, guest.access, 201)).id, poll.id);
await request(`${roomPath}/edit-message`, { messageId: poll.id, text: 'Different question' }, guest.access, 403);
assert(!(await request(roomPath, null, cameron.access)).messages.some(item => item.id === poll.id));
await request(`${roomPath}/poll-vote`, { messageId: poll.id, option: 4 }, blair.access, 409);
await request(`${roomPath}/poll-vote`, { messageId: poll.id, option: 0 }, blair.access);
await request(`${roomPath}/poll-vote`, { messageId: poll.id, option: 1 }, secondDevice.access);
await request(`${roomPath}/poll-vote`, { messageId: poll.id, option: 1 }, cameron.access);
let pollState = (await request(`${roomPath}?channel=game-talk`, null, blair.access)).messages.find(item => item.id === poll.id).poll;
assert.deepEqual(pollState.options.map(({ count, mine }) => [count, mine]), [[0, false], [2, true]]);
await request(`${roomPath}/poll-vote`, { messageId: poll.id, option: null }, cameron.access);
await request(`${roomPath}/close-poll`, { messageId: poll.id }, cameron.access, 403);
await request(`${roomPath}/close-poll`, { messageId: poll.id }, host.access);
await request(`${roomPath}/poll-vote`, { messageId: poll.id, option: 0 }, cameron.access, 409);
pollState = (await request(`${roomPath}?channel=game-talk`, null, cameron.access)).messages.find(item => item.id === poll.id).poll;
assert.equal(pollState.closed, true);
assert.equal(pollState.options[1].count, 1);
await request(`${roomPath}/delete-message`, { messageId: poll.id }, guest.access);
assert.equal((await env.DB.prepare('SELECT count(*) AS count FROM poll_votes WHERE message_id = ?').bind(poll.id).first()).count, 0);
const focusChannel = 'focus-chat';
await request(`${roomPath}/channels`, { name: focusChannel }, host.access, 201);
const settings = { channel: focusChannel, topic: 'Plan the next game here', slowSeconds: 10 };
await request(`${roomPath}/channel-settings`, settings, cameron.access, 403);
await request(`${roomPath}/channel-settings`, { ...settings, slowSeconds: 11 }, host.access, 400);
await request(`${roomPath}/channel-settings`, { ...settings, channel: 'unknown' }, host.access, 404);
await request(`${roomPath}/channel-settings`, settings, host.access);
assert.deepEqual((await request(`${roomPath}?channel=${focusChannel}`, null, cameron.access)).channelSettings[focusChannel],
  { topic: settings.topic, slowSeconds: settings.slowSeconds });
const focusPost = { id: randomUUID(), channel: focusChannel, text: 'Ready when you are' };
await delay(410);
const posted = await request(`${roomPath}/messages`, focusPost, blair.access, 201);
assert.equal((await request(`${roomPath}/messages`, focusPost, blair.access, 201)).id, posted.id);
const rejected = await request(`${roomPath}/messages`, { ...focusPost, id: randomUUID() }, secondDevice.access, 429);
assert.equal(rejected.code, 'slow_mode');
await request(`${roomPath}/polls`, { ...pollInput, id: randomUUID(), channel: focusChannel }, secondDevice.access, 429);
await request(`${roomPath}/messages`, { ...focusPost, id: randomUUID() }, secondDevice.access, 201, moderator);
await request(`${roomPath}/messages`, { ...focusPost, id: randomUUID() }, cameron.access, 201);
await request(`${roomPath}/channel-settings`, { ...settings, slowSeconds: 0 }, host.access);
assert.equal((await request(roomPath, null, cameron.access)).channelSettings[focusChannel].slowSeconds, 0);

const tag = claimed.profile.username;
const tagged = await request(`${roomPath}/messages`, {
  id: randomUUID(), channel: focusChannel, text: `Are you in, @${tag.toUpperCase()}?`,
}, host.access, 201);
const inbox = `${roomPath}/mentions`;
const mentions = await request(inbox, null, blair.access);
assert.deepEqual(mentions.messages.map(message => [message.id, message.channel]), [[tagged.id, focusChannel]]);
assert.equal(mentions.unread, 1);
assert.equal((await request(`${inbox}?after=${mentions.messages[0].mentionedAt}`, null, blair.access)).unread, 0);
assert.deepEqual((await request(inbox, null, cameron.access)).messages, []);
await request(`${roomPath}/edit-message`, { messageId: tagged.id, text: `name@${tag} @${tag}7` }, host.access);
assert.deepEqual((await request(inbox, null, blair.access)).messages, []);
await request(`${roomPath}/edit-message`, { messageId: tagged.id, text: `(@${tag})` }, host.access);
assert.equal((await request(inbox, null, blair.access)).messages[0].id, tagged.id);
await request(`${roomPath}/moderation`, { messageId: tagged.id, hidden: true }, host.access);
assert.deepEqual((await request(inbox, null, blair.access)).messages, []);

await request('/api/profile/status', { status: 'Away for dinner', minutes: 60 }, null, 401);
await request('/api/profile/status', { status: 'Away for dinner', minutes: 1 }, null, 400, plainBlair);
assert.equal((await request('/api/profile/status', { status: 'Away for dinner', minutes: 60 }, null, 200, plainBlair)).status, 'Away for dinner');
assert.equal((await request(roomPath, null, cameron.access)).members.find(person => person.id === blair.memberId).status, 'Away for dinner');
await env.DB.prepare('UPDATE profiles SET status_until = ? WHERE account_id = ?').bind(Date.now() - 1, plainBlair['oai-authenticated-user-id']).run();
assert.equal((await request('/api/profile', null, null, 200, plainBlair)).profile.status, '');
assert.equal((await request(roomPath, null, cameron.access)).members.find(person => person.id === blair.memberId).status, '');

const boardPath = `${roomPath}/board`;
const eventInput = { id: randomUUID(), kind: 'event', title: 'Friday game night', body: 'Bring your game ideas', startsAt: Date.now() + 3600000, duration: 60, location: 'Lounge' };
await request(boardPath, eventInput, host.access);
await request(boardPath, eventInput, host.access);
assert.equal((await request(boardPath, null, cameron.access)).items.length, 1);
await request(`${roomPath}/event-response`, { id: eventInput.id, response: 'going' }, blair.access);
await request(`${roomPath}/event-response`, { id: eventInput.id, response: 'maybe' }, secondDevice.access);
let eventItem = (await request(boardPath, null, blair.access)).items[0];
assert.deepEqual(eventItem.responses.map(response => [response.response, response.mine]), [['maybe', 1]]);
await request(boardPath, { ...eventInput, version: 1, title: 'Changed by someone else' }, cameron.access, 403);
await request(boardPath, { ...eventInput, version: 1, title: 'Friday games' }, host.access);
await request(boardPath, { ...eventInput, version: 1, title: 'Old edit' }, host.access, 409);
await request(`${roomPath}/board-action`, { id: eventInput.id, version: 2, action: 'archived', active: true }, cameron.access, 403);
await request(`${roomPath}/board-action`, { id: eventInput.id, version: 2, action: 'archived', active: true }, host.access);
await request(`${roomPath}/event-response`, { id: eventInput.id, response: 'going' }, cameron.access, 409);
await request(`${roomPath}/board-action`, { id: eventInput.id, version: 3, action: 'archived', active: false }, host.access);
await request(boardPath, null, otherRoom.access, 401);
const taskInput = { id: randomUUID(), kind: 'task', title: 'Choose a game', body: '', assigneeId: blair.memberId };
await request(boardPath, { ...taskInput, assigneeId: otherRoom.memberId }, host.access, 400);
await request(boardPath, taskInput, host.access);
await request(`${roomPath}/board-action`, { id: taskInput.id, version: 1, action: 'completed', active: true }, cameron.access);
await request(`${roomPath}/board-action`, { id: taskInput.id, version: 1, action: 'completed', active: true }, blair.access, 409);
const announcement = { id: randomUUID(), kind: 'announcement', title: 'Welcome', body: 'Our room news goes here.' };
await request(boardPath, announcement, cameron.access, 403);
await request(boardPath, announcement, host.access);
const boardItems = (await request(boardPath, null, blair.access)).items;
assert.equal(boardItems.find(item => item.id === taskInput.id).completed, 1);
assert.equal(boardItems.find(item => item.id === announcement.id).title, 'Welcome');
assert(!Object.hasOwn(boardItems[0], 'owner_actor'));

const plansPath = `${roomPath}/plans`;
const scheduled = { id: randomUUID(), kind: 'message', channel: focusChannel, dueAt: Date.now() + 120000, text: 'See you at the event.' };
await request(plansPath, scheduled, blair.access);
await request(plansPath, scheduled, secondDevice.access);
assert.equal((await request(plansPath, null, secondDevice.access)).items.length, 1);
assert.equal((await request(plansPath, null, cameron.access)).items.length, 0);
await request(`${roomPath}/plan-action`, { id: scheduled.id }, cameron.access, 409);
await env.DB.prepare('UPDATE room_queue SET due_at = ? WHERE id = ?').bind(Date.now() - 1, scheduled.id).run();
await request(`${roomPath}?channel=${focusChannel}`, null, host.access);
await request(`${roomPath}?channel=${focusChannel}`, null, cameron.access);
assert.equal((await env.DB.prepare('SELECT count(*) AS count FROM messages WHERE request_id = ?').bind(scheduled.id).first()).count, 1);
assert.equal((await request(plansPath, null, blair.access)).items[0].state, 'sent');
const canceledPlan = { ...scheduled, id: randomUUID(), dueAt: Date.now() + 120000, text: 'Canceled scheduled message' };
await request(plansPath, canceledPlan, blair.access);
await request(`${roomPath}/plan-action`, { id: canceledPlan.id }, secondDevice.access);
await env.DB.prepare('UPDATE room_queue SET due_at = ? WHERE id = ?').bind(Date.now() - 1, canceledPlan.id).run();
await request(roomPath, null, host.access);
assert.equal((await env.DB.prepare('SELECT count(*) AS count FROM messages WHERE request_id = ?').bind(canceledPlan.id).first()).count, 0);
await request(`${roomPath}/channel-settings`, { ...settings, slowSeconds: 10 }, host.access);
const delayed = { ...scheduled, id: randomUUID(), dueAt: Date.now() + 120000 };
await request(plansPath, delayed, blair.access);
await env.DB.prepare('UPDATE room_queue SET due_at = ? WHERE id = ?').bind(Date.now() - 1, delayed.id).run();
await request(roomPath, null, host.access);
assert.equal((await env.DB.prepare('SELECT state FROM room_queue WHERE id = ?').bind(delayed.id).first()).state, 'pending');
await env.DB.prepare('UPDATE messages SET created_at = ? WHERE room_id = ? AND channel = ? AND kind = ?').bind(Date.now() - 11000, host.id, focusChannel, 'person').run();
await request(roomPath, null, host.access);
assert.equal((await env.DB.prepare('SELECT state FROM room_queue WHERE id = ?').bind(delayed.id).first()).state, 'sent');
await request(plansPath, { id: randomUUID(), kind: 'reminder', channel: 'general', messageId: first.id, text: 'Hidden source', dueAt: Date.now() + 120000 }, blair.access, 409);
const reminder = { id: randomUUID(), kind: 'reminder', channel: 'general', messageId: reply.id, text: 'Check this later', dueAt: Date.now() + 120000 };
await request(plansPath, reminder, blair.access);
await request(`${roomPath}/moderation`, { messageId: reply.id, hidden: true }, host.access);
assert.equal((await request(plansPath, null, secondDevice.access)).items.find(item => item.id === reminder.id).text, 'Message unavailable');
const socialA = namedAccount('social-account-a');
const socialB = namedAccount('social-account-b');
const socialC = namedAccount('social-account-c');
const socialProfiles = [];
for (const [identity, username] of [[socialA, 'juniper'], [socialB, 'river'], [socialC, 'sage']]) {
  socialProfiles.push((await request('/api/profile/username', { username }, null, 200, identity)).profile);
}
const [usernameA, usernameB, usernameC] = socialProfiles.map(p => p.username);
const socialPicture = (await request('/api/profile', { ...profile, avatarImage: png }, null, 200, socialA)).profile.avatar;
assert.equal((await media(socialPicture, socialB)).status, 404);
const socialReq = (path, input, identity = socialA, status = 200) => request(`/api/social${path}`, input, null, status, identity);
await request('/api/social', null, null, 401);
await socialReq('/friends', { username: usernameA }, socialA, 400);
await socialReq('/friends', { username: 'missing#1234' }, socialA, 404);
await socialReq('/direct', { username: usernameB }, socialA, 403);
await socialReq('/friends', { username: usernameB });
await socialReq('/friends', { username: usernameB });
assert.equal((await socialReq('', null)).friends.length, 1);
assert.equal((await socialReq('', null, socialB)).friends[0].outgoing, false);
await socialReq('/friend-action', { username: usernameB, action: 'accept' }, socialA, 409);
await socialReq('/friend-action', { username: usernameA, action: 'accept' }, socialB);
assert.equal((await socialReq('', null)).friends[0].state, 'accepted');
assert.equal((await media(socialPicture, socialB)).status, 200);
const direct = await socialReq('/direct', { username: usernameB });
assert.equal((await socialReq('/direct', { username: usernameA }, socialB)).id, direct.id);
const directPath = `/direct/${direct.id}`;
await socialReq(directPath, null, socialC, 404);
const directText = { id: randomUUID(), text: 'A **private** hello.' };
const directMessage = await socialReq(`${directPath}/messages`, directText);
assert.equal((await socialReq(`${directPath}/messages`, directText)).id, directMessage.id);
assert.equal((await socialReq('', null, socialB)).threads[0].unread, 1);
const privateHistory = await socialReq(directPath, null, socialB);
assert.equal(privateHistory.messages[0].text, directText.text);
assert.equal(privateHistory.messages[0].mine, 0);
assert(!JSON.stringify(privateHistory).includes('social-account-'));
await socialReq(`${directPath}/edit`, { id: directMessage.id, text: 'Stolen edit' }, socialB, 404);
await socialReq(`${directPath}/delete`, { id: directMessage.id }, socialB, 404);
await socialReq(`${directPath}/edit`, { id: directMessage.id, text: 'Updated hello' });
assert.equal((await socialReq(directPath, null, socialB)).messages[0].text, 'Updated hello');
await socialReq(`${directPath}/read`, { through: directMessage.id }, socialB);
assert.equal((await socialReq('', null, socialB)).threads[0].unread, 0);
await socialReq('/friend-action', { username: usernameB, action: 'block' });
assert.equal((await media(socialPicture, socialB)).status, 404);
assert.equal((await socialReq('', null)).friends.length, 0);
assert.equal((await socialReq('', null)).blocked[0].username, usernameB);
await socialReq('/friends', { username: usernameA }, socialB, 403);
await socialReq(`${directPath}/messages`, { id: randomUUID(), text: 'Blocked' }, socialB, 403);
assert.equal((await socialReq(directPath, null, socialB)).canSend, false);
await socialReq('/friend-action', { username: usernameB, action: 'unblock' });
await socialReq('/direct', { username: usernameB }, socialA, 403);
await socialReq('/friends', { username: usernameB });
assert.equal((await socialReq('/friends', { username: usernameA }, socialB)).state, 'accepted');
await socialReq('/friend-action', { username: usernameB, action: 'remove' });
assert.equal((await socialReq(directPath, null, socialB)).canSend, false);
await socialReq(`${directPath}/delete`, { id: directMessage.id });
const deletedDirect = (await socialReq(directPath, null, socialB)).messages[0];
assert.equal(deletedDirect.deleted, 1);
assert.equal(deletedDirect.text, null);
await socialReq('/friends', { username: usernameC });
await socialReq('/friend-action', { username: usernameA, action: 'cancel' }, socialC);
assert.equal((await socialReq('', null)).friends.length, 1);
await socialReq('/friend-action', { username: usernameA, action: 'decline' }, socialC);
assert.equal((await socialReq('', null)).friends.length, 0);

const banHost = await request('/api/rooms', { name: 'Juniper', title: 'Moderation checks' }, null, 201, socialA);
const banGuest = await request('/api/join', { name: 'River', invite: banHost.invite }, null, 201, socialB);
const banGuestDevice = await request('/api/join', { name: 'River tablet', invite: banHost.invite }, null, 201, socialB);
identities.set(banHost.access, socialA);
identities.set(banGuest.access, socialB);
identities.set(banGuestDevice.access, socialB);
const banPath = `/api/rooms/${banHost.id}`;
assert.equal((await media(socialPicture, socialB)).status, 200);
await request(`${banPath}/bans`, null, banGuest.access, 403);
await request(`${banPath}/ban`, { memberId: banHost.memberId, banned: true }, banGuest.access, 403);
await request(`${banPath}/ban`, { memberId: banHost.memberId, banned: true }, banHost.access, 403);
const futureBanned = { id: randomUUID(), kind: 'message', text: 'Must never send', dueAt: Date.now() + 120000 };
await request(`${banPath}/plans`, futureBanned, banGuest.access);
await request(`${banPath}/join-voice`, { id: randomUUID(), channel: 'lounge' }, banGuest.access, 201);
await request(`${banPath}/ban`, { memberId: banGuest.memberId, banned: true, reason: 'Test moderation' }, banHost.access);
const banResponse = await request(banPath, null, banGuest.access, 403);
assert.equal(banResponse.code, 'room_banned');
assert.equal((await media(socialPicture, socialB)).status, 404);
await request(banPath, null, banGuestDevice.access, 403);
await request(`${banPath}/messages`, { id: randomUUID(), text: 'Cannot post' }, banGuestDevice.access, 403);
await request('/api/join', { name: 'New session', invite: banHost.invite }, null, 403, socialB);
assert.equal((await env.DB.prepare('SELECT count(*) AS count FROM voice_members WHERE room_id = ?').bind(banHost.id).first()).count, 0);
assert.equal((await env.DB.prepare('SELECT state FROM room_queue WHERE id = ?').bind(futureBanned.id).first()).state, 'canceled');
assert.equal((await request(banPath, null, banHost.access)).members.length, 1);
assert.equal((await request(`${banPath}/bans`, null, banHost.access)).bans[0].reason, 'Test moderation');
await request(`${banPath}/ban`, { memberId: banGuest.memberId, banned: false }, banHost.access);
await request(banPath, null, banGuestDevice.access);
assert.equal((await request(`${banPath}/bans`, null, banHost.access)).bans.length, 0);
const sameNameIdentity = namedAccount('same-display-name');
await request('/api/profile/username', { username: 'another_blair' }, null, 200, sameNameIdentity);
await request('/api/profile', { ...profile, displayName: 'Blair Arcade' }, null, 200, sameNameIdentity);
const sameNameJoin = await request('/api/join', { name: 'Blair Arcade', invite: banHost.invite }, null, 201, sameNameIdentity);
const distinctPeople = (await request(banPath, null, banHost.access)).members;
assert.equal(distinctPeople.filter(person => person.name === 'Blair Arcade').length, 2);
assert(distinctPeople.some(person => person.memberIds.includes(sameNameJoin.memberId)));
const anonymousOne = await request('/api/join', { name: 'Same guest', invite: banHost.invite }, null, 201);
const anonymousTwo = await request('/api/join', { name: 'Same guest', invite: banHost.invite }, null, 201);
assert.equal((await request(banPath, null, banHost.access)).members.filter(person => person.name === 'Same guest').length, 2);
assert.notEqual(anonymousOne.memberId, anonymousTwo.memberId);
const restoreUser = namedAccount('restore-account');
const restoreHost = namedAccount('restore-host');
await request('/api/profile/username', { username: 'restore_user' }, null, 200, restoreUser);
await request('/api/profile/username', { username: 'restore_host' }, null, 200, restoreHost);
const ownRoom = await request('/api/rooms', { name: 'Restorer', title: 'Own room' }, null, 201, restoreUser);
const guestRoom = await request('/api/rooms', { name: 'Host', title: 'Guest room' }, null, 201, restoreHost);
const guestJoin = await request('/api/join', { name: 'Restorer', invite: guestRoom.invite }, null, 201, restoreUser);
const listed = (await request('/api/my-rooms', null, null, 200, restoreUser)).rooms;
assert.deepEqual(listed.map(room => room.id).sort(), [ownRoom.id, guestRoom.id].sort());
assert.equal(listed.find(room => room.id === ownRoom.id).host, true);
assert.equal(listed.find(room => room.id === guestRoom.id).host, false);
assert(!listed.some(room => Object.hasOwn(room, 'access') || Object.hasOwn(room, 'invite')));
assert.deepEqual((await request('/api/my-rooms', null, null, 200)).rooms, []);
const restored = await request('/api/my-rooms/restore', { roomId: guestRoom.id }, null, 201, restoreUser);
assert.equal(restored.name, 'Restorer');
assert.equal(restored.host, false);
assert.notEqual(restored.access, guestJoin.access);
await request(`/api/rooms/${guestRoom.id}`, null, restored.access, 200, restoreUser);
await request(`/api/rooms/${guestRoom.id}`, null, guestJoin.access, 200, restoreUser);
assert.equal((await request('/api/my-rooms/restore', { roomId: ownRoom.id }, null, 201, restoreUser)).host, true);
await request('/api/my-rooms/restore', { roomId: banHost.id }, null, 404, restoreUser);
await request('/api/my-rooms/restore', { roomId: guestRoom.id }, null, 401);
await request('/api/my-rooms/restore', { roomId: 'not-a-room' }, null, 400, restoreUser);
await request(`/api/rooms/${guestRoom.id}/ban`, { memberId: guestJoin.memberId, banned: true }, guestRoom.access, 200, restoreHost);
assert(!(await request('/api/my-rooms', null, null, 200, restoreUser)).rooms.some(room => room.id === guestRoom.id));
assert.equal((await request('/api/my-rooms/restore', { roomId: guestRoom.id }, null, 403, restoreUser)).code, 'room_banned');
const page = await app.fetch(new Request('http://127.0.0.1/'), env, context);
const etag = page.headers.get('ETag');
assert.equal(page.status, 200);
assert.match(etag, /^"[a-f0-9]{32}"$/);
const unchanged = await app.fetch(new Request('http://127.0.0.1/', { headers: { 'If-None-Match': etag } }), env, context);
assert.equal(unchanged.status, 304);
assert.equal(await unchanged.text(), '');
assert.equal((await app.fetch(new Request('http://127.0.0.1/', { headers: { 'If-None-Match': '"stale"' } }), env, context)).status, 200);
const capHost = namedAccount('cap-host');
await request('/api/profile/username', { username: 'cap_host' }, null, 200, capHost);
const capRoom = await request('/api/rooms', { name: 'Cap host', title: 'Full room' }, null, 201, capHost);
const capGuest = namedAccount('cap-guest');
await request('/api/profile/username', { username: 'cap_guest' }, null, 200, capGuest);
await request('/api/join', { name: 'Cap guest', invite: capRoom.invite }, null, 201, capGuest);
await request('/api/join', { name: 'Cap guest', invite: capRoom.invite }, null, 201, capGuest);
for (let i = 0; i < 98; i++) await request('/api/join', { name: `Guest ${i}`, invite: capRoom.invite }, null, 201);
await request('/api/join', { name: 'One too many', invite: capRoom.invite }, null, 409);
await request('/api/join', { name: 'Cap guest', invite: capRoom.invite }, null, 201, capGuest);
env.DUO_ALLOWED_EMAILS = 'aless@example.test, Tester@Example.test';
assert.equal((await request('/api/profile', null, null, 403)).code, 'not_invited');
assert.equal((await request('/api/profile', null, null, 403, moderator)).code, 'not_invited');
await request('/api/profile', null, null, 200, namedAccount('allowed-tester', 'tester@example.test'));
delete env.DUO_ALLOWED_EMAILS;
await request('/api/profile', null, null, 200, moderator);
console.log('Verified private-site allowlist, shared Spotify tracks, live Spotify permissions and privacy, room restoration, asset revalidation, member limits and presence, and existing chat features.');
