const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

let sock;
let isReady = false;
let currentQR = '';

async function connectToWhatsApp () {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, 
        logger: pino({ level: 'silent' }) 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if(qr) {
            isReady = false;
            currentQR = await QRCode.toDataURL(qr);
            console.log('QR Code baru di-generate dan siap di-fetch via API.');
        }

        if(connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            isReady = false;
            currentQR = '';
            if(shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('⚠️ Sesi logout/kadaluarsa. Restarting auth...');
                if (fs.existsSync(path.join(__dirname, 'auth_info_baileys'))) {
                    fs.rmSync(path.join(__dirname, 'auth_info_baileys'), { recursive: true, force: true });
                }
                connectToWhatsApp();
            }
        } else if(connection === 'open') {
            isReady = true;
            currentQR = '';
            console.log('✅ BERHASIL! WHATSAPP GATEWAY (BAILEYS) SIAP DIGUNAKAN!');
        }
    });
}

connectToWhatsApp();

app.get('/status', (req, res) => {
    if (isReady) return res.json({ status: 'connected' });
    if (currentQR) return res.json({ status: 'qr', qr: currentQR });
    return res.json({ status: 'loading' });
});

app.post('/send-broadcast', async (req, res) => {
    if (!isReady || !sock) {
        return res.status(500).json({ error: 'WhatsApp belum terhubung. Silakan scan QR code terlebih dahulu.' });
    }

    const { contacts, message } = req.body;
    
    if (!contacts || contacts.length === 0) {
        return res.status(400).json({ error: 'Tidak ada daftar kontak penerima.' });
    }

    console.log(`Menerima perintah pengiriman ke ${contacts.length} kontak...`);

    let successCount = 0;
    let failCount = 0;

    for (const contact of contacts) {
        try {
            let number = contact.whatsapp.replace(/\D/g, '');
            if (number.startsWith('0')) {
                number = '62' + number.substring(1);
            }
            const jid = number + "@s.whatsapp.net";
            const personalizedMessage = message.replace(/{nama}/gi, contact.nama);

            const [result] = await sock.onWhatsApp(jid);
            if(result && result.exists) {
                await sock.sendMessage(result.jid, { text: personalizedMessage });
                console.log(`[SUKSES] Mengirim ke ${contact.nama} (${number})`);
                successCount++;
            } else {
                console.error(`[GAGAL] Mengirim ke ${contact.nama} (${number}): Tidak terdaftar`);
                failCount++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) {
            console.error(`[GAGAL] Mengirim ke ${contact.nama}:`, err.message);
            failCount++;
        }
    }

    res.json({ success: true, successCount, failCount });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Server API WhatsApp Gateway berjalan di port ${PORT}`);
});
