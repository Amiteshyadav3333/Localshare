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

// Auto-detect All Local IP Addresses
function getAllLocalIPs() {
    const ips = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push(net.address);
            }
        }
    }
    return ips.length > 0 ? ips : ['localhost'];
}

const PORT = process.env.PORT || 3000;
const IPs = getAllLocalIPs();

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 LocalShare Server Started!`);
    console.log(`💻 Local URL:   http://localhost:${PORT}`);
    console.log(`📡 Network URLs:`);
    IPs.forEach(ip => {
        console.log(`   👉 http://${ip}:${PORT}`);
    });
    console.log(`\n💡 If it doesn't open on other devices, make sure they are on the same Wi-Fi!\n`);
});
