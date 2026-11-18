// Voice channel list, join and controls dialogs, and the voice dock.
import { state } from './state.js';
import { $, api, closeDialog, dialogForm, element, handleForm, icon, showDialog, toast } from './ui.js';
import { refresh, voice } from './app.js';

function voiceChannelName(name) {
  return name === 'lounge' ? 'Lounge' : name;
}

export function showVoiceChannelForm() {
  if (!state.session?.canManage) return;
  const { room } = state.session;
  showDialog('Create a voice channel', dialogForm(
    '<label class="field">Channel name<input name="name" maxlength="30" placeholder="e.g. game-night" required autocomplete="off"></label>',
    'Create channel',
  ));
  handleForm(async data => {
    const { name } = await api(`/rooms/${room.id}/voice-channels`, { access: room.access, input: { name: data.get('name') } });
    closeDialog();
    if (state.session?.room === room && !state.session.voiceChannels.some(channel => channel.name === name)) {
      state.session.voiceChannels = [...state.session.voiceChannels, { name, people: 0 }];
      renderVoiceChannels();
      void refresh(state.session);
    }
    toast(`${name} created.`);
  });
}

export function renderVoiceChannels() {
  const list = $('voice-channel-list');
  $('add-voice-channel').hidden = !state.session?.canManage;
  const channels = state.session?.voiceChannels ?? [];
  const activeChannel = voice.active && voice.active.room === state.session?.room ? voice.active.channel : '';
  const key = JSON.stringify([channels, activeChannel, state.session?.room.id]);
  if (list.dataset.key === key) return;
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.channel : null;
  list.dataset.key = key;
  list.replaceChildren();
  for (const { name, people } of channels) {
    const item = element('button', 'nav-button channel-button voice-channel');
    item.dataset.channel = name;
    item.innerHTML = icon('speaker');
    item.append(element('span', '', voiceChannelName(name)));
    if (people) item.append(element('small', 'voice-count', people));
    if (name === activeChannel) item.classList.add('voice-active');
    item.setAttribute('aria-label', `${voiceChannelName(name)} voice channel, ${people} joined${name === activeChannel ? ', connected' : ''}`);
    const { room } = state.session;
    item.addEventListener('click', () => showJoinVoice(room, name));
    list.append(item);
    if (name === focused) item.focus();
  }
}

export function showJoinVoice(room, channel) {
  if (voice.active?.room === room && voice.active.channel === channel) {
    showVoiceDetails();
    return;
  }
  showDialog(voiceChannelName(channel), `<p id="voice-join-description"></p><p class="form-error" id="voice-join-error" role="alert" hidden></p>
    <div class="dialog-actions below"><button class="button outline" id="join-muted">Join muted</button><button class="button primary" id="join-voice">Join voice</button></div>`);
  $('voice-join-description').textContent = `Talk with people in ${room.title}. Your browser will ask for microphone access.`;
  const error = $('voice-join-error');
  const join = $('join-voice');
  const muted = $('join-muted');
  for (const button of [join, muted]) button.addEventListener('click', async () => {
    join.disabled = muted.disabled = true;
    error.hidden = true;
    try {
      await voice.join(room, channel, button === muted, () => $('dialog').open && join.isConnected);
      if (join.isConnected) showVoiceDetails();
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally {
      join.disabled = muted.disabled = false;
    }
  });
  join.focus();
}

export function showVoiceDetails() {
  if (!voice.active) return;
  showDialog('Voice controls', `<div class="voice-details"><strong id="voice-detail-title"></strong><p id="voice-detail-status" role="status"></p>
    <ul class="voice-roster" id="voice-roster" aria-label="People in voice"></ul>
    <button class="button outline" id="voice-enable-audio" hidden>Enable audio</button>
    <div class="dialog-actions below"><button class="button outline" id="voice-detail-mute"></button><button class="button outline" id="voice-detail-deafen"></button><button class="button danger" id="voice-detail-leave">Leave voice</button></div></div>`);
  $('voice-detail-mute').addEventListener('click', voice.toggleMute);
  $('voice-detail-deafen').addEventListener('click', voice.toggleDeafen);
  $('voice-detail-leave').addEventListener('click', voice.leave);
  $('voice-enable-audio').addEventListener('click', voice.resumeAudio);
  renderVoiceDock(voice.active);
}

export function renderVoiceDock(call) {
  $('voice-dock').hidden = !call;
  $('voice-quick').hidden = !call;
  renderVoiceChannels();
  if (!call) {
    if ($('voice-roster')) closeDialog();
    return;
  }
  const title = `${voiceChannelName(call.channel)} · ${call.room.title}`;
  $('voice-dock-text').textContent = title;
  $('voice-dock-text').title = title;
  const muted = call.muted || call.deafened;
  const update = (id, pressed, label) => {
    const button = $(id);
    button.setAttribute('aria-pressed', String(pressed));
    button.setAttribute('aria-label', label);
    button.title = label;
    return button;
  };
  const muteLabel = muted ? 'Unmute microphone' : 'Mute microphone';
  const deafenLabel = call.deafened ? 'Undeafen' : 'Deafen';
  update('mute-voice', muted, muteLabel).disabled = call.deafened;
  update('deafen-voice', call.deafened, deafenLabel);
  const roster = $('voice-roster');
  if (!roster) return;
  $('voice-detail-title').textContent = title;
  const peers = [...call.connections.values()];
  const audioBlocked = peers.some(peer => peer.audioBlocked);
  let status = 'Waiting for others to join';
  if (call.networkError) status = 'Reconnecting to voice';
  else if (call.deafened) status = 'Voice audio and microphone muted';
  else if (audioBlocked) status = 'Select Enable audio to hear the channel';
  else if (peers.some(peer => peer.failed || peer.connection.connectionState === 'failed')) status = 'Some audio connections failed. Try leaving and rejoining.';
  else if (peers.some(peer => peer.connection.connectionState !== 'connected')) status = 'Connecting audio';
  else if (peers.length) status = 'Voice connected';
  if ($('voice-detail-status').textContent !== status) $('voice-detail-status').textContent = status;
  $('voice-enable-audio').hidden = !audioBlocked || call.deafened;
  const mute = update('voice-detail-mute', muted, muteLabel);
  mute.disabled = call.deafened;
  mute.textContent = muted ? 'Unmute' : 'Mute';
  update('voice-detail-deafen', call.deafened, deafenLabel).textContent = deafenLabel;
  const lineup = call.peers.length ? call.peers : [{ id: call.id, name: 'You', muted, deafened: call.deafened }];
  const key = JSON.stringify(lineup);
  if (roster.dataset.key === key) return;
  roster.dataset.key = key;
  roster.replaceChildren(...lineup.map(peer => {
    const row = element('li');
    const name = peer.id === call.id && peer.name !== 'You' ? `${peer.name} (you)` : peer.name;
    row.append(element('span', '', name), element('small', '', peer.deafened ? 'Deafened' : peer.muted ? 'Muted' : 'In voice'));
    return row;
  }));
}
