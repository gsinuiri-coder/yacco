import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

describe("useSlowRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("avisa sólo cuando la petición en curso pasa de 5 segundos, y se apaga al terminar", async () => {
    const pending = ref(false);
    const scope = effectScope();
    const slow = scope.run(() => useSlowRequest(pending))!;

    pending.value = true;
    await nextTick();
    vi.advanceTimersByTime(4_999);
    expect(slow.value).toBe(false);

    vi.advanceTimersByTime(1);
    expect(slow.value).toBe(true);

    pending.value = false;
    await nextTick();
    expect(slow.value).toBe(false);

    scope.stop();
  });

  it("una petición que termina antes nunca muestra el aviso", async () => {
    const pending = ref(true);
    const scope = effectScope();
    const slow = scope.run(() => useSlowRequest(pending))!;

    vi.advanceTimersByTime(3_000);
    pending.value = false;
    await nextTick();
    vi.advanceTimersByTime(10_000);

    expect(slow.value).toBe(false);
    scope.stop();
  });
});
