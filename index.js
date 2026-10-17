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

// Kredensial Bot Telegram untuk Notifikasi Masuk ke Kepala PKBM (Yusra Gabriel)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8700264271:***';
const KEPALA_CHAT_ID = process.env.KEPALA_CHAT_ID || '537632831';

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

    // ========================================================
    // EVENT LISTENER CHAT MASUK DUA ARAH (INBOUND 2-WAY ENGINE)
    // ========================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe) continue; // Abaikan pesan dari bot sendiri
            
            const from = msg.key.remoteJid;
            if (!from || from.endsWith('@g.us')) continue; // Abaikan chat grup, fokus japri orang tua/siswa

            const senderNumber = from.replace('@s.whatsapp.net', '');
            const pushName = msg.pushName || 'Orang Tua / Siswa';
            const messageText = msg.message?.conversation || 
                                msg.message?.extendedTextMessage?.text || 
                                msg.message?.imageMessage?.caption || '';

            console.log(`📩 [CHAT MASUK] Dari: ${pushName} (${senderNumber}) | Pesan: "${messageText}"`);

            // 1. FORWARD LANGSUNG KE TELEGRAM KEPALA PKBM (YUSRA GABRIEL - CHAT ID: 537632831)
            try {
                const tgPayload = {
                    chat_id: KEPALA_CHAT_ID,
                    text: `📩 *[PESAN MASUK WHATSAPP PKBM]*\n\n` +
                          `👤 *Nama:* ${pushName}\n` +
                          `📱 *Nomor:* \`${senderNumber}\`\n` +
                          `💬 *Pesan:* "${messageText}"\n\n` +
                          `_Balas pesan ini untuk mengirimkan balasan langsung ke WhatsApp orang tua!_`,
                    parse_mode: 'Markdown'
                };

                await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(tgPayload)
                });
            } catch (tgErr) {
                console.error('Gagal meneruskan notifikasi ke Telegram:', tgErr.message);
            }

            // 2. AUTO-REPLY CERDAS PERTANYAAN UMUM (FAQ & REKENING)
            const lower = messageText.toLowerCase();
            let autoReply = '';

            if (lower.includes('rekening') || lower.includes('bayar') || lower.includes('transfer') || lower.includes('pendaftaran')) {
                autoReply = "Assalamu’alaikum Warahmatullahi Wabarakatuh / Salam Hangat,\n\n" +
                            "Terima kasih atas konfirmasinya Bapak/Ibu. Untuk pembayaran biaya administrasi pendaftaran resmi PKBM Permata Unggul, silakan transfer melalui rekening resmi lembaga:\n\n" +
                            "🏦 *Bank BRI Britama Bisnis*\n" +
                            "🔢 *Nomor Rekening: 3077-01-000045-56-9*\n" +
                            "👤 *Atas Nama: PKBM PENDIDIKAN PERMATA UNGGUL*\n\n" +
                            "Setelah transfer berhasil, mohon kirimkan foto/tangkapan layar bukti pembayaran ke nomor WhatsApp ini ya Bapak/Ibu. Begitu tervalidasi, tim kami akan langsung memproses keanggotaan ananda. Terima kasih banyak! 🙏✨";
            } else if (lower.includes('grup') || lower.includes('group')) {
                autoReply = "Halo Bapak/Ibu, salam hangat dari PKBM Permata Unggul.\n\n" +
                            "Untuk bergabung ke dalam *Grup WhatsApp Komunitas Utama PKBM Permata Unggul* (informasi umum sekolah), silakan klik tautan resmi berikut:\n" +
                            "👉 https://chat.whatsapp.com/EfyrIM3HsaGK7XDSnKOarN\n\n" +
                            "Sedangkan untuk *Grup WhatsApp Kelas Belajar*, nomor ananda akan dimasukkan langsung oleh Wali Kelas setelah penempatan rombel tervalidasi. Terima kasih! 🌟";
            } else if (lower.includes('lms') || lower.includes('akun') || lower.includes('login') || lower.includes('password')) {
                autoReply = "Halo Bapak/Ibu,\n\n" +
                            "Untuk akun LMS pembelajaran (pkbmpermataunggul.sch.id), tim Data & Dapodik kami sedang menyiapkan akun untuk ananda. Begitu akun diterbitkan, Username & Password akan langsung kami kirimkan ke nomor ini beserta panduan loginnya ya.\n\n" +
                            "Jika ada kendala fitur, tim kami siap memandu dengan senang hati! 📚✨";
            }

            if (autoReply) {
                try {
                    await sock.sendMessage(from, { text: autoReply });
                    console.log(`🤖 [AUTO-REPLY TERKIRIM] ke ${senderNumber}`);
                } catch (sendErr) {
                    console.error('Gagal mengirim auto-reply:', sendErr.message);
                }
            }
        }
    });
}

connectToWhatsApp();

app.get('/status', (req, res) => {
    if (isReady) return res.json({ status: 'connected' });
    if (currentQR) return res.json({ status: 'qr', qr: currentQR });
    return res.json({ status: 'loading' });
});

// Endpoint kirim broadcast masal dari sistem Report
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

// Endpoint untuk membalas pesan dari Telegram balik ke WhatsApp Orang Tua
app.post('/reply-message', async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Missing to or message' });

    if (!isReady || !sock) {
        return res.status(500).json({ error: 'WhatsApp socket not ready' });
    }

    try {
        let number = to.replace(/\D/g, '');
        if (number.startsWith('0')) number = '62' + number.substring(1);
        const jid = number + '@s.whatsapp.net';

        await sock.sendMessage(jid, { text: message });
        console.log(`[REPLY TERKIRIM] Balasan dari Telegram meluncur ke ${number}: "${message}"`);
        res.json({ success: true, message: `Pesan balasan terkirim ke ${number}` });
    } catch (err) {
        console.error('Gagal mengirim balasan:', err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Server API WhatsApp Gateway 2-Way berjalan di port ${PORT}`);
});
