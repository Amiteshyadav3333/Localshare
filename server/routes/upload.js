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

module.exports = router;
