const iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }];

async function localDescription(connection) {
  if (connection.iceGatheringState === 'complete') return connection.localDescription;
  return new Promise(resolve => {
    function finish() {
      clearTimeout(timer);
      connection.removeEventListener('icegatheringstatechange', changed);
      resolve(connection.localDescription);
    }
    function changed() {
      if (connection.iceGatheringState === 'complete') finish();
    }
    const timer = setTimeout(finish, 4500);
    connection.addEventListener('icegatheringstatechange', changed);
    changed();
  });
}

export function createVoiceController(api, render, report) {
  let active = null;
  let joining = false;
  let pageGeneration = 0;
  let departure;

  const request = (call, action, fields = {}, keepalive = false) => api(`/rooms/${call.room.id}/${action}`, {
    access: call.room.access, input: { id: call.id, ...fields }, keepalive,
  });

  function show() {
    render(active);
  }

  function closePeer(entry) {
    entry.connection.close();
    entry.audio.pause();
    entry.audio.srcObject = null;
  }

  async function leave() {
    const call = active;
    if (!call) return departure;
    active = null;
    clearTimeout(call.timer);
    call.stream.getTracks().forEach(track => track.stop());
    call.connections.forEach(closePeer);
    show();
    departure = request(call, 'leave-voice', {}, true).catch(() => {});
    await departure;
  }

  function applyAudio(call) {
    call.stream.getAudioTracks().forEach(track => { track.enabled = !call.muted && !call.deafened; });
    call.connections.forEach(entry => { entry.audio.muted = call.deafened; });
    show();
  }

  async function play(call, entry) {
    if (!entry.audio.srcObject || call.deafened) return;
    try {
      await entry.audio.play();
      entry.audioBlocked = false;
    } catch {
      entry.audioBlocked = true;
    }
    if (active === call) show();
  }

  function peerConnection(call, peer) {
    const existing = call.connections.get(peer.id);
    if (existing) return existing;
    const connection = new RTCPeerConnection({ iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = call.deafened;
    audio.setAttribute('playsinline', '');
    const entry = { connection, audio, audioBlocked: false, failed: false, messages: Promise.resolve() };
    call.connections.set(peer.id, entry);
    connection.addEventListener('track', event => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void play(call, entry);
    });
    connection.addEventListener('connectionstatechange', () => { if (active === call) show(); });
    call.stream.getAudioTracks().forEach(track => connection.addTrack(track, call.stream));
    return entry;
  }

  async function sendDescription(call, peer, entry, kind) {
    const description = kind === 'offer' ? await entry.connection.createOffer() : await entry.connection.createAnswer();
    await entry.connection.setLocalDescription(description);
    const ready = await localDescription(entry.connection);
    if (active === call && call.connections.get(peer.id) === entry && ready) {
      await request(call, 'voice-signal', { to: peer.id, kind, sdp: ready.sdp });
    }
  }

  function process(call, entry, operation) {
    entry.messages = entry.messages.then(operation).catch(() => {
      if (active !== call || entry.connection.connectionState === 'closed') return;
      entry.failed = true;
      show();
    });
  }

  async function poll(call) {
    if (active !== call || call.polling) return;
    call.polling = true;
    clearTimeout(call.timer);
    try {
      const next = await request(call, 'voice-state', { after: call.after, muted: call.muted || call.deafened, deafened: call.deafened });
      if (active !== call) return;
      call.networkError = false;
      call.peers = next.peers;
      const online = new Set(next.peers.map(peer => peer.id));
      for (const [id, entry] of call.connections) if (!online.has(id)) {
        closePeer(entry);
        call.connections.delete(id);
      }
      for (const peer of next.peers) {
        if (peer.id === call.id || call.connections.has(peer.id)) continue;
        const entry = peerConnection(call, peer);
        if (call.id < peer.id) process(call, entry, () => sendDescription(call, peer, entry, 'offer'));
      }
      for (const signal of next.signals) {
        call.after = Math.max(call.after, signal.id);
        const entry = call.connections.get(signal.sender);
        const peer = next.peers.find(person => person.id === signal.sender);
        if (!entry || !peer) continue;
        process(call, entry, async () => {
          if (active !== call || call.connections.get(peer.id) !== entry) return;
          if ((signal.kind === 'offer') !== (peer.id < call.id)) return;
          await entry.connection.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });
          if (signal.kind === 'offer') await sendDescription(call, peer, entry, 'answer');
        });
      }
      show();
    } catch (error) {
      if (active !== call) return;
      if ([401, 410].includes(error.status) || error.code === 'room_banned') {
        void leave();
        report(error.message);
      } else {
        call.networkError = true;
        show();
      }
    } finally {
      call.polling = false;
      if (active === call) call.timer = setTimeout(() => void poll(call), document.hidden ? 2500 : 1150);
    }
  }

  async function join(room, channel, muted, stillOpen) {
    if (joining) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Open Lobby in a browser tab with microphone support.');
    joining = true;
    const generation = pageGeneration;
    const cancelled = () => generation !== pageGeneration || !stillOpen();
    function ensureJoining() {
      if (cancelled()) throw new DOMException('Voice join was canceled.', 'AbortError');
    }
    let stream;
    let call;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      stream.getAudioTracks().forEach(track => { track.enabled = false; });
      ensureJoining();
      await leave();
      ensureJoining();
      call = { room, channel, id: crypto.randomUUID(), stream, muted, deafened: false, after: 0, peers: [], connections: new Map() };
      await request(call, 'join-voice', { channel, muted });
      ensureJoining();
      active = call;
      applyAudio(call);
      void poll(call);
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (call) void request(call, 'leave-voice', {}, true).catch(() => {});
      if (cancelled()) return;
      if (error.name === 'NotAllowedError') throw new Error('Allow microphone access in your browser to join voice.');
      if (error.name === 'NotFoundError') throw new Error('Connect a microphone to join voice.');
      throw error;
    } finally {
      joining = false;
    }
  }

  function toggle(key) {
    if (!active) return;
    active[key] = !active[key];
    applyAudio(active);
    if (key === 'deafened' && !active.deafened) resumeAudio();
    void poll(active);
  }

  function resumeAudio() {
    const call = active;
    if (call) call.connections.forEach(entry => void play(call, entry));
  }

  function disconnect() {
    pageGeneration += 1;
    void leave();
  }

  return { get active() { return active; }, join, leave, disconnect, toggleMute: () => toggle('muted'), toggleDeafen: () => toggle('deafened'), resumeAudio };
}
