/**
 * VaultChat Backend — Servidor principal
 * Stack: Node.js + Express + WebSocket + JWT
 * 
 * Arquitetura de segurança:
 * - Mensagens NUNCA são salvas em texto claro no servidor
 * - Servidor armazena apenas cyphertext (já criptografado no cliente)
 * - TTL gerenciado via timeout + cleanup periódico
 * - Chaves de criptografia existem SOMENTE nos dispositivos dos usuários
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const messageRoutes = require('./routes/messages');
const { authMiddleware } = require('./middleware/auth');
const TTLService = require('./services/ttl');
const { rooms, messages } = require('./models/store');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '10mb' }));

// ─── Rotas ───────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/rooms',    authMiddleware, roomRoutes);
app.use('/api/messages', authMiddleware, messageRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    message: 'VaultChat server running',
  });
});

// ─── WebSocket: tempo real ────────────────────────────────────────────────────
// Mapa: userId → WebSocket connection
const clients = new Map();

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  
  let userId;
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch {
    ws.close(4001, 'Unauthorized');
    return;
  }

  clients.set(userId, ws);
  console.log(`[WS] User ${userId} connected`);

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      handleWSMessage(userId, data);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid payload' }));
    }
  });

  ws.on('close', () => {
    clients.delete(userId);
    console.log(`[WS] User ${userId} disconnected`);
  });

  ws.send(JSON.stringify({ type: 'connected', userId }));
});

/**
 * Distribuir mensagem para membros online da sala
 * O servidor nunca vê o conteúdo — apenas roteia o ciphertext
 */
function handleWSMessage(senderId, data) {
  if (data.type === 'send_message') {
    const room = rooms.get(data.roomId);
    if (!room) return;
    if (!room.members.includes(senderId)) return;

    const messageId = require('uuid').v4();
    const expiresAt = data.ttlMs ? new Date(Date.now() + data.ttlMs) : null;

    const msg = {
      id: messageId,
      roomId: data.roomId,
      senderId,
      // IMPORTANTE: ciphertext já vem criptografado pelo cliente
      // O servidor nunca decripta — apenas armazena e roteia
      ciphertext: data.ciphertext,
      encryptedKey: data.encryptedKey, // chave de sessão encriptada por chave pública do destinatário
      createdAt: new Date(),
      expiresAt,
      delivered: false,
    };

    // Salvar na store temporária (nunca persiste além do TTL)
    if (!messages.has(data.roomId)) messages.set(data.roomId, []);
    messages.get(data.roomId).push(msg);

    // Agendar destruição automática
    if (expiresAt) {
      TTLService.schedule(messageId, data.roomId, expiresAt, () => {
        broadcastToRoom(data.roomId, {
          type: 'message_expired',
          messageId,
          roomId: data.roomId,
        });
      });
    }

    // Broadcast para membros online da sala
    broadcastToRoom(data.roomId, {
      type: 'new_message',
      message: {
        id: msg.id,
        roomId: msg.roomId,
        senderId: msg.senderId,
        ciphertext: msg.ciphertext,
        encryptedKey: msg.encryptedKey,
        createdAt: msg.createdAt,
        expiresAt: msg.expiresAt,
      },
    }, senderId);
  }

  if (data.type === 'mark_read') {
    broadcastToRoom(data.roomId, {
      type: 'message_read',
      messageId: data.messageId,
      userId: senderId,
    }, senderId);
  }

  if (data.type === 'typing') {
    broadcastToRoom(data.roomId, {
      type: 'user_typing',
      userId: senderId,
    }, senderId);
  }
}

function broadcastToRoom(roomId, payload, excludeUserId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const serialized = JSON.stringify(payload);
  for (const memberId of room.members) {
    if (memberId === excludeUserId) continue;
    const ws = clients.get(memberId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

// ─── TTL Cleanup periódico (a cada 60s) ──────────────────────────────────────
TTLService.startCleanupLoop(messages, (roomId, messageId) => {
  broadcastToRoom(roomId, { type: 'message_expired', messageId, roomId });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`\n🔒 VaultChat Server rodando na porta ${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   REST API:  http://localhost:${PORT}/api`);
  console.log(`   Modo:      ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { server, broadcastToRoom };
