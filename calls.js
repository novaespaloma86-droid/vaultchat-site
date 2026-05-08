// ============================================================
// VaultChat — Módulo de Chamadas WebRTC via Supabase Realtime
// ============================================================

const SUPABASE_URL = 'https://exkspbpamuqzzrbpbflx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_AqEz3N2R5apg8tGG0rDu5w_2L92h4ya';

// STUN servers gratuitos (Google + Cloudflare)
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

// Estado global das chamadas
window.VaultCall = {
  localStream: null,
  remoteStreams: {},      // { userId: MediaStream }
  peerConnections: {},    // { userId: RTCPeerConnection }
  channel: null,
  currentRoomId: null,
  currentUserId: null,
  isVideoEnabled: true,
  isAudioEnabled: true,
  isInCall: false,
};

const VC = window.VaultCall;

// ============================================================
// INICIALIZAÇÃO
// ============================================================
function initCallModule(userId, supabaseClient) {
  VC.currentUserId = userId;
  VC.supabase = supabaseClient;
  console.log('[VaultCall] Módulo iniciado para usuário:', userId);
}

// ============================================================
// INICIAR CHAMADA (quem liga)
// ============================================================
async function startCall(roomId, participants, isVideo = true) {
  if (VC.isInCall) return;

  VC.currentRoomId = roomId;
  VC.isVideoEnabled = isVideo;
  VC.isInCall = true;

  try {
    // 1. Pegar mídia local
    VC.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo ? { width: 640, height: 480, facingMode: 'user' } : false
    });

    // 2. Mostrar UI de chamada
    showCallUI(isVideo, true);
    setLocalVideo(VC.localStream);

    // 3. Entrar no canal de sinalização Supabase
    await joinSignalingChannel(roomId);

    // 4. Enviar convite para cada participante
    for (const participantId of participants) {
      if (participantId !== VC.currentUserId) {
        await sendSignal(roomId, {
          type: 'call-invite',
          from: VC.currentUserId,
          to: participantId,
          isVideo,
          roomId
        });
      }
    }

  } catch (err) {
    console.error('[VaultCall] Erro ao iniciar chamada:', err);
    endCall();
    showCallError(err);
  }
}

// ============================================================
// ACEITAR CHAMADA (quem recebe)
// ============================================================
async function acceptCall(inviteData) {
  const { from, roomId, isVideo } = inviteData;

  VC.currentRoomId = roomId;
  VC.isVideoEnabled = isVideo;
  VC.isInCall = true;

  hideIncomingCallUI();

  try {
    VC.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo ? { width: 640, height: 480, facingMode: 'user' } : false
    });

    showCallUI(isVideo, false);
    setLocalVideo(VC.localStream);

    await joinSignalingChannel(roomId);

    // Avisar que aceitou
    await sendSignal(roomId, {
      type: 'call-accepted',
      from: VC.currentUserId,
      to: from,
      roomId
    });

    // Criar peer connection e enviar offer
    await createOfferForPeer(from);

  } catch (err) {
    console.error('[VaultCall] Erro ao aceitar chamada:', err);
    endCall();
  }
}

// ============================================================
// RECUSAR CHAMADA
// ============================================================
async function rejectCall(inviteData) {
  const { from, roomId } = inviteData;
  hideIncomingCallUI();

  const tempChannel = VC.supabase.channel(`call:${roomId}`);
  await tempChannel.subscribe();
  await tempChannel.send({
    type: 'broadcast',
    event: 'signal',
    payload: {
      type: 'call-rejected',
      from: VC.currentUserId,
      to: from,
      roomId
    }
  });
  await VC.supabase.removeChannel(tempChannel);
}

