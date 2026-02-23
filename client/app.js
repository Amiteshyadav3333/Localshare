const socket = io();

// UI Elements
const socketStatus = document.getElementById('socket-status');
const statusIndicator = document.querySelector('.indicator');
const deviceList = document.getElementById('device-list');
const networkUrlEl = document.getElementById('network-url');
const qrCodeImg = document.getElementById('qr-code');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const transferList = document.getElementById('transfer-list');
const template = document.getElementById('transfer-item-template');

// Context logic
let myId = null;
let allUsers = [];

socket.on('connect', () => {
    socketStatus.textContent = 'Online';
    statusIndicator.classList.add('online');
    myId = socket.id;
    console.log("Connected to server", myId);

    // Fetch network url to display and gen QR
    fetch('/api/network-info')
        .then(res => res.json())
        .then(data => {
            networkUrlEl.textContent = data.url;
            generateQR(data.url);
        });
});

socket.on('disconnect', () => {
    socketStatus.textContent = 'Disconnected...';
    statusIndicator.classList.remove('online');
});

// Update Users list
socket.on('users-update', (users) => {
    allUsers = users.filter(u => u.id !== myId);
    renderDeviceList();
});

function renderDeviceList() {
    deviceList.innerHTML = '';

    if (allUsers.length === 0) {
        deviceList.innerHTML = `<li class="empty-state">No other devices found on this network.</li>`;
        return;
    }

    allUsers.forEach(u => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <strong>${u.device}</strong>
                <div style="font-size: 0.8rem; color: var(--text-secondary)">ID: ${u.id.substring(0, 5)}</div>
            </div>
            <button class="btn-primary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; margin:0;" onclick="connectAndSend('${u.id}')">Select</button>
        `;
        deviceList.appendChild(li);
    });
}

// Generate QR helper
function generateQR(url) {
    // We already have qrcode in package.json but not loaded in client. 
    // Wait, let's just use an open API, as the library is commonjs.
    qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}&color=63-66-241&bgcolor=255-255-255`;
}

// --- WEBRTC SIGNALING ROUTING ---

socket.on('webrtc-offer', async (data) => {
    console.log("Received Offer from", data.sender);
    await handleReceiveOffer(data.sender, data.offer);
});

socket.on('webrtc-answer', async (data) => {
    console.log("Received Answer from", data.sender);
    await handleReceiveAnswer(data.answer);
});

socket.on('webrtc-ice-candidate', async (data) => {
    await handleIceCandidate(data.candidate);
});

// --- UI TRANSFER TRACKING ---

function connectAndSend(targetId) {
    // If we have a file selected, send it to this target
    if (fileInput.files.length > 0) {
        const files = Array.from(fileInput.files);
        const transferPassword = document.getElementById('transfer-password').value || null;

        // Setup direct connection
        createOffer(targetId);

        // In a real app we'd wait for connection open, 
        // Here we give it a tiny delay to negotiate then trigger WebRTC datachannel send
        setTimeout(() => {
            if (dataChannel && dataChannel.readyState === 'open') {
                startBatchTransfer(files, targetId, transferPassword);
            } else {
                // Polling or fallback to HTTP upload
                let attempts = 0;
                let interval = setInterval(() => {
                    attempts++;
                    if (dataChannel && dataChannel.readyState === 'open') {
                        clearInterval(interval);
                        startBatchTransfer(files, targetId, transferPassword);
                    } else if (attempts > 5) {
                        clearInterval(interval);
                        alert("P2P connection timed out. Falling back to HTTP.");
                        files.forEach(f => httpFileUpload(f, targetId, transferPassword));
                    }
                }, 500);
            }
        }, 1000);

    } else {
        alert("Please Select a file first by clicking Browse or Dragging.");
    }
}

// Format Size Helper
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Add Item to UI
function addTransferItem(fileName, fileSize, status) {
    // clone template
    const clone = template.content.cloneNode(true);
    const item = clone.querySelector('.transfer-item');
    item.dataset.filename = fileName; // simple tracking

    clone.querySelector('.file-name').textContent = fileName;
    clone.querySelector('.file-size').textContent = formatBytes(fileSize);
    clone.querySelector('.transfer-status').textContent = status === 'sending' ? 'Sending...' : 'Receiving...';

    transferList.prepend(clone);
}

// Update UI Progress
function updateTransferProgress(fileName, percent) {
    const items = transferList.querySelectorAll('.transfer-item');
    items.forEach(item => {
        if (item.dataset.filename === fileName) {
            item.querySelector('.progress-bar').style.width = `${percent}%`;
            if (percent === 100) {
                item.querySelector('.transfer-status').textContent = `Finalizing...`;
            } else {
                item.querySelector('.transfer-status').textContent = `${Math.round(percent)}%`;
            }
        }
    });
}

function updateTransferStatus(fileName, message) {
    const items = transferList.querySelectorAll('.transfer-item');
    items.forEach(item => {
        if (item.dataset.filename === fileName) {
            item.querySelector('.transfer-status').textContent = message;
            item.querySelector('.progress-bar').style.width = `100%`;
            item.querySelector('.progress-bar').style.backgroundColor = 'var(--success-color)';
        }
    });
}

function makeTransferDownloadable(fileName, url, saveAsName) {
    const items = transferList.querySelectorAll('.transfer-item');
    items.forEach(item => {
        if (item.dataset.filename === fileName) {
            const btn = document.createElement('a');
            btn.href = url;
            btn.download = saveAsName || fileName;
            btn.className = 'download-btn';
            btn.textContent = 'Save File';
            item.querySelector('.transfer-actions').appendChild(btn);

            // Automatically click to save file directly to gallery/downloads
            setTimeout(() => {
                btn.click();
            }, 500);
        }
    });
}

// --- FILE DRAG & DROP UI INTERACTIONS ---
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});
['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});

dropZone.addEventListener('drop', (e) => {
    let dt = e.dataTransfer;
    let files = dt.files;
    fileInput.files = files; // Assign to input

    if (files.length > 0) {
        alert(`${files[0].name} selected! Choose a device to send.`);
    }
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
        alert(`${fileInput.files[0].name} selected! Choose a device to send.`);
    }
});


