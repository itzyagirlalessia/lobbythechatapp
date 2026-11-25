// Your own profile: username setup, profile editor, status and the sidebar profile card.
import { bindPicture, pictureField } from './pictures.js';
import { saved, state } from './state.js';
import { $, api, closeDialog, dialogForm, element, handleForm, icon, pictureImage, showDialog, toast, updateAvatar } from './ui.js';
import { syncAccountRooms } from './rooms.js';
import { toggleSidebar } from './settings.js';
import { prepareReleaseNotice } from './release-notice.js';
import { refresh, restorePage, social } from './app.js';
import { applyProfileDesign, bindProfileStudio, codeFields, designFields, profileFacts, renderProfileCode } from './profile-studio.js';

export function applyOwnProfile(data) {
  state.admin = data.admin;
  state.signedIn = data.signedIn;
  state.selfProfile = data.profile;
  state.providers = data.providers;
  renderProfile();
  if (state.selfProfile?.username) social.start();
}

const signInPath = '/signin-with-chatgpt?return_to=%2F';
const signOutPath = '/signout-with-chatgpt?return_to=%2F';

export function showAccountMenu() {
  toggleSidebar(false);
  if (!state.signedIn) {
    showDialog('Account', `<div class="account-actions"><a class="button primary" href="${signInPath}" target="_top">Sign in with ChatGPT</a></div>`);
    return;
  }
  showDialog('Account', `<div id="account-identity" class="account-identity"></div>
    <div class="account-actions">
      <button class="button primary" type="button" id="change-account">Change account</button>
      <a class="button outline" href="${signOutPath}" target="_top">Sign out of Lobby</a>
    </div>`);
  const profile = state.selfProfile;
  const name = profile?.displayName || profile?.username || 'Signed in';
  const picture = element('span', 'avatar');
  updateAvatar(picture, name, '', profile?.color, profile?.avatar);
  const labels = element('div');
  labels.append(element('strong', '', name));
  if (profile?.username && profile.username !== name) labels.append(element('small', '', profile.username));
  $('account-identity').append(picture, labels);
  $('change-account').addEventListener('click', () => {
    showDialog('Change account', `<p>Choose or add the other account in ChatGPT’s account menu, then come back here and continue. Your other ChatGPT session can stay signed in.</p>
      <div class="account-actions">
        <a class="button outline" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Open ChatGPT</a>
        <a class="button primary" href="${signInPath}" target="_top">Continue with ChatGPT</a>
      </div>`);
  });
}

const usernameField = `<label class="field">Username<input name="username" pattern="[A-Za-z0-9_]{3,24}" maxlength="24" placeholder="e.g. moonlight" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="username-help" required><small id="username-help">Choose 3–24 letters, numbers, or underscores. Lobby adds an available four-digit tag.</small></label>`;

export function showUsernameSetup() {
  if (state.usernameSetup) return;
  state.usernameSetup = true;
  clearTimeout(state.refreshTimer);
  toggleSidebar(false);
  showDialog('Choose your username', dialogForm(usernameField, 'Continue', 'Set the username people will see on your profile.'));
  $('close-dialog').hidden = true;
  $('dialog-body').querySelector('[data-dismiss]').remove();
  handleForm(async data => {
    const profile = await api('/profile/username', { input: { username: data.get('username') } });
    applyOwnProfile(profile);
    state.usernameSetup = false;
    $('close-dialog').hidden = false;
    closeDialog();
    if (state.session && !location.hash) void refresh(state.session);
    else restorePage();
    void syncAccountRooms();
    prepareReleaseNotice(profile);
  });
}

export const accentOptions = '<option value="0">Lavender</option><option value="1">Mint</option><option value="2">Rose</option><option value="3">Amber</option><option value="4">Blue</option>';

export function paintCover(cover, accent, source) {
  cover.dataset.color = accent;
  cover.replaceChildren();
  if (source) cover.append(pictureImage(source, 'profile-banner'));
}

