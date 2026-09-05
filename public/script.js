const socket = io();

const lobby = document.querySelector('#lobby');
const roomView = document.querySelector('#room');
const joinForm = document.querySelector('#join-form');
const roomInput = document.querySelector('#room-code');
const lobbyError = document.querySelector('#lobby-error');
const activeRoomCode = document.querySelector('#active-room-code');
const status = document.querySelector('#connection-status');
const localVideo = document.querySelector('#local-video');
const remoteVideo = document.querySelector('#remote-video');
const placeholder = document.querySelector('#video-placeholder');
const sharingBadge = document.querySelector('#sharing-badge');
const shareButton = document.querySelector('#share-screen');
const stopButton = document.querySelector('#stop-sharing');
const messageFeed = document.querySelector('#message-feed');
const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');
const welcomeOverlay = document.querySelector('#welcome-overlay');

let roomCode = '';
let peerConnection;
let localStream;
let pendingCandidates = [];
let peerAvailable = false;

const peerConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

function setStatus(text, connected = false) {
  status.textContent = text;
  status.classList.toggle('connected', connected);
  status.classList.toggle('waiting', !connected);
}

function addSystemMessage(text) {
  const message = document.createElement('div');
  message.className = 'system-message';
  message.textContent = text;
  messageFeed.append(message);
  messageFeed.scrollTop = messageFeed.scrollHeight;
}

function addReaction(reaction, mine = false) {
  const item = document.createElement('div');
  item.className = `message reaction ${mine ? 'mine' : 'theirs'}`;
  item.textContent = reaction;
  messageFeed.append(item);
  messageFeed.scrollTop = messageFeed.scrollHeight;
}

function addChatMessage(text, mine = false) {
  const item = document.createElement('div');
  item.className = `message ${mine ? 'mine' : 'theirs'}`;
  item.textContent = text;
  messageFeed.append(item);
  messageFeed.scrollTop = messageFeed.scrollHeight;
}

function showWelcome() {
  welcomeOverlay.hidden = false;
  window.setTimeout(() => {
    welcomeOverlay.classList.add('is-leaving');
    window.setTimeout(() => {
      welcomeOverlay.hidden = true;
      welcomeOverlay.classList.remove('is-leaving');
    }, 500);
  }, 3200);
}

function updateRemoteView() {
  const hasVideo = remoteVideo.srcObject?.getVideoTracks().some((track) => track.readyState === 'live');
  placeholder.hidden = Boolean(hasVideo);
}

function createPeerConnection() {
  if (peerConnection) return peerConnection;
  peerConnection = new RTCPeerConnection(peerConfig);
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('ice-candidate', candidate);
  };
  peerConnection.ontrack = ({ streams }) => {
    remoteVideo.srcObject = streams[0];
    remoteVideo.muted = false;
    remoteVideo.play().catch(() => {});
    streams[0].getVideoTracks().forEach((track) => track.addEventListener('ended', updateRemoteView));
    updateRemoteView();
  };
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'connected') setStatus('Arkadaşın bağlı', true);
    if (['disconnected', 'failed', 'closed'].includes(peerConnection.connectionState)) setStatus('Bağlantı bekleniyor');
  };
  return peerConnection;
}

async function flushCandidates() {
  while (pendingCandidates.length && peerConnection?.remoteDescription) {
    await peerConnection.addIceCandidate(pendingCandidates.shift());
  }
}

async function makeOffer() {
  if (!localStream || !peerAvailable) return;
  const peer = createPeerConnection();
  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit('offer', peer.localDescription);
}

