const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const initSocket = require('./socket');
const io = initSocket(server);

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, '../client')));
app.use(express.json());

// Routes
const uploadRoute = require('./routes/upload');
app.use('/api', uploadRoute);

// Auto-detect Local IP Address
function getLocalIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

const PORT = process.env.PORT || 3000;
const IP = getLocalIP();

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 LocalShare Server Started!`);
    console.log(`📡 Network URL: http://${IP}:${PORT}`);
    console.log(`💻 Local URL:   http://localhost:${PORT}\n`);
});
