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
    async addOperation(envelope) {
      return (await opened()).addOperation(envelope);
    },
    async listOperations() {
      return (await opened()).listOperations();
    },
    async setOperationState(id, state, reason) {
      return (await opened()).setOperationState(id, state, reason);
    },
  };
}
