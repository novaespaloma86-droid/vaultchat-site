# VaultChat — Comunicação Segura para Equipes

App de mensagens B2B com criptografia E2E, TTL por mensagem e zero logs.

---

## Estrutura do projeto

```
vaultchat/
├── landing/          ← Landing page de vendas (HTML puro, sem dependências)
│   └── index.html
└── backend/          ← API REST + WebSocket
    ├── src/
    │   ├── server.js           ← Entry point + WebSocket
    │   ├── models/
    │   │   └── store.js        ← Store em memória (→ PostgreSQL + Redis em produção)
    │   ├── routes/
    │   │   ├── auth.js         ← Register, login, logout
    │   │   ├── rooms.js        ← CRUD de salas
    │   │   └── messages.js     ← Histórico + deleção
    │   ├── middleware/
    │   │   └── auth.js         ← JWT middleware
    │   └── services/
    │       └── ttl.js          ← Auto-destruição de mensagens
    ├── .env.example
    └── package.json
```

---

## Rodar o backend

```bash
cd backend
cp .env.example .env
# Edite .env com JWT_SECRET real
npm install
node src/server.js
```

API disponível em: `http://localhost:4000/api`

---

## API Reference

### Auth
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/auth/register | Criar conta (envia publicKey) |
| POST | /api/auth/login | Login → retorna JWT |
| POST | /api/auth/logout | Invalidar sessão |
| GET  | /api/auth/me | Dados do usuário logado |

### Salas
| Método | Rota | Descrição |
|--------|------|-----------|
| GET  | /api/rooms | Listar minhas salas |
| POST | /api/rooms | Criar sala |
| GET  | /api/rooms/:id | Detalhes + membros |
| POST | /api/rooms/:id/invite | Gerar link de convite |
| POST | /api/rooms/:id/join | Entrar com código |
| DELETE | /api/rooms/:id | Destruir sala (admin) |

### Mensagens
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/messages/:roomId | Histórico (ciphertexts) |
| DELETE | /api/messages/:roomId/:id | Deletar mensagem |
| DELETE | /api/messages/room/:roomId | Limpar sala (admin) |

### WebSocket
Conectar: `ws://localhost:4000?token={JWT}`

**Eventos enviados pelo cliente:**
```json
{ "type": "send_message", "roomId": "...", "ciphertext": "...", "encryptedKey": "...", "ttlMs": 86400000 }
{ "type": "mark_read", "roomId": "...", "messageId": "..." }
{ "type": "typing", "roomId": "..." }
```

**Eventos recebidos do servidor:**
```json
{ "type": "new_message", "message": { ... } }
{ "type": "message_expired", "messageId": "...", "roomId": "..." }
{ "type": "message_read", "messageId": "...", "userId": "..." }
{ "type": "user_typing", "userId": "..." }
```

---

## Arquitetura de segurança

```
Cliente A                    Servidor                    Cliente B
────────                     ────────                    ────────
Gera par de chaves           Armazena apenas:            Gera par de chaves
  (publicKey, privateKey)     - publicKey dos users       (publicKey, privateKey)
                              - ciphertexts               
Criptografa mensagem ──────► Roteia ciphertext ─────────► Decripta com privateKey
  com publicKey de B          (nunca decripta)              (só B consegue ler)
```

**Princípios:**
- Servidor NUNCA armazena plaintext
- Chaves privadas NUNCA saem do dispositivo
- TTL apaga ciphertexts automaticamente
- Zero logs de conteúdo no servidor

---

## Roadmap para produção

### Fase 1 — MVP (3 meses)
- [ ] Substituir store em memória por PostgreSQL + Redis
- [ ] Implementar Signal Protocol real (libsodium no cliente)
- [ ] App mobile React Native (iOS + Android)
- [ ] Deploy em VPS própria (Hetzner ~€20/mês)

### Fase 2 — Escala (mês 4-6)
- [ ] Bloqueio de screenshot nativo (DRM)
- [ ] Compartilhamento de arquivos criptografados
- [ ] Auditoria de acesso (LGPD)
- [ ] SSO / SAML para Enterprise

### Fase 3 — Enterprise (mês 7+)
- [ ] Deploy on-premise (cliente instala no próprio servidor)
- [ ] Integração com sistemas corporativos
- [ ] SLA e suporte dedicado

---

## Modelo de negócio

| Plano | Preço/mês | Usuários | Margem estimada |
|-------|-----------|----------|-----------------|
| Starter | R$ 197 | até 5 | ~85% |
| Business | R$ 597 | até 25 | ~88% |
| Enterprise | R$ 1.997+ | ilimitado | ~90% |

**Meta conservadora:** 50 clientes Business = R$ 29.850/mês recorrente

---

## Stack recomendada para produção

| Camada | Tecnologia | Custo/mês |
|--------|-----------|-----------|
| Servidor | Hetzner VPS (CX31) | €12 |
| Banco de dados | PostgreSQL (gerenciado) | €20 |
| Cache + TTL | Redis Cloud | €15 |
| Mobile | React Native (Expo) | — |
| Deploy | Docker + Nginx | — |
| **Total infra** | | **~R$ 280** |
