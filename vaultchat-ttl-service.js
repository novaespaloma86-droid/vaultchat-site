/**
 * TTLService — Serviço de expiração automática de mensagens
 *
 * Dois mecanismos complementares:
 * 1. setTimeout individual por mensagem (precisão)
 * 2. Cleanup loop a cada 60s (segurança, garante que nada escape)
 *
 * Em produção com Redis:
 *   SET msg:{id} {ciphertext} EX {seconds}
 *   SUBSCRIBE __keyevent@0__:expired → notifica clientes via WebSocket
 * O Redis cuida do TTL nativamente, sem necessidade deste serviço.
 */

class TTLService {
  constructor() {
    // Map<messageId, timeoutHandle>
    this.timers = new Map();
    this.cleanupInterval = null;
  }

  /**
   * Agendar destruição de uma mensagem
   * @param {string} messageId
   * @param {string} roomId
   * @param {Date} expiresAt
   * @param {Function} onExpire — callback chamado quando expirar (para broadcast WS)
   */
  schedule(messageId, roomId, expiresAt, onExpire) {
    const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
    if (msUntilExpiry <= 0) {
      onExpire();
      return;
    }

    // Limitar a 30 dias (setTimeout não funciona bem com valores muito grandes)
    const MAX_TIMEOUT = 30 * 24 * 60 * 60 * 1000;
    if (msUntilExpiry > MAX_TIMEOUT) {
      console.log(`[TTL] Mensagem ${messageId} com TTL > 30d — será gerenciada pelo cleanup loop`);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(messageId);
      console.log(`[TTL] Mensagem ${messageId} expirou e foi destruída`);
      onExpire();
    }, msUntilExpiry);

    this.timers.set(messageId, timer);
  }

  /**
   * Cancelar TTL de uma mensagem (ex: deletada manualmente)
   */
  cancel(messageId) {
    const timer = this.timers.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(messageId);
    }
  }

  /**
   * Loop de limpeza periódico — garante que mensagens expiradas sejam removidas
   * mesmo se o servidor reiniciou e perdeu os timers em memória
   */
  startCleanupLoop(messagesStore, onExpire, intervalMs = 60_000) {
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      let totalRemoved = 0;

      for (const [roomId, roomMessages] of messagesStore.entries()) {
        const expired = roomMessages.filter(msg =>
          msg.expiresAt && new Date(msg.expiresAt) <= now
        );

        if (expired.length > 0) {
          const active = roomMessages.filter(msg =>
            !msg.expiresAt || new Date(msg.expiresAt) > now
          );
          messagesStore.set(roomId, active);
          totalRemoved += expired.length;

          for (const msg of expired) {
            onExpire(roomId, msg.id);
          }
        }
      }

      if (totalRemoved > 0) {
        console.log(`[TTL] Cleanup: ${totalRemoved} mensagens expiradas removidas`);
      }
    }, intervalMs);

    console.log(`[TTL] Cleanup loop iniciado (intervalo: ${intervalMs / 1000}s)`);
  }

  stopCleanupLoop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Estatísticas para monitoramento
   */
  stats() {
    return {
      activeTimers: this.timers.size,
      cleanupRunning: !!this.cleanupInterval,
    };
  }
}

// Singleton
module.exports = new TTLService();