function profileDetailsEditor(form, details) {
  const list = form.querySelector('#profile-details-edit');
  const add = form.querySelector('#add-profile-detail');
  function addRow(detail = {}) {
    const row = element('div', 'profile-detail-row');
    row.innerHTML = `<input aria-label="Detail label" placeholder="e.g. Interests" maxlength="25" required data-label>
      <input aria-label="Detail value" placeholder="What to show" maxlength="100" required data-value>
      <button type="button" class="icon-button" title="Remove detail" aria-label="Remove detail">${icon('close')}</button>`;
    row.querySelector('[data-label]').value = detail.label || '';
    row.querySelector('[data-value]').value = detail.value || '';
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      add.disabled = false;
      add.focus();
      form.dispatchEvent(new Event('input'));
    });
    list.append(row);
    add.disabled = list.childElementCount >= 5;
    return row;
  }
  details.forEach(addRow);
  add.addEventListener('click', () => addRow().querySelector('input').focus());
  return () => Array.from(list.children, row => ({ label: row.querySelector('[data-label]').value, value: row.querySelector('[data-value]').value }));
}

export async function showProfileEditor() {
  showDialog('Edit your profile', '<p id="profile-loading">Loading your profile…</p>');
  const marker = $('profile-loading');
  try {
    const data = await api('/profile');
    if (!marker.isConnected) return;
    if (!data.signedIn) {
      showDialog('Edit your profile', `<p>Sign in to save a profile you can use across your rooms.</p><div class="dialog-actions below"><a class="button primary" href="${signInPath}" target="_top">Sign in</a></div>`);
      return;
    }
    applyOwnProfile(data);
    if (!state.selfProfile.username) {
      showUsernameSetup();
      return;
    }
  } catch (error) {
    if (marker.isConnected) marker.textContent = error.message;
    return;
  }

  const gameHint = state.providers.steam ? 'Use your own public Steam profile for live game status.' : 'Steam profile link. Live game status needs site setup.';
  const musicHint = state.providers.lastfm ? 'Use your own Last.fm profile for live track updates.' : 'Last.fm profile link. Live track updates need site setup.';
  const liveSpotify = state.providers.spotify || state.selfProfile.spotifyConnected ? `
    <div class="profile-spotify-live">
      <p class="profile-field-hint">Connect your Spotify account to show your current track and progress when someone in the room opens your profile while you’re online and sharing activity.</p>
      <button type="button" class="button outline" id="connect-spotify" hidden>Save and connect Spotify</button>
      <button type="button" class="button outline" id="disconnect-spotify" hidden>Disconnect Spotify</button>
    </div>` : '';
  const tabs = [['basics', 'Profile'], ['style', 'Appearance'], ['code', 'HTML / CSS'], ['activity', 'Activity']];
  const fields = `
    <div class="profile-studio">
    <aside class="studio-preview" aria-label="Live profile preview">
      <span class="studio-preview-label">Live preview</span>
      <div class="studio-card" id="studio-card">
        <header class="member-popup-header"><div class="profile-cover" id="preview-cover"></div>
          <span class="avatar online" id="preview-avatar"></span>
          <h3 class="member-popup-name" id="preview-name"></h3>
          <p class="member-popup-username" id="preview-username" hidden></p>
        </header>
        <div class="member-popup-details" id="preview-details"><p class="member-bio" id="preview-bio" hidden></p>
          <div id="preview-facts" hidden></div><div class="profile-code-container" id="preview-code" hidden></div>
        </div>
      </div>
    </aside>
    <div class="studio-settings">
    <div class="studio-tabs" role="tablist" aria-label="Profile Studio">
      ${tabs.map(([key, name], index) => `<button id="studio-tab-${key}" type="button" role="tab" aria-controls="studio-panel-${key}" aria-selected="${index === 0}">${name}</button>`).join('')}
    </div>
    <div class="studio-panel" id="studio-panel-basics" role="tabpanel" aria-labelledby="studio-tab-basics">
    <fieldset class="profile-section"><legend>Pictures</legend>
      ${pictureField('Profile picture', 'avatar', 'Cropped to a square')}
      ${pictureField('Profile banner', 'banner', 'Cropped to a wide image')}
    </fieldset>
    <div class="profile-grid">
      <label class="field">Display name<input name="displayName" maxlength="32" autocomplete="nickname" required></label>
      <label class="field">Profile accent<select name="color">${accentOptions}</select></label>
    </div>
    ${usernameField}
    <label class="field">About me<textarea name="bio" rows="2" maxlength="160" placeholder="Write a short bio"></textarea></label>
    <fieldset class="profile-section"><legend>Profile details</legend>
      <p class="profile-field-hint">Add up to five things you want room members to know.</p><div id="profile-details-edit"></div>
      <button type="button" class="button outline add-detail" id="add-profile-detail">${icon('plus')} Add detail</button>
    </fieldset>
    </div>
    <div class="studio-panel" id="studio-panel-style" role="tabpanel" aria-labelledby="studio-tab-style" hidden>${designFields()}</div>
    <div class="studio-panel" id="studio-panel-code" role="tabpanel" aria-labelledby="studio-tab-code" hidden>${codeFields}</div>
    <div class="studio-panel" id="studio-panel-activity" role="tabpanel" aria-labelledby="studio-tab-activity" hidden>
    <fieldset class="profile-section"><legend>Activity</legend>
      <div class="profile-grid">
        <label class="field">Playing<input name="game" maxlength="80" placeholder="e.g. Minecraft" autocomplete="off"></label>
        <label class="field">Listening to<input name="music" maxlength="100" placeholder="Song and artist" autocomplete="off"></label>
      </div>
    </fieldset>
    <fieldset class="profile-section"><legend>Spotify listening card</legend>
      <label class="field">Spotify track link<input type="url" name="spotifyTrack" maxlength="500" placeholder="https://open.spotify.com/track/…" autocomplete="off"><small>In Spotify, open a song and choose Share, then Copy song link. Clear the link to remove the shared track.</small></label>
      <label class="field">Artist (optional)<input name="spotifyArtist" maxlength="120" placeholder="Artist name" autocomplete="off"></label>
      ${liveSpotify}
    </fieldset>
    <fieldset class="profile-section"><legend>Connected profiles</legend>
      <label class="field">Steam<input name="steam" maxlength="500" placeholder="Steam profile link or SteamID64" autocomplete="off"><small>${gameHint}</small></label>
      <label class="field">Last.fm<input name="lastfm" maxlength="500" placeholder="Last.fm username or profile link" autocomplete="off"><small>${musicHint}</small></label>
      <label class="field">Spotify<input name="spotify" maxlength="500" placeholder="Spotify profile link" autocomplete="off"><small>Profile link</small></label>
    </fieldset>
    <label class="profile-share"><input name="shareActivity" type="checkbox"><span><strong>Share activity and connected profiles</strong><small>People in your rooms can see your game, music and profile links. Enabled services can check your activity while you’re online in a room.</small></span></label>
    </div></div></div>`;
  showDialog('Profile Studio', dialogForm(fields, 'Save profile'));
  const form = $('dialog-body').querySelector('form');
  const originalUsername = state.selfProfile.username;
  const originalBase = originalUsername.split('#')[0];
  const values = { ...state.selfProfile.connections, displayName: state.selfProfile.displayName || state.session?.room.name || saved.name || originalBase, username: originalBase, bio: state.selfProfile.bio, color: state.selfProfile.color, game: state.selfProfile.game, music: state.selfProfile.music,
    spotifyTrack: state.selfProfile.spotifyTrack || '', spotifyArtist: state.selfProfile.spotifyArtist || '' };
  for (const [field, value] of Object.entries(values)) form.elements[field].value = value;
  form.elements.shareActivity.checked = state.selfProfile.shareActivity;
  if (state.selfProfile.usernameAssigned) {
    form.elements.username.readOnly = true;
    form.querySelector('#username-help').textContent = `${originalUsername} is assigned to your account.`;
  }
  let avatarSource = state.selfProfile.avatar;
  let coverSource = state.selfProfile.banner;
  const card = form.querySelector('#studio-card');
  const avatarPreview = form.querySelector('#preview-avatar');
  const coverPreview = form.querySelector('#preview-cover');
  const bioPreview = form.querySelector('#preview-bio');
  const factsPreview = form.querySelector('#preview-facts');
  const codePreview = form.querySelector('#preview-code');
  const readDetails = profileDetailsEditor(form, state.selfProfile.details);
  const readDesign = bindProfileStudio(form, state.selfProfile.design);
  let previousName, previousColor, previousAvatar, previousCover;
  const updatePreview = () => {
    const name = form.elements.displayName.value.trim() || 'Your profile';
    const color = form.elements.color.value;
    if (name !== previousName || color !== previousColor || avatarSource !== previousAvatar) updateAvatar(avatarPreview, name, '', color, avatarSource);
    if (color !== previousColor || coverSource !== previousCover) paintCover(coverPreview, color, coverSource);
    previousName = name;
    previousColor = color;
    previousAvatar = avatarSource;
    previousCover = coverSource;
    form.querySelector('#preview-name').textContent = name;
    const username = form.querySelector('#preview-username');
    const base = form.elements.username.value.trim().toLowerCase();
    username.textContent = base === originalBase ? originalUsername : base;
    username.hidden = !username.textContent;
    bioPreview.textContent = form.elements.bio.value.trim();
    bioPreview.hidden = !bioPreview.textContent;
    const facts = profileFacts(readDetails());
    factsPreview.replaceChildren(facts);
    factsPreview.hidden = !facts.childElementCount;
    const design = readDesign();
    applyProfileDesign(card, design);
    renderProfileCode(codePreview, design);
  };
  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  const readAvatar = bindPicture(form, 'avatar', avatarSource, [256, 256], 180_000, source => { avatarSource = source; updatePreview(); });
  const readBanner = bindPicture(form, 'banner', coverSource, [1080, 360], 600_000, source => { coverSource = source; updatePreview(); });
  updatePreview();
  let connectRequested = false;
  const connectSpotify = form.querySelector('#connect-spotify');
  const disconnectSpotify = form.querySelector('#disconnect-spotify');
  if (connectSpotify && disconnectSpotify) {
    const updateConnection = () => {
      const connected = state.selfProfile.spotifyConnected;
      connectSpotify.hidden = !state.providers.spotify || connected;
      disconnectSpotify.hidden = !connected;
    };
    updateConnection();
    connectSpotify.addEventListener('click', () => {
      if (form.querySelector('[type=submit]').disabled) return;
      connectRequested = true;
      form.requestSubmit();
      connectRequested = false;
    });
    disconnectSpotify.addEventListener('click', async () => {
      disconnectSpotify.disabled = true;
      try {
        await api('/profile/spotify/disconnect', { input: {} });
        state.selfProfile.spotifyConnected = false;
        updateConnection();
        (connectSpotify.hidden ? form.elements.spotifyTrack : connectSpotify).focus();
        if (state.session) void refresh(state.session);
        toast('Spotify disconnected.');
      } catch (error) {
        toast(error.message);
      } finally {
        disconnectSpotify.disabled = false;
      }
    });
  }
  form.elements.displayName.focus();
  handleForm(async values => {
    const connect = connectRequested;
    if (connect && !values.has('shareActivity')) throw new Error('Turn on activity sharing before connecting Spotify.');
    const input = Object.fromEntries(values);
    if (input.username.trim().toLowerCase() === originalBase) delete input.username;
    input.color = Number(input.color);
    input.shareActivity = values.has('shareActivity');
    input.details = readDetails();
    input.design = readDesign();
    [input.avatarImage, input.bannerImage] = await Promise.all([readAvatar(), readBanner()]);
    applyOwnProfile(await api('/profile', { input }));
    if (connect) {
      const { url } = await api('/profile/spotify/connect', { input: {} });
      if (form.isConnected) location.assign(url);
      return;
    }
    if (form.isConnected) closeDialog();
    toast('Profile saved.');
    if (state.session) {
      state.session.nextActivityRefresh = 0;
      void refresh(state.session);
    }
  });
}

