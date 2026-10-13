import { registerEndpoint } from "@nuxt/test-utils/runtime";
import type { MaquilaMovementItem } from "@yacco/shared";
import { effectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSession, signIn } from "../support/session";

const MOVEMENT: MaquilaMovementItem = {
  id: "movement-1",
  customerId: "customer-1",
  customerName: "Cliente",
  containerTypeId: "container-type-1",
  containerTypeName: "Con caño",
  type: "FILLED",
  quantity: 2,
  reversesMovementId: null,
  reason: null,
  recordedById: "user-1",
  recordedByName: "Supervisor",
  occurredAt: "2026-10-13T15:00:00.000Z",
  createdAt: "2026-10-13T15:00:00.000Z",
};

const cleanups: Array<() => void> = [];

describe("useMaquilaVoid", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
    cleanups.push(signIn(["ADMIN"]));
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("exige un movimiento y un motivo de al menos tres caracteres", async () => {
    const afterVoid = vi.fn<() => Promise<void>>();
    const scope = effectScope();
    const state = scope.run(() => useMaquilaVoid(afterVoid))!;

    await state.submitVoid();
    expect(afterVoid).not.toHaveBeenCalled();

    state.openVoidModal(MOVEMENT);
    state.voidReason.value = "x";
    await state.submitVoid();

    expect(state.voidError.value).toBe("El motivo debe tener al menos 3 caracteres");
    expect(state.voidModalOpen.value).toBe(true);
    scope.stop();
  });

  it("anula una vez, cierra el modal y refresca al completar", async () => {
    let finishRequest!: () => void;
    let requests = 0;
    cleanups.push(
      registerEndpoint("/api/v1/maquila/movements/movement-1/void", {
        method: "POST",
        handler: async () => {
          requests += 1;
          await new Promise<void>((resolve) => {
            finishRequest = resolve;
          });
          return {};
        },
      }),
    );
    const afterVoid = vi.fn<() => Promise<void>>().mockResolvedValue();
    const scope = effectScope();
    const state = scope.run(() => useMaquilaVoid(afterVoid))!;
    state.openVoidModal(MOVEMENT);
    state.voidReason.value = "Registro duplicado";

    const first = state.submitVoid();
    await vi.waitFor(() => expect(requests).toBe(1));
    await state.submitVoid();
    expect(requests).toBe(1);
    finishRequest();
    await first;

    expect(state.voidModalOpen.value).toBe(false);
    expect(state.voidSubmitting.value).toBe(false);
    expect(afterVoid).toHaveBeenCalledOnce();
    scope.stop();
  });

  it("muestra el error de la API y permite reintentar", async () => {
    cleanups.push(
      registerEndpoint("/api/v1/maquila/movements/movement-1/void", {
        method: "POST",
        handler: () => {
          throw new Error("No se pudo anular");
        },
      }),
    );
    const scope = effectScope();
    const state = scope.run(() => useMaquilaVoid(vi.fn()))!;
    state.openVoidModal(MOVEMENT);
    state.voidReason.value = "Registro duplicado";

    await state.submitVoid();

    expect(state.voidError.value).toBeTruthy();
    expect(state.voidSubmitting.value).toBe(false);
    expect(state.voidModalOpen.value).toBe(true);
    scope.stop();
  });
});
