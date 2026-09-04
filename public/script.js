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
const messages = document.querySelector('#messages');
const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');

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

function addMessage(text, type) {
  const message = document.createElement('div');
  message.className = `message ${type}`;
  message.textContent = text;
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function addSystemMessage(text) {
  const message = document.createElement('div');
  message.className = 'system-message';
  message.textContent = text;
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function updateRemoteView() {
  const hasRemoteVideo = remoteVideo.srcObject?.getVideoTracks().some((track) => track.readyState === 'live');
  placeholder.hidden = Boolean(hasRemoteVideo || localStream);
}

function createPeerConnection() {
  if (peerConnection) return peerConnection;
  peerConnection = new RTCPeerConnection(peerConfig);
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('ice-candidate', candidate);
  };
  peerConnection.ontrack = ({ streams }) => {
    remoteVideo.srcObject = streams[0];
    remoteVideo.play().catch(() => {});
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
    localVideo.play().catch(() => {});
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
  addMessage(text, 'mine');
  chatInput.value = '';
});

socket.on('peer-joined', () => {
  peerAvailable = true;
  setStatus('Arkadaş bağlandı', true);
  addSystemMessage('Arkadaşınız odaya katıldı.');
  // The user already sharing becomes the offerer when the second person arrives.
  makeOffer().catch(() => addSystemMessage('Ekran paylaşımı bağlantısı kurulamadı.'));
});
socket.on('peer-left', () => { peerAvailable = false; setStatus('Arkadaş ayrıldı'); addSystemMessage('Arkadaşınız odadan ayrıldı.'); });
socket.on('chat-message', (text) => addMessage(text, 'theirs'));
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
