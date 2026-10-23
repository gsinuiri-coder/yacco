import type { OfflineStore } from "./offline-store";

/**
 * La base del celular se abre recién la primera vez que se usa, una sola vez.
 * Si abrirla falla, el próximo uso lo intenta de nuevo en vez de quedarse con
 * el error para siempre.
 */
export function lazyOfflineStore(open: () => Promise<OfflineStore>): OfflineStore {
  let opening: Promise<OfflineStore> | null = null;

  function opened(): Promise<OfflineStore> {
    opening ??= open().catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  }

  return {
    async saveSnapshot(snapshot) {
      return (await opened()).saveSnapshot(snapshot);
    },
    async loadSnapshot() {
      return (await opened()).loadSnapshot();
    },
    async clearSnapshot() {
      return (await opened()).clearSnapshot();
    },
    async addOperation(envelope, driverId) {
      return (await opened()).addOperation(envelope, driverId);
    },
    async listOperations(driverId) {
      return (await opened()).listOperations(driverId);
    },
    async setOperationState(id, state, reason) {
      return (await opened()).setOperationState(id, state, reason);
    },
  };
}