// ============================================================
// CRIAR PEER CONNECTION
// ============================================================
async function createPeerConnection(peerId) {
  if (VC.peerConnections[peerId]) return VC.peerConnections[peerId];

  const pc = new RTCPeerConnection(ICE_SERVERS);
  VC.peerConnections[peerId] = pc;

  // Adicionar tracks locais
  if (VC.localStream) {
    VC.localStream.getTracks().forEach(track => {
      pc.addTrack(track, VC.localStream);
    });
  }

  // Receber stream remoto
  pc.ontrack = (event) => {
    const [remoteStream] = event.streams;
    VC.remoteStreams[peerId] = remoteStream;
    addRemoteVideo(peerId, remoteStream);
  };

  // Enviar ICE candidates
  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      await sendSignal(VC.currentRoomId, {
        type: 'ice-candidate',
        from: VC.currentUserId,
        to: peerId,
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[VaultCall] Conexão com ${peerId}:`, pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      removeRemoteVideo(peerId);
    }
  };

  return pc;
}

// ============================================================
// CRIAR E ENVIAR OFFER
// ============================================================
async function createOfferForPeer(peerId) {
  const pc = await createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await sendSignal(VC.currentRoomId, {
    type: 'offer',
    from: VC.currentUserId,
    to: peerId,
    sdp: offer
  });
}

// ============================================================
// PROCESSAR SINAIS RECEBIDOS
// ============================================================
async function handleSignal(payload) {
  const { type, from, to, sdp, candidate, isVideo, roomId } = payload;

  // Ignorar sinais para outros usuários
  if (to && to !== VC.currentUserId) return;
  // Ignorar sinais do próprio usuário
  if (from === VC.currentUserId) return;

  switch (type) {
    case 'call-invite':
      showIncomingCallUI({ from, roomId, isVideo });
      break;

    case 'call-accepted':
      await createOfferForPeer(from);
      break;

    case 'call-rejected':
      showCallStatus('Chamada recusada');
      setTimeout(() => endCall(), 2000);
      break;

    case 'offer': {
      const pc = await createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(VC.currentRoomId, {
        type: 'answer',
        from: VC.currentUserId,
        to: from,
        sdp: answer
      });
      break;
    }

    case 'answer': {
      const pc = VC.peerConnections[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      break;
    }

    case 'ice-candidate': {
      const pc = VC.peerConnections[from];
      if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      break;
    }

    case 'call-ended':
      removePeerFromCall(from);
      break;
  }
}

// ============================================================
// CANAL DE SINALIZAÇÃO SUPABASE
// ============================================================
async function joinSignalingChannel(roomId) {
  if (VC.channel) {
    await VC.supabase.removeChannel(VC.channel);
  }

  VC.channel = VC.supabase.channel(`call:${roomId}`, {
    config: { broadcast: { self: false } }
  });

  VC.channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    handleSignal(payload);
  });

  await new Promise((resolve, reject) => {
    VC.channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      if (status === 'CHANNEL_ERROR') reject(new Error('Falha no canal'));
    });
  });
}

async function sendSignal(roomId, payload) {
  if (!VC.channel) return;
  await VC.channel.send({
    type: 'broadcast',
    event: 'signal',
    payload
  });
}

// ============================================================
// ENCERRAR CHAMADA
// ============================================================
async function endCall() {
  if (VC.channel) {
    await sendSignal(VC.currentRoomId, {
      type: 'call-ended',
      from: VC.currentUserId
    });
    await VC.supabase.removeChannel(VC.channel);
    VC.channel = null;
  }

  // Fechar todas as peer connections
  Object.values(VC.peerConnections).forEach(pc => pc.close());
  VC.peerConnections = {};
  VC.remoteStreams = {};

  // Parar mídia local
  if (VC.localStream) {
    VC.localStream.getTracks().forEach(t => t.stop());
    VC.localStream = null;
  }

  VC.isInCall = false;
  VC.currentRoomId = null;
  hideCallUI();
}

function removePeerFromCall(peerId) {
  if (VC.peerConnections[peerId]) {
    VC.peerConnections[peerId].close();
    delete VC.peerConnections[peerId];
  }
  delete VC.remoteStreams[peerId];
  removeRemoteVideo(peerId);

  // Se não tem mais ninguém, encerrar
  if (Object.keys(VC.peerConnections).length === 0) {
    showCallStatus('Chamada encerrada');
    setTimeout(() => endCall(), 1500);
  }
}

// ============================================================
// CONTROLES DE MÍDIA
// ============================================================
function toggleMute() {
  if (!VC.localStream) return;
  const audioTrack = VC.localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    VC.isAudioEnabled = audioTrack.enabled;
    updateMuteButton();
  }
}

function toggleVideo() {
  if (!VC.localStream) return;
  const videoTrack = VC.localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    VC.isVideoEnabled = videoTrack.enabled;
    updateVideoButton();
  }
}

// ============================================================
// UI — FUNÇÕES DE INTERFACE
// ============================================================
function setLocalVideo(stream) {
  const localVideo = document.getElementById('vc-local-video');
  if (localVideo) {
    localVideo.srcObject = stream;
    localVideo.muted = true;
    localVideo.play().catch(() => {});
  }
}

function addRemoteVideo(peerId, stream) {
  const container = document.getElementById('vc-remote-videos');
  if (!container) return;

  let videoEl = document.getElementById(`vc-remote-${peerId}`);
  if (!videoEl) {
    const wrapper = document.createElement('div');
    wrapper.className = 'vc-remote-wrapper';
    wrapper.id = `vc-wrapper-${peerId}`;

    videoEl = document.createElement('video');
    videoEl.id = `vc-remote-${peerId}`;
    videoEl.autoplay = true;
    videoEl.playsinline = true;
    videoEl.className = 'vc-remote-video';

    wrapper.appendChild(videoEl);
    container.appendChild(wrapper);
  }
  videoEl.srcObject = stream;
  videoEl.play().catch(() => {});
}

function removeRemoteVideo(peerId) {
  const wrapper = document.getElementById(`vc-wrapper-${peerId}`);
  if (wrapper) wrapper.remove();
}

function showCallUI(isVideo, isCaller) {
  const ui = document.getElementById('vc-call-ui');
  if (ui) {
    ui.style.display = 'flex';
    ui.setAttribute('data-video', isVideo);
  }
  updateMuteButton();
  updateVideoButton();
}

function hideCallUI() {
  const ui = document.getElementById('vc-call-ui');
  if (ui) ui.style.display = 'none';

  const remoteVideos = document.getElementById('vc-remote-videos');
  if (remoteVideos) remoteVideos.innerHTML = '';
}

function showIncomingCallUI(data) {
  const ui = document.getElementById('vc-incoming-call');
  if (!ui) return;
  ui.style.display = 'flex';
  ui.dataset.callData = JSON.stringify(data);

  const callerName = document.getElementById('vc-caller-name');
  if (callerName) callerName.textContent = data.from;

  const typeLabel = document.getElementById('vc-call-type');
  if (typeLabel) typeLabel.textContent = data.isVideo ? '📹 Chamada de vídeo' : '📞 Chamada de voz';
}

function hideIncomingCallUI() {
  const ui = document.getElementById('vc-incoming-call');
  if (ui) ui.style.display = 'none';
}

function showCallStatus(msg) {
  const status = document.getElementById('vc-call-status');
  if (status) {
    status.textContent = msg;
    status.style.opacity = '1';
  }
}

function showCallError(err) {
  alert('Erro na chamada: ' + (err.message || err));
}

function updateMuteButton() {
  const btn = document.getElementById('vc-btn-mute');
  if (btn) btn.textContent = VC.isAudioEnabled ? '🎤' : '🔇';
}

function updateVideoButton() {
  const btn = document.getElementById('vc-btn-video');
  if (btn) btn.textContent = VC.isVideoEnabled ? '📹' : '📷';
}

// ============================================================
// OUVIR CONVITES GLOBAIS (fora de uma chamada ativa)
// ============================================================
function listenForIncomingCalls(userId, supabaseClient) {
  const globalChannel = supabaseClient.channel(`calls-global:${userId}`);

  globalChannel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    if (payload.type === 'call-invite' && payload.to === userId && !VC.isInCall) {
      showIncomingCallUI(payload);
    }
  });

  globalChannel.subscribe();
  return globalChannel;
}

// Expor funções globalmente
window.VaultCallAPI = {
  init: initCallModule,
  start: startCall,
  accept: acceptCall,
  reject: rejectCall,
  end: endCall,
  toggleMute,
  toggleVideo,
  listenForIncomingCalls,
};
