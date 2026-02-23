/**
 * WebRTC P2P Transfer Logic
 */
let currentPeer = null;    // socket ID of current target connection
let peerConnection = null;
let dataChannel = null;

// High Speed Transfer Configuration
const CHUNK_SIZE = 65536; // 64KB WebRTC packets (maximum optimal)
const FILE_READ_SIZE = 1024 * 1024 * 8; // Read 8MB batches from disk at once

// Receiving File state
let receiveBuffer = [];
let receivedSize = 0;
let expectedTotalSize = 0;
let receivingFileMeta = null;

// Batch queue state
let transferQueue = [];
let currentTransferPassword = null;

function startBatchTransfer(files, targetId, password) {
    transferQueue = [...files];
    currentPeer = targetId;
    currentTransferPassword = password;
    processTransferQueue();
}

function processTransferQueue() {
    if (transferQueue.length === 0) return;
    const nextFile = transferQueue.shift();
    sendFileWebRTC(nextFile, currentTransferPassword);
}

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

function initWebRTC(targetSocketId) {
    currentPeer = targetSocketId;
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-ice-candidate', {
                target: currentPeer,
                candidate: event.candidate
            });
        }
    };

    // When channel is created by the OTHER peer, handle it
    peerConnection.ondatachannel = (event) => {
        const receiveChannel = event.channel;
        receiveChannel.binaryType = 'arraybuffer';
        setupDataChannelEvents(receiveChannel);
    };
}

// Offer is created by sender
async function createOffer(targetSocketId) {
    initWebRTC(targetSocketId);

    dataChannel = peerConnection.createDataChannel('fileTransfer');
    dataChannel.binaryType = 'arraybuffer';
    setupDataChannelEvents(dataChannel);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('webrtc-offer', {
        target: targetSocketId,
        offer: offer
    });
}

// Receiver handles offer and creates answer
async function handleReceiveOffer(senderSocketId, offer) {
    initWebRTC(senderSocketId);

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('webrtc-answer', {
        target: senderSocketId,
        answer: answer
    });
}

// Sender receives answer
async function handleReceiveAnswer(answer) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

// Handle arriving ICE candidate
async function handleIceCandidate(candidate) {
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error adding received ice candidate', e);
        }
    }
}

// Central Data Channel events
function setupDataChannelEvents(channel) {
    channel.onopen = () => {
        console.log("WebRTC Data Channel Open!");
    };

    channel.onclose = () => {
        console.log("WebRTC Data Channel Closed!");
    };

    channel.onmessage = (event) => {
        if (typeof event.data === 'string') {
            // Metadata message
            try {
                const meta = JSON.parse(event.data);
                if (meta.type === 'metadata') {
                    if (meta.password) {
                        const answer = prompt(`Incoming file "${meta.name}" is locked! Enter password:`);
                        if (answer !== meta.password) {
                            alert(`Incorrect password for ${meta.name}! Transfer aborted.`);
                            receivingFileMeta = null;
                            return;
                        }
                    }
                    receivingFileMeta = meta;
                    expectedTotalSize = meta.size;
                    receivedSize = 0;
                    receiveBuffer = [];
                    addTransferItem(meta.name, meta.size, 'receiving');
                }
            } catch (e) {
                console.error("String parsed err:", e);
            }
        } else {
            // Binary chunk message
            if (!receivingFileMeta) return; // Drop chunk if password failed

            receiveBuffer.push(event.data);
            receivedSize += event.data.byteLength;

            const progress = (receivedSize / expectedTotalSize) * 100;
            updateTransferProgress(receivingFileMeta.name, progress);

            if (receivedSize === expectedTotalSize) {
                // Transfer Complete
                finalizeReceive();
            }
        }
    };
}

// Actually File Sending Logic (Ultra-High Speed)
function sendFileWebRTC(file, password) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
        alert("WebRTC connection not open. Try reconnecting!");
        return;
    }

    addTransferItem(file.name, file.size, 'sending');
    socket.emit('transfer-started', { target: currentPeer, fileName: file.name, fileSize: file.size });

    // 1. Send Metadata
    dataChannel.send(JSON.stringify({
        type: 'metadata',
        name: file.name,
        size: file.size,
        mime: file.type,
        password: password
    }));

    // 2. High-Speed Super Chunk Streaming
    let fileOffset = 0;
    const reader = new FileReader();

    // Aggressive Buffer Threshold for maximum speed (8MB buffer)
    dataChannel.bufferedAmountLowThreshold = 1024 * 1024 * 8;

    const readNextFileSlice = () => {
        const slice = file.slice(fileOffset, fileOffset + FILE_READ_SIZE);
        reader.readAsArrayBuffer(slice);
    };

    let lastProgressUpdate = 0;

    reader.onload = (e) => {
        const buffer = e.target.result;
        let bufferOffset = 0;

        const pushToChannel = () => {
            while (bufferOffset < buffer.byteLength) {
                // If WebRTC internal buffer is too full, wait for it to drain
                if (dataChannel.bufferedAmount > dataChannel.bufferedAmountLowThreshold) {
                    dataChannel.onbufferedamountlow = () => {
                        dataChannel.onbufferedamountlow = null;
                        pushToChannel();
                    };
                    return;
                }

                // Push chunk to network
                const end = Math.min(bufferOffset + CHUNK_SIZE, buffer.byteLength);
                const chunk = buffer.slice(bufferOffset, end);

                try {
                    dataChannel.send(chunk);
                } catch (err) {
                    console.error("Buffer full error, retrying", err);
                    return;
                }

                bufferOffset += chunk.byteLength;
                fileOffset += chunk.byteLength;

                // Throttled UI Updates to prevent browser freezing with fast speed
                const now = Date.now();
                if (now - lastProgressUpdate > 100) {
                    const progress = (fileOffset / file.size) * 100;
                    updateTransferProgress(file.name, progress);
                    lastProgressUpdate = now;
                }
            }

            // Finished this 8MB memory batch, read the next one from disk
            if (fileOffset < file.size) {
                readNextFileSlice();
            } else {
                updateTransferProgress(file.name, 100);
                console.log("File completely sent to network buffer!");
                updateTransferStatus(file.name, 'Sent Completely!');
                setTimeout(processTransferQueue, 500); // Send next file in batch
            }
        };

        pushToChannel();
    };

    // Start ultra-fast streaming
    readNextFileSlice();
}

function finalizeReceive() {
    const blob = new Blob(receiveBuffer, { type: receivingFileMeta.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    // Provide download capability on UI
    makeTransferDownloadable(receivingFileMeta.name, url);
    updateTransferStatus(receivingFileMeta.name, 'Received Successfully!');

    receiveBuffer = [];
    receivedSize = 0;
}