// HTTP Fallback (If WebRTC fails to establish)
function httpFileUpload(file, targetId, password) {
    alert("Using HTTP server relay...");

    addTransferItem(file.name, file.size, 'sending');
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percent = (e.loaded / e.total) * 100;
            updateTransferProgress(file.name, percent);
        }
    };

    xhr.onload = () => {
        if (xhr.status === 200) {
            updateTransferStatus(file.name, 'Uploaded to server!');
            const res = JSON.parse(xhr.responseText);
            // Notify target to download via socket
            socket.emit('webrtc-offer', {
                target: targetId,
                offer: { type: 'http-fallback', file: res.file, originalName: res.originalName, password: password }
            });
        }
    };

    xhr.send(formData);
}

// Hack: hijack the offer to support HTTP fallback notification
const originalHandleOffer = handleReceiveOffer;
async function customOfferHandle(sender, offer) {
    if (offer.type === 'http-fallback') {
        const displayName = offer.originalName || offer.file;
        alert("Received file via HTTP Relay!");
        addTransferItem(offer.file, 0, 'receiving');
        updateTransferStatus(offer.file, 'Ready for download');

        if (offer.password) {
            const userInput = prompt(`File "${displayName}" is locked! Enter password:`);
            if (userInput !== offer.password) {
                alert("Incorrect password! Cannot open the file.");
                updateTransferStatus(offer.file, 'Auth Failed');
                return;
            }
        }

        makeTransferDownloadable(offer.file, `/api/download/${offer.file}`, displayName);
    } else {
        await originalHandleOffer(sender, offer);
    }
}
window.handleReceiveOffer = customOfferHandle; // override global
