import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { limaToday } from "@yacco/shared";
import type { Route } from "@yacco/shared";
import { adminApi, refillProduct } from "./support/api";
import { signIn, waitForHydration } from "./support/session";

// Capturas de 9b «rutas y liquidación». Script local, sin commitear.
const PHASE = process.env.CAPTURE_PHASE ?? "before";
const OUT = "../../docs/visual-reviews/9b-routes";

let api: APIRequestContext;
const unique = String(Date.now());
const ids: Record<string, string> = {};
let phoneCounter = 0;
let driverOnRoute = { username: "", password: "", name: "" };

async function created<T>(response: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as T;
}

async function ok(response: Awaited<ReturnType<APIRequestContext["patch"]>>): Promise<void> {
  expect(response.ok(), await response.text()).toBe(true);
}

async function customerLocation(label: string): Promise<string> {
  phoneCounter += 1;
  const phone = `9${String(Number(unique.slice(-6)) * 100 + phoneCounter)
    .slice(-8)
    .padStart(8, "0")}`;
  const customer = await created<{ id: string }>(
    await api.post("customers", {
      data: {
        name: `Bodega ${label} ${unique.slice(-4)}`,
        phone,
        address: `Jr. ${label} 100`,
        addressReference: "Reja verde",
      },
    }),
  );
  const locations = (await (await api.get(`customers/${customer.id}/locations`)).json()) as Array<{
    id: string;
  }>;
  return locations[0]!.id;
}

async function routeWithStops(
  label: string,
  stops: number,
): Promise<{ id: string; stopIds: string[] }> {
  const driver = {
    username: `cap-${label}-${unique}`,
    password: `clave-${label}-${unique}`,
    name: `Chofer ${label} ${unique.slice(-4)}`,
  };
  const user = await created<{ id: string }>(
    await api.post("users", { data: { ...driver, roles: ["DRIVER"] } }),
  );
  if (label === "Curso") driverOnRoute = driver;
  const vehicles = (await (await api.get("vehicles")).json()) as Array<{ id: string }>;
  const route = await created<Route>(
    await api.post("routes", {
      data: { driverId: user.id, date: limaToday(), vehicleId: vehicles[0]!.id },
    }),
  );
  const stopIds: string[] = [];
  for (let index = 0; index < stops; index++) {
    const stop = await created<{ id: string }>(
      await api.post(`routes/${route.id}/stops`, {
        data: { origin: "VAN_SALE", locationId: await customerLocation(`${label}${index + 1}`) },
      }),
    );
    stopIds.push(stop.id);
  }
  await loadFive(route.id);
  return { id: route.id, stopIds };
}

async function loadFive(routeId: string): Promise<void> {
  const typeId = (await refillProduct(api)).containerType.id;
  await created(
    await api.post("production-batches", {
      data: {
        code: `CAP-${routeId.slice(0, 6)}`,
        date: limaToday(),
        items: [{ containerTypeId: typeId, producedQty: 5 }],
      },
    }),
  );
  const page = (await (
    await api.get("production-batches", { params: { withStock: "true", limit: "100" } })
  ).json()) as {
    data: Array<{
      items: Array<{ id: string; availableQty: number; containerType: { id: string } }>;
    }>;
  };
  let pending = 5;
  for (const item of page.data.flatMap((batch) => batch.items)) {
    if (pending === 0) break;
    if (item.containerType.id !== typeId || item.availableQty === 0) continue;
    const take = Math.min(pending, item.availableQty);
    await created(
      await api.post(`routes/${routeId}/loads`, { data: { batchItemId: item.id, quantity: take } }),
    );
    pending -= take;
  }
}

async function resolveStops(
  route: { id: string; stopIds: string[] },
  correct: boolean,
): Promise<void> {
  const product = await refillProduct(api);
  await ok(await api.patch(`routes/${route.id}/start`));
  await ok(
    await api.patch(`routes/${route.id}/stops/${route.stopIds[0]}`, {
      data: { status: "DELIVERED", items: [{ productId: product.id, quantity: 2 }] },
    }),
  );
  await ok(
    await api.patch(`routes/${route.id}/stops/${route.stopIds[1]}`, {
      data: { status: "FAILED", failureReason: "Tienda cerrada" },
    }),
  );
  if (correct) {
    await ok(
      await api.patch(`routes/${route.id}/stops/${route.stopIds[0]}/correction`, {
        data: {
          status: "DELIVERED",
          items: [{ productId: product.id, quantity: 1 }],
          correctionReason: "Eran uno, no dos",
        },
      }),
    );
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  api = await adminApi();
  const planned = await routeWithStops("Plan", 2);
  ids.planned = planned.id;

  const inProgress = await routeWithStops("Curso", 3);
  await resolveStops(inProgress, true);
  ids.inProgress = inProgress.id;

  const toSettle = await routeWithStops("Fin", 2);
  await resolveStops(toSettle, false);
  await ok(await api.patch(`routes/${toSettle.id}/finish`));
  ids.toSettle = toSettle.id;

  const settled = await routeWithStops("Liq", 2);
  await resolveStops(settled, true);
  await ok(await api.patch(`routes/${settled.id}/finish`));
  await created(
    await api.post(`routes/${settled.id}/settlement`, {
      data: { fullReturned: 2, emptiesCollected: [], notes: "Faltó un lleno, se revisa mañana" },
    }),
  );
  ids.settled = settled.id;
});

test.afterAll(async () => {
  await api.dispose();
});

const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

async function shoot(page: Page, path: string, name: string): Promise<void> {
  for (const [kind, viewport] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(viewport);
    await page.goto(path);
    await waitForHydration(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${PHASE}-${kind}-${name}.png`, fullPage: true });
  }
}

test("oficina", async ({ page }) => {
  await signIn(page);
  await shoot(page, `/routes?date=${limaToday()}`, "list");
  await shoot(page, "/routes/new", "new");
  await shoot(page, `/routes/${ids.planned}`, "detail-planned");
  await shoot(page, `/routes/${ids.inProgress}`, "detail-in-progress");
  await shoot(page, `/routes/${ids.toSettle}`, "detail-finished");
  await shoot(page, `/routes/${ids.toSettle}/settlement`, "settlement-form");
  await shoot(page, `/routes/${ids.settled}/settlement`, "settlement-difference");
});

test("chofer", async ({ page }) => {
  await signIn(page, driverOnRoute);
  await shoot(page, "/my-route", "my-route");
});
