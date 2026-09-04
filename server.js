const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.on('join-room', (roomCode, callback) => {
    const room = String(roomCode || '').trim().toUpperCase().slice(0, 32);

    if (!room) {
      callback?.({ ok: false, message: 'Geçerli bir oda kodu girin.' });
      return;
    }

    const currentRoom = socket.data.room;
    if (currentRoom && currentRoom !== room) socket.leave(currentRoom);

    const occupants = io.sockets.adapter.rooms.get(room)?.size || 0;
    if (occupants >= 2 && currentRoom !== room) {
      callback?.({ ok: false, message: 'Bu oda dolu. En fazla iki kişi katılabilir.' });
      return;
    }

    socket.join(room);
    socket.data.room = room;
    callback?.({ ok: true, room, peerPresent: occupants > 0 });
    socket.to(room).emit('peer-joined');
  });

  socket.on('chat-message', (message) => {
    const room = socket.data.room;
    const text = String(message || '').trim().slice(0, 1000);
    if (room && text) socket.to(room).emit('chat-message', text);
  });

  socket.on('ready-to-share', () => {
    if (socket.data.room) socket.to(socket.data.room).emit('ready-to-share');
  });

  socket.on('offer', (offer) => {
    if (socket.data.room) socket.to(socket.data.room).emit('offer', offer);
  });

  socket.on('answer', (answer) => {
    if (socket.data.room) socket.to(socket.data.room).emit('answer', answer);
  });

  socket.on('ice-candidate', (candidate) => {
    if (socket.data.room) socket.to(socket.data.room).emit('ice-candidate', candidate);
  });

  socket.on('disconnect', () => {
    if (socket.data.room) socket.to(socket.data.room).emit('peer-left');
  });
});

server.listen(PORT, () => {
  console.log(`Watch Together is running at http://localhost:${PORT}`);
});
