import { positionStrings } from "@yacco/shared";
import type {
  CreateRouteLocationPointsBody,
  LocationTracking,
  RouteLocationPointInput,
  RouteLocationPointsReceipt,
} from "@yacco/shared";
import type { Ref } from "vue";

/** The API refuses more in one batch; older unsent points give way first. */
const MAX_PENDING_POINTS = 500;
const PERMISSION_DENIED = 1;

type Reading = RouteLocationPointInput | "denied" | null;

function readPosition(): Promise<Reading> {
  if (!("geolocation" in navigator)) return Promise.resolve("denied");
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const strings = positionStrings(position.coords);
          resolve(
            strings === null
              ? null
              : {
                  clientPointId: crypto.randomUUID(),
                  ...strings,
                  recordedAt: new Date(
                    Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
                  ).toISOString(),
                },
          );
        },
        (error) => resolve(error.code === PERMISSION_DENIED ? "denied" : null),
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
      );
    } catch {
      resolve("denied");
    }
  });
}

/**
 * Fase 3, fila 10 (A.6): while «Mi ruta» is open and the route is in
 * progress, sends where the phone is every `intervalSeconds` — the server
 * decides how often, so changing it needs no new version. Without browser
 * permission it sends nothing and «Mi ruta» works the same.
 *
 * A point that could not be sent (no signal) stays and goes with the next
 * one, under the same `clientPointId`: if the first attempt did arrive and
 * only its answer was lost, the server stores it once.
 */
export function useLocationReporter(activeRouteId: Ref<string | null>) {
  const api = useApi();
  const sharing = ref(false);
  let intervalSeconds: number | null = null;
  let denied = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let pending: RouteLocationPointInput[] = [];

  function stop(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  async function send(routeId: string): Promise<void> {
    const reading = await readPosition();
    if (reading === "denied") {
      denied = true;
      sharing.value = false;
      stop();
      return;
    }
    if (reading !== null) pending = [...pending, reading].slice(-MAX_PENDING_POINTS);
    if (pending.length === 0) return;

    const batch = pending;
    try {
      const body: CreateRouteLocationPointsBody = { points: batch };
      await api.request<RouteLocationPointsReceipt>(`/routes/${routeId}/location-points`, {
        method: "POST",
        body,
      });
      pending = pending.filter((point) => !batch.includes(point));
      sharing.value = true;
    } catch (error) {
      // The API said no (route no longer in progress, a bad point): sending
      // the same batch again would get the same answer. Without signal, or
      // with the server down, it stays for the next try.
      if (error instanceof ApiError && error.status < 500) {
        pending = pending.filter((point) => !batch.includes(point));
      }
    }
  }

  async function start(routeId: string): Promise<void> {
    if (intervalSeconds === null) {
      try {
        intervalSeconds = (await api.request<LocationTracking>("/settings/location-tracking"))
          .intervalSeconds;
      } catch {
        return;
      }
    }
    if (denied || activeRouteId.value !== routeId) return;
    timer = setInterval(() => void send(routeId), intervalSeconds * 1000);
    await send(routeId);
  }

  watch(
    activeRouteId,
    (routeId) => {
      stop();
      pending = [];
      sharing.value = false;
      if (routeId !== null && !denied) void start(routeId);
    },
    { immediate: true },
  );
  onBeforeUnmount(stop);

  return { sharing };
}
