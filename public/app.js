'use strict';

(function () {
  const RTC_CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };

  const HOST_ID = 'host';
  const THEME_KEY = 'piik-theme';
  const NAME_KEY = 'piik-name';

  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const stageEl = $('stage');
  const statusEl = $('status');
  const placeholder = $('placeholder');
  const joinPane = $('joinPane');
  const startBtn = $('startBtn');
  const joinBtn = $('joinBtn');
  const nameInput = $('nameInput');
  const passwordInput = $('passwordInput');
  const joinError = $('joinError');
  const playBtn = $('playBtn');
  const sharePanel = $('sharePanel');
  const inviteLink = $('inviteLink');
  const copyBtn = $('copyBtn');
  const copyLabel = $('copyLabel');
  const qrBtn = $('qrBtn');
  const qrBox = $('qrBox');
  const qrImg = $('qrImg');
  const shareBtn = $('shareBtn');
  const micBtn = $('micBtn');
  const stopBtn = $('stopBtn');
  const recBtn = $('recBtn');
  const approvalChk = $('approvalChk');
  const joinRequests = $('joinRequests');
  const micNote = $('micNote');
  const roomPassInput = $('roomPassInput');
  const messages = $('messages');
  const chatForm = $('chatForm');
  const chatInput = $('chatInput');
  const chatSend = $('chatSend');
  const memberCount = $('memberCount');
  const participants = $('participants');
  const chatNew = $('chatNew');
  const viewerPanel = $('viewerPanel');
  const leaveBtn = $('leaveBtn');
  const hostError = $('hostError');
  const stageNote = $('stageNote');
  const stageNoteText = $('stageNoteText');
  const chatEmpty = $('chatEmpty');
  const stageControls = $('stageControls');
  const fsBtn = $('fsBtn');
  const theaterBtn = $('theaterBtn');
  const pipBtn = $('pipBtn');
  const volumeWrap = $('volumeWrap');
  const volumeRange = $('volumeRange');
  
  const pauseShareBtn = $('pauseShareBtn');
  const reactionLayer = $('reactionLayer');
  const reactions = $('reactions');
  const pausedOverlay = $('pausedOverlay');
  const qualityBadge = $('qualityBadge');
  const exportBtn = $('exportBtn');

  const REACTIONS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F389}', '\u{1F62E}', '\u{1F44F}'];
  const QUALITY_KEY = 'piik-quality';
  const QUALITY_PRESETS = {
    source: { label: 'Source', maxBitrate: 0 },
    '1080': { label: '1080p', width: 1920, height: 1080, maxBitrate: 3500000 },
    '720': { label: '720p', width: 1280, height: 720, maxBitrate: 1800000 },
    '480': { label: '480p', width: 854, height: 480, maxBitrate: 800000 },
  };

  const MIC_ICON =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/></svg>';
  const MIC_OFF_ICON =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="m4 4 16 16"/></svg>';

  const roomIdFromPath =
    (location.pathname.match(/^\/r\/([^/]+)/) || [])[1] || null;

  const state = {
    role: null, // 'host' | 'viewer'
    ws: null,
    myId: null,
    roomId: null,
    name: 'Host',
    peers: new Map(), // peerId -> RTCPeerConnection
    localStream: null, // host: screen + audio (+ mic)
    micTrack: null,
    micOn: false,
    members: new Map(),
    wakeLock: null,
    inviteUrl: '',
    chatPinned: true,
    unread: 0,
    audioCtx: null,
    audioSource: null,
    gainNode: null,
    quality: 'source',
    paused: false,
    captureSettings: null,
    mutedIds: new Set(), // host: muted viewer ids
    rec: null, // host: active MediaRecorder
    creds: null, // viewer: { name, password } for auto-rejoin
    noRetry: false,
    retries: 0,
    retryTimer: null,
    log: [],
  };

  const setStatus = (s, live) => {
    statusEl.textContent = s;
    statusEl.classList.toggle('live', !!live);
  };

  function showHostError(msg) {
    hostError.textContent = msg || '';
  }

  function showStageNote(text) {
    stageNoteText.textContent = text;
    stageNote.classList.remove('hidden');
  }

  function hideStageNote() {
    stageNote.classList.add('hidden');
  }

  function wsSend(msg) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(msg));
    }
  }

  function connectWS() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}`);
      ws.onopen = () => resolve(ws);
      ws.onerror = (e) => reject(e);
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        handleMessage(msg);
      };
      ws.onclose = () => {
        if (state.ws !== ws) return;
        if (state.role === 'viewer' && state.creds && !state.noRetry) scheduleReconnect();
        else setStatus('disconnected');
      };
      state.ws = ws;
    });
  }

  function scheduleReconnect() {
    if (state.retryTimer) return;
    for (const pc of state.peers.values()) pc.close();
    state.peers.clear();
    video.srcObject = null;
    setStatus('reconnecting\u2026');
    showStageNote('Connection lost. Reconnecting\u2026');
    const delay = Math.min(1000 * 2 ** state.retries, 30000);
    state.retries += 1;
    state.retryTimer = setTimeout(async () => {
      state.retryTimer = null;
      try {
        await connectWS();
        wsSend({ type: 'join', roomId: roomIdFromPath, ...state.creds });
      } catch {
        /* onclose schedules the next attempt */
      }
    }, delay);
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        state.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      /* wake lock unsupported or denied */
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.role === 'host') {
      requestWakeLock();
    }
  });

  // ---------- HOST ----------

  async function startHost() {
    showHostError('');
    try {
      state.localStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
    } catch {
      showHostError('Screen capture was cancelled or is not available. Try again.');
      return;
    }

    state.role = 'host';
    state.name = 'Host';
    state.myId = HOST_ID;
    video.srcObject = state.localStream;
    video.muted = true;
    placeholder.classList.add('hidden');
    requestWakeLock();

    const screenTrack = state.localStream.getVideoTracks()[0];
    if (screenTrack) {
      screenTrack.addEventListener('ended', stopHost);
      try {
        state.captureSettings = screenTrack.getSettings();
      } catch {
        state.captureSettings = null;
      }
    }

    const storedQuality = readQuality();
    state.quality = QUALITY_PRESETS[storedQuality] ? storedQuality : 'source';
    if (window.__qualityDropdownRefresh) window.__qualityDropdownRefresh();
    applyQuality(state.quality);

    try {
      await connectWS();
    } catch {
      showHostError('Could not connect to the server.');
      return;
    }
    wsSend({ type: 'create-room' });
    enableChat();
    setStatus('live', true);
    showControls(false);
  }

  function onRoomCreated(roomId) {
    state.roomId = roomId;
    state.inviteUrl = `${location.origin}/r/${roomId}`;
    inviteLink.value = state.inviteUrl;
    qrImg.src = `/qr?text=${encodeURIComponent(state.inviteUrl)}`;
    sharePanel.classList.remove('hidden');
    addMember(HOST_ID, 'Host');

    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(state.inviteUrl);
      } catch {
        inviteLink.select();
        document.execCommand('copy');
      }
      copyLabel.textContent = 'Copied!';
      setTimeout(() => (copyLabel.textContent = 'Copy'), 1500);
    };

    qrBtn.onclick = () => qrBox.classList.toggle('hidden');

    if (navigator.share) {
      shareBtn.classList.remove('hidden');
      shareBtn.onclick = () => {
        navigator
          .share({ title: 'Piik-lite', text: 'Watch my screen', url: state.inviteUrl })
          .catch(() => {});
      };
    }
  }

  function hostCreatePeer(viewerId) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    state.peers.set(viewerId, pc);
    pc._pendingIce = [];

    pc.onicecandidate = (e) => {
      if (e.candidate) wsSend({ type: 'ice', to: viewerId, candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && state.role === 'host') {
        try {
          pc.restartIce();
        } catch {
          /* ignore */
        }
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        wsSend({ type: 'offer', to: viewerId, sdp: pc.localDescription });
      } catch (err) {
        console.error('offer failed', err);
      }
    };

    for (const track of state.localStream.getTracks()) {
      pc.addTrack(track, state.localStream);
    }
    applyBitrateToPeer(pc, QUALITY_PRESETS[state.quality].maxBitrate);
    return pc;
  }

  async function toggleMic() {
    if (state.role !== 'host') return;

    if (!state.micTrack) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.micTrack = mic.getAudioTracks()[0];
        state.localStream.addTrack(state.micTrack);
        for (const pc of state.peers.values()) {
          pc.addTrack(state.micTrack, state.localStream);
        }
      } catch (err) {
        micNote.textContent = 'Microphone unavailable: ' + err.message;
        return;
      }
    }

    state.micOn = !state.micOn;
    state.micTrack.enabled = state.micOn;
    micBtn.innerHTML =
      (state.micOn ? MIC_ICON : MIC_OFF_ICON) +
      'Mic: ' +
      (state.micOn ? 'on' : 'off');
    micBtn.classList.toggle('on', state.micOn);
    wsSend({ type: 'mic-state', on: state.micOn });
  }

  function setRoomPassword() {
    wsSend({ type: 'set-password', password: roomPassInput.value });
  }

  function toggleRecord() {
    if (state.rec) {
      state.rec.stop();
      return;
    }
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const chunks = [];
    let rec;
    try {
      rec = new MediaRecorder(state.localStream, type ? { mimeType: type } : undefined);
    } catch {
      micNote.textContent = 'Recording is not supported in this browser.';
      return;
    }
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      state.rec = null;
      recBtn.classList.remove('on');
      recBtn.textContent = 'Record';
      wsSend({ type: 'recording', on: false });
      if (!chunks.length) return;
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `piik-${state.roomId || 'room'}-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    rec.start(1000);
    state.rec = rec;
    recBtn.classList.add('on');
    recBtn.textContent = 'Stop recording';
    wsSend({ type: 'recording', on: true });
  }

  window.addEventListener('beforeunload', (e) => {
    if (state.rec) e.preventDefault();
  });

  function stopHost() {
    const rec = state.rec;
    if (rec && rec.state !== 'inactive') {
      // let the recorder flush and save before tearing down the tracks
      rec.addEventListener('stop', () => setTimeout(stopHost, 500));
      rec.stop();
      return;
    }
    if (state.localStream) state.localStream.getTracks().forEach((t) => t.stop());
    for (const pc of state.peers.values()) pc.close();
    state.peers.clear();
    if (state.ws) state.ws.close();
    location.reload();
  }

  function leaveRoom() {
    state.noRetry = true;
    for (const pc of state.peers.values()) pc.close();
    state.peers.clear();
    if (state.ws) state.ws.close();
    location.reload();
  }

  // ---------- VIEWER ----------

  async function joinRoom() {
    const name = nameInput.value.trim() || 'Guest';
    state.name = name;
    state.role = 'viewer';
    joinError.textContent = '';
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* storage unavailable */
    }
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      try {
        await connectWS();
      } catch {
        joinError.textContent = 'Could not connect to the server.';
        return;
      }
    }
    state.creds = { name, password: passwordInput.value };
    wsSend({ type: 'join', roomId: roomIdFromPath, ...state.creds });
  }

  function viewerCreatePeer(hostId) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    state.peers.set(hostId, pc);
    pc._pendingIce = [];

    pc.onicecandidate = (e) => {
      if (e.candidate) wsSend({ type: 'ice', to: hostId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) {
        video.srcObject = e.streams[0];
        video.muted = false;
        hideStageNote();
        showControls(true);
        attemptPlay();
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') setStatus('reconnecting\u2026');
    };
    return pc;
  }

  async function handleOffer(from, sdp) {
    let pc = state.peers.get(from);
    if (!pc) pc = viewerCreatePeer(from);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushIce(pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsSend({ type: 'answer', to: from, sdp: pc.localDescription });
    hideStageNote();
    setStatus('live', true);
    joinPane.classList.add('hidden');
    placeholder.classList.add('hidden');
  }

  async function handleAnswer(from, sdp) {
    const pc = state.peers.get(from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushIce(pc);
  }

  async function handleIce(from, candidate) {
    const pc = state.peers.get(from);
    if (!pc) return;
    if (!pc.remoteDescription || !pc.remoteDescription.type) {
      pc._pendingIce.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn('ice', err);
    }
  }

  async function flushIce(pc) {
    const queued = pc._pendingIce || [];
    pc._pendingIce = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('ice', err);
      }
    }
  }

  function attemptPlay() {
    video
      .play()
      .then(() => playBtn.classList.add('hidden'))
      .catch(() => playBtn.classList.remove('hidden'));
  }

  // ---------- STAGE CONTROLS ----------

  function showControls(withVolume) {
    stageControls.classList.remove('hidden');
    volumeWrap.classList.toggle('hidden', !withVolume);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (stageEl.requestFullscreen) {
      stageEl.requestFullscreen().catch(() => {});
    }
  }

  function toggleTheater() {
    const on = document.body.classList.toggle('theater');
    theaterBtn.classList.toggle('on', on);
  }

  async function togglePip() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (video.requestPictureInPicture && video.srcObject) {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('pip', err);
    }
  }

  function setVolume(pct) {
    const v = Math.max(0, Math.min(200, pct)) / 100;
    if (state.role === 'viewer' && !state.audioSource) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          state.audioCtx = new AC();
          state.audioSource = state.audioCtx.createMediaElementSource(video);
          state.gainNode = state.audioCtx.createGain();
          state.audioSource.connect(state.gainNode);
          state.gainNode.connect(state.audioCtx.destination);
        }
      } catch (err) {
        console.warn('audio boost unavailable', err);
      }
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(() => {});
    }
    video.volume = Math.min(1, v);
    if (state.gainNode) state.gainNode.gain.value = v > 1 ? v : 1;
  }

  function toggleMuteKey() {
    if (state.role === 'host') {
      toggleMic();
    } else if (state.role === 'viewer') {
      video.muted = !video.muted;
    }
  }

  // ---------- QUALITY ----------

  function readQuality() {
    try {
      const q = localStorage.getItem(QUALITY_KEY);
      return q && QUALITY_PRESETS[q] ? q : 'source';
    } catch {
      return 'source';
    }
  }

  function persistQuality(value) {
    try {
      localStorage.setItem(QUALITY_KEY, value);
    } catch {
      /* storage unavailable */
    }
  }

  function applyBitrateToPeer(pc, maxBitrate) {
    const sender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === 'video');
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      if (maxBitrate) params.encodings[0].maxBitrate = maxBitrate;
      else delete params.encodings[0].maxBitrate;
      const p = sender.setParameters(params);
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* setParameters unsupported */
    }
  }

  function applyQuality(value) {
    state.quality = QUALITY_PRESETS[value] ? value : 'source';
    const preset = QUALITY_PRESETS[state.quality];
    const vt = state.localStream && state.localStream.getVideoTracks()[0];
    if (vt) {
      const constraints =
        state.quality !== 'source'
          ? { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: 30 } }
          : state.captureSettings
            ? {
                width: { ideal: state.captureSettings.width || 1920 },
                height: { ideal: state.captureSettings.height || 1080 },
                frameRate: { ideal: state.captureSettings.frameRate || 30 },
              }
            : null;
      if (constraints) {
        const p = vt.applyConstraints(constraints);
        if (p && p.catch) p.catch(() => {});
      }
    }
    for (const pc of state.peers.values()) applyBitrateToPeer(pc, preset.maxBitrate);
    updateQualityBadge(state.quality);
  }

  function updateQualityBadge(value) {
    if (!value || value === 'source') {
      qualityBadge.classList.add('hidden');
      return;
    }
    const preset = QUALITY_PRESETS[value];
    qualityBadge.textContent = preset ? preset.label : value;
    qualityBadge.classList.remove('hidden');
  }

  // ---------- PAUSE / RESUME ----------

  function setPaused(paused) {
    state.paused = !!paused;
    pausedOverlay.classList.toggle('hidden', !state.paused);
    if (state.role === 'host') {
      const vt = state.localStream && state.localStream.getVideoTracks()[0];
      if (vt) vt.enabled = !state.paused;
      pauseShareBtn.textContent = state.paused ? 'Resume' : 'Pause';
      pauseShareBtn.classList.toggle('on', state.paused);
    }
  }

  function togglePause() {
    if (state.role !== 'host') return;
    const paused = !state.paused;
    wsSend({ type: 'presentation', paused });
    setPaused(paused);
  }

  // ---------- REACTIONS ----------

  function spawnFloater(emoji, name) {
    while (reactionLayer.children.length > 30) reactionLayer.firstChild.remove();
    const el = document.createElement('span');
    el.className = 'floater';
    el.style.left = `${8 + Math.random() * 78}%`;
    el.style.animationDuration = `${(2.2 + Math.random() * 0.8).toFixed(2)}s`;
    const glyph = document.createElement('span');
    glyph.className = 'femoji';
    glyph.textContent = emoji;
    el.appendChild(glyph);
    if (name) {
      const label = document.createElement('span');
      label.className = 'fname';
      label.textContent = name;
      el.appendChild(label);
    }
    el.addEventListener('animationend', () => el.remove());
    reactionLayer.appendChild(el);
  }

  function initReactions() {
    for (const emoji of REACTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'react';
      btn.textContent = emoji;
      btn.setAttribute('aria-label', `React ${emoji}`);
      btn.onclick = () => wsSend({ type: 'reaction', emoji });
      reactions.appendChild(btn);
    }
  }

  // ---------- CHAT RENDERING ----------

  function isEmojiOnly(text) {
    const t = text.trim();
    if (!t) return false;
    const stripped = t.replace(
      /\p{Extended_Pictographic}|\uFE0F|\u200D|[\u{1F3FB}-\u{1F3FF}]|\s/gu,
      ''
    );
    if (stripped !== '') return false;
    const count = (t.match(/\p{Extended_Pictographic}/gu) || []).length;
    return count >= 1 && count <= 4;
  }

  function renderMessageBody(el, text) {
    const re = /(https?:\/\/[^\s<]+)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) {
        el.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      const a = document.createElement('a');
      a.href = m[0];
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      a.textContent = m[0];
      el.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      el.appendChild(document.createTextNode(text.slice(last)));
    }
  }

  function downloadTranscript() {
    if (!state.log.length) return;
    const lines = state.log.map((l) =>
      l.system ? `\u2014 ${l.text}` : `[${fmtTime(l.ts)}] ${l.name}: ${l.text}`
    );
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `piik-chat-${state.roomId || 'room'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- MESSAGES ----------

  function handleMessage(msg) {
    switch (msg.type) {
      case 'room-created':
        onRoomCreated(msg.roomId);
        break;

      case 'password-set':
        roomPassInput.placeholder = msg.on ? 'Password set' : 'No password';
        break;

      case 'viewer-joined':
        if (state.role === 'host') hostCreatePeer(msg.id);
        addMember(msg.id, msg.name);
        appendSystem(`${msg.name} joined`);
        break;

      case 'joined':
        state.roomId = msg.roomId;
        state.myId = msg.id;
        state.retries = 0;
        if (state.creds) state.creds.rejoinToken = msg.rejoinToken;
        state.members.clear();
        (msg.members || []).forEach((m) => addMember(m.id, m.name));
        enableChat();
        viewerPanel.classList.remove('hidden');
        joinPane.classList.add('hidden');
        placeholder.classList.add('hidden');
        if (msg.quality) {
          state.quality = msg.quality;
          applyQuality(msg.quality);
          if (window.__qualityDropdownRefresh) window.__qualityDropdownRefresh();
        }
        if (msg.paused) setPaused(true);
        if (msg.recording) appendSystem('Host is recording');
        showStageNote('Waiting for the host\u2026');
        break;

      case 'offer':
        handleOffer(msg.from, msg.sdp);
        break;

      case 'answer':
        handleAnswer(msg.from, msg.sdp);
        break;

      case 'ice':
        handleIce(msg.from, msg.candidate);
        break;

      case 'viewer-left': {
        const who = state.members.get(msg.id) || 'A viewer';
        if (state.role === 'host') {
          const pc = state.peers.get(msg.id);
          if (pc) {
            pc.close();
            state.peers.delete(msg.id);
          }
        }
        removeMember(msg.id);
        appendSystem(`${who} left`);
        break;
      }

      case 'chat':
        appendChat(msg.name, msg.text, msg.ts);
        break;

      case 'reaction':
        spawnFloater(msg.emoji, msg.name);
        break;

      case 'quality':
        state.quality = msg.value;
        applyQuality(msg.value);
        if (window.__qualityDropdownRefresh) window.__qualityDropdownRefresh();
        break;

      case 'presentation':
        setPaused(msg.paused);
        break;

      case 'mic-state':
        appendSystem(`Host microphone ${msg.on ? 'on' : 'off'}`);
        break;

      case 'room-closed':
        state.noRetry = true;
        setStatus('room closed');
        showStageNote('The host closed the room.');
        disableChat('The host closed the room.');
        break;

      case 'waiting':
        joinBtn.disabled = true;
        joinError.textContent = 'Waiting for the host to let you in\u2026';
        break;

      case 'denied':
        state.noRetry = true;
        setStatus('declined');
        joinError.textContent = 'The host declined your request.';
        break;

      case 'join-request':
        addJoinRequest(msg.id, msg.name);
        break;

      case 'join-cancelled':
        removeJoinRequest(msg.id);
        break;

      case 'kicked':
        state.noRetry = true;
        setStatus('removed');
        showStageNote('You were removed by the host.');
        disableChat('You were removed by the host.');
        break;

      case 'muted':
        appendSystem(msg.on ? 'The host muted you' : 'The host unmuted you');
        break;

      case 'recording':
        appendSystem(msg.on ? 'Host started recording' : 'Host stopped recording');
        break;

      case 'error':
        joinBtn.disabled = false;
        if (msg.code === 'notfound' || msg.code === 'banned' || msg.code === 'password') {
          state.noRetry = true;
        }
        if (msg.code === 'notfound' || msg.code === 'banned') {
          setStatus('disconnected');
          showStageNote(msg.message);
        }
        if (msg.code === 'password') {
          passwordInput.classList.remove('hidden');
          passwordInput.focus();
        }
        joinError.textContent = msg.message;
        break;

      default:
        break;
    }
  }

  // ---------- UI helpers ----------

  function addMember(id, name) {
    state.members.set(id, name);
    updateCount();
    renderParticipants();
  }

  function removeMember(id) {
    state.members.delete(id);
    state.mutedIds.delete(id);
    updateCount();
    renderParticipants();
  }

  function updateCount() {
    memberCount.textContent = state.members.size
      ? `${state.members.size} in room`
      : '';
  }

  function colorFor(name) {
    let h = 0;
    const s = String(name);
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
    return `hsl(${h}, 62%, 62%)`;
  }

  function removeJoinRequest(id) {
    const row = joinRequests.querySelector(`[data-id="${id}"]`);
    if (row) row.remove();
  }

  function addJoinRequest(id, name) {
    const row = document.createElement('div');
    row.className = 'join-request';
    row.dataset.id = id;
    const label = document.createElement('span');
    label.textContent = `${name} wants to join`;
    const decide = (allow) => () => {
      wsSend({ type: 'decide', id, allow });
      row.remove();
    };
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = 'Allow';
    yes.onclick = decide(true);
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'danger';
    no.textContent = 'Deny';
    no.onclick = decide(false);
    row.append(label, yes, no);
    joinRequests.appendChild(row);
  }

  function chipBtn(label, text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-btn';
    b.title = `${label} participant`;
    b.setAttribute('aria-label', label);
    b.textContent = text;
    b.onclick = onClick;
    return b;
  }

  function renderParticipants() {
    participants.innerHTML = '';
    for (const [id, name] of state.members) {
      const chip = document.createElement('span');
      chip.className = 'participant';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = colorFor(name);
      const label = document.createElement('span');
      label.className = 'pname';
      label.textContent = id === state.myId ? `${name} (you)` : name;
      chip.append(dot, label);
      if (state.role === 'host' && id !== HOST_ID) {
        const muted = state.mutedIds.has(id);
        chip.append(
          chipBtn(muted ? 'Unmute' : 'Mute', muted ? '\u{1F507}' : '\u{1F50A}', () => {
            if (muted) state.mutedIds.delete(id);
            else state.mutedIds.add(id);
            wsSend({ type: 'mute', id, on: !muted });
            renderParticipants();
          }),
          chipBtn('Remove', '\u2715', () => wsSend({ type: 'kick', id })),
        );
      }
      participants.appendChild(chip);
    }
  }

  function fmtTime(ts) {
    return new Date(ts || Date.now()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function afterAppend(isChat) {
    if (state.chatPinned) {
      messages.scrollTop = messages.scrollHeight;
    } else if (isChat) {
      state.unread += 1;
      updateChatNew();
    }
  }

  function updateChatNew() {
    if (state.unread > 0) {
      chatNew.textContent = `${state.unread} new`;
      chatNew.classList.remove('hidden');
    } else {
      chatNew.classList.add('hidden');
    }
  }

  function appendChat(name, text, ts) {
    chatEmpty.classList.add('hidden');
    const el = document.createElement('div');
    el.className = isEmojiOnly(text) ? 'msg big' : 'msg';
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = colorFor(name);
    who.textContent = name;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = fmtTime(ts);
    who.appendChild(time);
    el.appendChild(who);
    const body = document.createElement('span');
    body.className = 'body';
    renderMessageBody(body, text);
    el.appendChild(body);
    messages.appendChild(el);
    state.log.push({ ts: ts || Date.now(), name, text });
    afterAppend(true);
  }

  function appendSystem(text) {
    chatEmpty.classList.add('hidden');
    const el = document.createElement('div');
    el.className = 'system';
    el.textContent = text;
    messages.appendChild(el);
    state.log.push({ ts: Date.now(), system: true, text });
    afterAppend(false);
  }

  function enableChat() {
    chatInput.disabled = false;
    chatSend.disabled = false;
  }

  function disableChat(note) {
    chatInput.disabled = true;
    chatSend.disabled = true;
    if (note) appendSystem(note);
  }

  // ---------- dropdown widget ----------

  function dropdownWidget(btn, labelEl, menu, options, cfg) {
    const { current, labelOf, onSelect, wrap } = cfg;

    function activeOption() {
      return options.find((o) => o.getAttribute('aria-selected') === 'true') || options[0];
    }

    function refresh() {
      const v = current();
      labelEl.textContent = labelOf(v);
      options.forEach((opt) => {
        const on = opt.dataset.value === v;
        opt.setAttribute('aria-selected', String(on));
        opt.tabIndex = on ? 0 : -1;
      });
    }

    function open() {
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-activedescendant', activeOption().id);
    }

    function close() {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
    }

    function select(opt) {
      onSelect(opt.dataset.value);
      refresh();
      close();
      btn.focus();
    }

    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-expanded') === 'true') close();
      else open();
    });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (btn.getAttribute('aria-expanded') === 'true') {
          e.preventDefault();
          close();
        }
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      open();
      activeOption().focus();
    });

    menu.addEventListener('click', (e) => {
      const opt = e.target.closest('.dd-option');
      if (opt) select(opt);
    });

    menu.addEventListener('keydown', (e) => {
      const idx = options.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        btn.focus();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const opt = options[idx];
        if (opt) select(opt);
        return;
      }
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || idx === -1) return;
      e.preventDefault();
      const n = options.length;
      const next = options[(idx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n];
      next.focus();
      btn.setAttribute('aria-activedescendant', next.id);
    });

    wrap.addEventListener('focusout', (e) => {
      if (!wrap.contains(e.relatedTarget)) close();
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) close();
    });

    refresh();
    return { refresh, open, close };
  }

  // ---------- theme ----------

  const themeMql = window.matchMedia('(prefers-color-scheme: light)');
  const themeWrap = $('themeWrap');
  const themeBtn = $('themeBtn');
  const themeLabel = $('themeLabel');
  const themeMenu = $('themeMenu');
  const themeOptions = Array.from(document.querySelectorAll('#themeMenu .dd-option'));
  const THEME_LABELS = { auto: 'Auto', dark: 'Dark', light: 'Light' };

  function resolveTheme(pref) {
    return pref === 'auto' ? (themeMql.matches ? 'light' : 'dark') : pref;
  }

  function applyTheme(pref) {
    document.documentElement.dataset.theme = resolveTheme(pref);
  }

  function readThemePref() {
    try {
      return localStorage.getItem(THEME_KEY) || 'auto';
    } catch {
      return 'auto';
    }
  }

  applyTheme(readThemePref());

  dropdownWidget(themeBtn, themeLabel, themeMenu, themeOptions, {
    current: readThemePref,
    labelOf: (v) => THEME_LABELS[v] || 'Auto',
    onSelect: (v) => {
      try {
        localStorage.setItem(THEME_KEY, v);
      } catch {
        /* storage unavailable */
      }
      applyTheme(v);
    },
    wrap: themeWrap,
  });

  themeMql.addEventListener('change', () => {
    if (readThemePref() === 'auto') applyTheme('auto');
  });

  // ---------- quality ----------

  const qualityWrap = $('qualityWrap');
  const qualityBtn = $('qualityBtn');
  const qualityLabel = $('qualityLabel');
  const qualityMenu = $('qualityMenu');
  const qualityOptions = Array.from(document.querySelectorAll('#qualityMenu .dd-option'));

  const ddQual = dropdownWidget(qualityBtn, qualityLabel, qualityMenu, qualityOptions, {
    current: () => state.quality,
    labelOf: (v) =>
      (QUALITY_PRESETS[v] ? QUALITY_PRESETS[v].label : 'Source') +
      (v === 'source' ? ' (best)' : ''),
    onSelect: (v) => {
      persistQuality(v);
      applyQuality(v);
      wsSend({ type: 'quality', value: v });
    },
    wrap: qualityWrap,
  });

  window.__qualityDropdownRefresh = () => ddQual.refresh();

  // ---------- wiring ----------

  startBtn.onclick = startHost;
  joinBtn.onclick = joinRoom;
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  micBtn.onclick = toggleMic;
  stopBtn.onclick = stopHost;
  recBtn.onclick = toggleRecord;
  approvalChk.onchange = () => wsSend({ type: 'set-approval', on: approvalChk.checked });
  leaveBtn.onclick = leaveRoom;
  playBtn.onclick = attemptPlay;
  roomPassInput.addEventListener('change', setRoomPassword);
  roomPassInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setRoomPassword();
    }
  });
  fsBtn.onclick = toggleFullscreen;
  theaterBtn.onclick = toggleTheater;
  pipBtn.onclick = togglePip;
  volumeRange.addEventListener('input', () => setVolume(Number(volumeRange.value)));
  pauseShareBtn.onclick = togglePause;
  exportBtn.onclick = downloadTranscript;
  initReactions();

  messages.addEventListener('scroll', () => {
    const atBottom =
      messages.scrollHeight - messages.scrollTop - messages.clientHeight <= 40;
    state.chatPinned = atBottom;
    if (atBottom && state.unread) {
      state.unread = 0;
      updateChatNew();
    }
  });

  chatNew.onclick = () => {
    messages.scrollTop = messages.scrollHeight;
    state.chatPinned = true;
    state.unread = 0;
    updateChatNew();
  };

  chatForm.onsubmit = (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    wsSend({ type: 'chat', text });
    chatInput.value = '';
  };

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (
      t &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    ) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
    } else if (e.key === 'm' || e.key === 'M') {
      toggleMuteKey();
    }
  });

  // ---------- init ----------

  if (typeof MediaRecorder === 'undefined') recBtn.classList.add('hidden');

  if (roomIdFromPath) {
    placeholder.classList.add('hidden');
    joinPane.classList.remove('hidden');
    setStatus('ready to join');
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) nameInput.value = saved;
    } catch {
      /* storage unavailable */
    }
    nameInput.focus();
  } else {
    setStatus('ready');
  }
})();