async function startSharing() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    // The person sharing watches from the same large stage as their friend.
    remoteVideo.srcObject = localStream;
    // Keep the sharer's own screen audio from playing twice; the remote viewer still receives the audio track.
    remoteVideo.muted = true;
    localVideo.play().catch(() => {});
    remoteVideo.play().catch(() => {});
    sharingBadge.hidden = false;
    shareButton.disabled = true;
    stopButton.disabled = false;
    updateRemoteView();
    const [videoTrack] = localStream.getVideoTracks();
    if (videoTrack) videoTrack.addEventListener('ended', stopSharing, { once: true });
    socket.emit('ready-to-share');
    await makeOffer();
  } catch (error) {
    if (error.name !== 'NotAllowedError') addSystemMessage('Ekran paylaşımı başlatılamadı. Lütfen tekrar deneyin.');
  }
}

function stopSharing() {
  if (!localStream) return;
  localStream.getTracks().forEach((track) => track.stop());
  localStream = undefined;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  sharingBadge.hidden = true;
  shareButton.disabled = false;
  stopButton.disabled = true;
  if (peerConnection) {
    peerConnection.close();
    peerConnection = undefined;
  }
  updateRemoteView();
  addSystemMessage('Ekran paylaşımınız durduruldu.');
}

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const requestedRoom = roomInput.value.trim().toUpperCase();
  socket.emit('join-room', requestedRoom, (result) => {
    if (!result?.ok) { lobbyError.textContent = result?.message || 'Odaya katılınamadı.'; return; }
    roomCode = result.room;
    activeRoomCode.textContent = roomCode;
    lobby.hidden = true;
    roomView.hidden = false;
    showWelcome();
    peerAvailable = result.peerPresent;
    setStatus(peerAvailable ? 'Arkadaş bağlandı' : 'Arkadaş bekleniyor', peerAvailable);
    if (peerAvailable) addSystemMessage('Arkadaşınız odaya bağlı. Paylaşımı başlatabilirsiniz.');
  });
});

document.querySelector('#create-room').addEventListener('click', () => {
  roomInput.value = `FILM-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  roomInput.focus();
});

document.querySelector('#copy-room').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(roomCode); addSystemMessage('Oda kodu panoya kopyalandı.'); } catch { addSystemMessage(`Oda kodunuz: ${roomCode}`); }
});

shareButton.addEventListener('click', startSharing);
stopButton.addEventListener('click', stopSharing);
chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', text);
  addChatMessage(text, true);
  chatInput.value = '';
});
document.querySelectorAll('.reaction-button').forEach((button) => {
  button.addEventListener('click', () => {
    const reaction = button.dataset.reaction;
    socket.emit('reaction', reaction);
    addReaction(reaction, true);
  });
});

socket.on('peer-joined', () => {
  peerAvailable = true;
  setStatus('Arkadaş bağlandı', true);
  addSystemMessage('Arkadaşınız odaya katıldı.');
  // The user already sharing becomes the offerer when the second person arrives.
  makeOffer().catch(() => addSystemMessage('Ekran paylaşımı bağlantısı kurulamadı.'));
});
socket.on('peer-left', () => { peerAvailable = false; setStatus('Arkadaş ayrıldı'); addSystemMessage('Arkadaşınız odadan ayrıldı.'); });
socket.on('reaction', (reaction) => addReaction(reaction, false));
socket.on('chat-message', (message) => addChatMessage(message, false));
socket.on('ready-to-share', () => { peerAvailable = true; addSystemMessage('Arkadaşınız ekran paylaşımına başladı.'); });
socket.on('offer', async (offer) => {
  try {
    const peer = createPeerConnection();
    await peer.setRemoteDescription(offer);
    await flushCandidates();
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit('answer', peer.localDescription);
  } catch { addSystemMessage('Ekran paylaşımı bağlantısı kurulamadı.'); }
});
socket.on('answer', async (answer) => { if (peerConnection) { await peerConnection.setRemoteDescription(answer); await flushCandidates(); } });
socket.on('ice-candidate', async (candidate) => {
  try { if (peerConnection?.remoteDescription) await peerConnection.addIceCandidate(candidate); else pendingCandidates.push(candidate); } catch { /* Ignore stale candidates. */ }
});
window.addEventListener('beforeunload', () => { if (localStream) localStream.getTracks().forEach((track) => track.stop()); });