export function showStatusForm() {
  toggleSidebar(false);
  if (!state.selfProfile?.username) {
    void showProfileEditor();
    return;
  }
  const fields = `<label class="field">Status<input name="status" maxlength="80" placeholder="e.g. Away for dinner"></label>
    <label class="field">Clear after<select name="minutes"><option value="0">Keep until I clear it</option><option value="60">1 hour</option>
    <option value="240">4 hours</option><option value="1440">1 day</option></select></label>`;
  showDialog('Set a status', dialogForm(fields, 'Save status', 'Room members can see your status. Leave it blank to clear it.'));
  $('dialog-body').querySelector('form').elements.status.value = state.selfProfile.status ?? '';
  handleForm(async data => {
    const { status } = await api('/profile/status', { input: { status: data.get('status'), minutes: Number(data.get('minutes')) } });
    state.selfProfile.status = status;
    closeDialog();
    toast(status ? 'Status set.' : 'Status cleared.');
    if (state.session) void refresh(state.session);
  });
}

export function renderProfile() {
  const active = state.session?.room;
  const name = state.selfProfile?.displayName || active?.name || saved.name || state.selfProfile?.username?.split('#')[0] || 'Guest';
  const profile = $('profile-avatar');
  updateAvatar(profile, name, active?.memberId, state.selfProfile?.displayName ? state.selfProfile.color : null, state.selfProfile?.avatar);
  $('profile-name').textContent = name;
  const detail = $('profile-detail');
  detail.replaceChildren();
  if (state.admin) {
    detail.innerHTML = icon('shield');
    detail.append('Lobby Admin');
  } else {
    detail.textContent = active ? (active.host ? 'Room host' : 'Room member') : 'My profile';
  }
}
