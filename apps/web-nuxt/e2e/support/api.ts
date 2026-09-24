import { expect, request } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { limaToday } from "@yacco/shared";
import type { Page as ApiPage, Product, ProductionBatch, Route } from "@yacco/shared";
import { ADMIN } from "./session";

/**
 * Datos de prueba armados por la API, como la oficina: los tests de navegador
 * prueban la pantalla, no cómo se siembra. Cada corrida usa nombres propios
 * (un sufijo único), así una base local ya usada no choca con la anterior.
 */
const API = "http://localhost:3100/api/v1/";

export async function adminApi(): Promise<APIRequestContext> {
  const anonymous = await request.newContext({ baseURL: API });
  const login = await anonymous.post("auth/login", {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  expect(login.ok()).toBe(true);
  const { accessToken } = (await login.json()) as { accessToken: string };
  await anonymous.dispose();
  return request.newContext({
    baseURL: API,
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
}

async function created<T>(response: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as T;
}

export interface DriverRoute {
  driver: { username: string; password: string; name: string };
  customerName: string;
  routeId: string;
}

/**
 * Un chofer con una ruta de HOY ya en curso: una parada de autoventa en un
 * cliente propio y llenos cargados para entregar.
 */
export async function driverWithRouteToday(
  api: APIRequestContext,
  label: string,
  unique: string,
): Promise<DriverRoute> {
  const driver = {
    username: `chofer-${label}-${unique}`,
    password: `clave-${label}-${unique}`,
    name: `Chofer ${label.toUpperCase()} ${unique}`,
  };
  const user = await created<{ id: string }>(
    await api.post("users", { data: { ...driver, roles: ["DRIVER"] } }),
  );

  const customerName = `Bodega ${label.toUpperCase()} ${unique}`;
  const phone = `9${unique.slice(-8).padStart(8, "0")}`;
  const customer = await created<{ id: string }>(
    await api.post("customers", {
      data: { name: customerName, phone, address: `Jr. ${label} 100`, addressReference: "Reja" },
    }),
  );
  const locations = (await (await api.get(`customers/${customer.id}/locations`)).json()) as Array<{
    id: string;
  }>;

  const route = await created<Route>(
    await api.post("routes", { data: { driverId: user.id, date: limaToday() } }),
  );
  await created(
    await api.post(`routes/${route.id}/stops`, {
      data: { origin: "VAN_SALE", locationId: locations[0]!.id },
    }),
  );
  await loadFifo(api, route.id, 3, unique + label);
  expect((await api.patch(`routes/${route.id}/start`)).ok()).toBe(true);
  return { driver, customerName, routeId: route.id };
}

/** El producto que se entrega en el test, y su tipo de envase. */
export async function refillProduct(api: APIRequestContext): Promise<Product> {
  const products = (await (await api.get("products")).json()) as Product[];
  const refill = products.find((product) => product.type === "REFILL" && product.active);
  expect(refill, "el seed trae al menos una recarga activa").toBeDefined();
  return refill!;
}

/**
 * Carga `quantity` llenos respetando FIFO, como la pantalla: del lote más
 * antiguo con unidades de ese tipo. Si no hay stock, produce un lote de hoy.
 */
async function loadFifo(
  api: APIRequestContext,
  routeId: string,
  quantity: number,
  code: string,
): Promise<void> {
  const typeId = (await refillProduct(api)).containerType.id;
  const withStock = async () => {
    const page = (await (
      await api.get("production-batches", { params: { withStock: "true", limit: "100" } })
    ).json()) as ApiPage<ProductionBatch>;
    return page.data
      .flatMap((batch) => batch.items.map((item) => ({ batch, item })))
      .filter(({ item }) => item.containerType.id === typeId && item.availableQty > 0);
  };
  let pending = quantity;
  let candidates = await withStock();
  if (candidates.reduce((sum, { item }) => sum + item.availableQty, 0) < quantity) {
    await created(
      await api.post("production-batches", {
        data: {
          code: `E2E-${code}`,
          date: limaToday(),
          items: [{ containerTypeId: typeId, producedQty: 50 }],
        },
      }),
    );
    candidates = await withStock();
  }
  for (const { item } of candidates) {
    if (pending === 0) break;
    const take = Math.min(pending, item.availableQty);
    await created(
      await api.post(`routes/${routeId}/loads`, { data: { batchItemId: item.id, quantity: take } }),
    );
    pending -= take;
  }
}
