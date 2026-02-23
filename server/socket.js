const { Server } = require('socket.io');

module.exports = function initSocket(server) {
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    // online users mapping: socket.id -> metadata
    let onlineUsers = {};

    io.on('connection', (socket) => {
        console.log(`🔌 New connection: ${socket.id}`);

        // Add user to online list
        onlineUsers[socket.id] = { id: socket.id, device: socket.handshake.query.device || 'Unknown Device' };

        // Broadcast user list to all
        io.emit('users-update', Object.values(onlineUsers));

        // WebRTC Signaling: offer
        socket.on('webrtc-offer', (data) => {
            io.to(data.target).emit('webrtc-offer', {
                sender: socket.id,
                offer: data.offer
            });
        });

        // WebRTC Signaling: answer
        socket.on('webrtc-answer', (data) => {
            io.to(data.target).emit('webrtc-answer', {
                sender: socket.id,
                answer: data.answer
            });
        });

        // WebRTC Signaling: ice-candidate
        socket.on('webrtc-ice-candidate', (data) => {
            io.to(data.target).emit('webrtc-ice-candidate', {
                sender: socket.id,
                candidate: data.candidate
            });
        });

        // Notify file transfer starts
        socket.on('transfer-started', (data) => {
            io.to(data.target).emit('transfer-started', {
                sender: socket.id,
                fileName: data.fileName,
                fileSize: data.fileSize
            });
        });

        socket.on('disconnect', () => {
            console.log(`🔌 Disconnected: ${socket.id}`);
            delete onlineUsers[socket.id];
            io.emit('users-update', Object.values(onlineUsers));
        });
    });

    return io;
};
