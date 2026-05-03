const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const os = require('os');

// Set up Multer for disk storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Saving files in 'uploads' directory outside the project root can be good, 
        // but let's use a server/uploads directory for simplicity.
        const dest = path.join(__dirname, '../../uploads');
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage: storage });

// Provide network IP for QR and download links
function getLocalIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

router.get('/network-info', (req, res) => {
    const port = process.env.PORT || 3000;
    res.json({ url: `http://${getLocalIP()}:${port}` });
});

router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    res.json({ success: true, file: req.file.filename, originalName: req.file.originalname });
});

router.get('/download/:name', (req, res) => {
    const fp = path.join(__dirname, '../../uploads', req.params.name);
    res.download(fp);
});

// Online Streaming Relay Map: shareCode -> { res: ResponseObject, timer: Timeout }
const activeRelays = new Map();

// Sender initiates relay
router.post('/relay/:shareCode', (req, res) => {
    const { shareCode } = req.params;
    console.log(`📡 Relay initiated for code: ${shareCode}`);

    // Wait for receiver to connect (max 2 minutes)
    let timeout = setTimeout(() => {
        if (activeRelays.has(shareCode)) {
            const relay = activeRelays.get(shareCode);
            if (relay.res) relay.res.status(408).send('Relay timed out');
            activeRelays.delete(shareCode);
        }
    }, 120000);

    activeRelays.set(shareCode, { senderReq: req, senderRes: res, timeout });

    req.on('close', () => {
        console.log(`📡 Sender closed for code: ${shareCode}`);
        const relay = activeRelays.get(shareCode);
        if (relay && relay.receiverRes) relay.receiverRes.end();
        activeRelays.delete(shareCode);
    });
});

// Receiver connects to relay
router.get('/relay/:shareCode', (req, res) => {
    const { shareCode } = req.params;
    const relay = activeRelays.get(shareCode);

    if (!relay || !relay.senderReq) {
        return res.status(404).send('Share code not found or sender not ready');
    }

    console.log(`📡 Receiver connected for code: ${shareCode}`);
    
    // Clear timeout as transfer is starting
    clearTimeout(relay.timeout);

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="shared-file"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    // Pipe sender request directly to receiver response
    relay.senderReq.pipe(res);

    relay.senderReq.on('end', () => {
        relay.senderRes.status(200).json({ success: true });
        activeRelays.delete(shareCode);
    });

    req.on('close', () => {
        relay.senderReq.destroy();
        activeRelays.delete(shareCode);
    });
});

module.exports = router;
