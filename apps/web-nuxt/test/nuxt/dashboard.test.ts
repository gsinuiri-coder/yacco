import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { Customer, RoleDashboard, SetupChecklist } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer, pageOf } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

/** Responde /customers filtrando por nombre y guarda la query de cada petición. */
function stubSearch(customers: Customer[]) {
  const queries: Array<Record<string, unknown>> = [];
  cleanups.push(
    registerEndpoint("/api/v1/customers", (event: H3Event) => {
      const query = getQuery(event);
      queries.push(query);
      const text = String(query.search ?? "").toLowerCase();
      return pageOf(customers.filter((customer) => customer.name.toLowerCase().includes(text)));
    }),
  );
  return queries;
}

async function renderPanel() {
  await renderSuspended(App, { route: "/" });
  return screen.findByLabelText("Buscar cliente");
}

describe("Panel", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn(["ADMIN"], "giancarlo"));
    cleanups.push(registerEndpoint("/api/v1/reports/dashboard", () => ({ today: "2026-10-14" })));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("está dentro del marco: título, navegación, y el usuario y 'Cerrar sesión' una sola vez", async () => {
    await renderPanel();

    expect(screen.getByRole("heading", { name: "Panel" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeTruthy();
    expect(await screen.findAllByText("giancarlo")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Cerrar sesión" })).toHaveLength(1);
  });

  it("el buscador llega con el foco puesto", async () => {
    const input = await renderPanel();

    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("busca contra la API con límite 10 y SIN filtrar por activo", async () => {
    const queries = stubSearch([buildCustomer({ name: "Panadería Aurora" })]);
    const input = await renderPanel();

    await userEvent.setup().type(input, "aurora");

    expect(await screen.findByRole("option", { name: /Panadería Aurora/ })).toBeTruthy();
    const last = queries.at(-1);
    expect(last?.search).toBe("aurora");
    expect(last?.limit).toBe("10");
    expect(last).not.toHaveProperty("active");
  });

  it("espera a que se deje de escribir: no pide una búsqueda por tecla", async () => {
    const queries = stubSearch([buildCustomer({ name: "Panadería Aurora" })]);
    const input = await renderPanel();

    await userEvent.setup().type(input, "aurora");
    await screen.findByRole("option", { name: /Panadería Aurora/ });

    expect(queries.map((query) => query.search)).toEqual(["aurora"]);
  });

  it("sin texto no pide nada ni muestra opciones", async () => {
    const queries = stubSearch([buildCustomer()]);
    await renderPanel();

    expect(screen.queryByRole("option")).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it("elegir un resultado abre la ficha del cliente", async () => {
    stubSearch([buildCustomer({ id: "c-42", name: "Panadería Aurora" })]);
    const user = userEvent.setup();
    const input = await renderPanel();

    await user.type(input, "aurora");
    await user.click(await screen.findByRole("option", { name: /Panadería Aurora/ }));

    await waitFor(() => expect(useRouter().currentRoute.value.path).toBe("/customers/c-42"));
  });

  it("un cliente inactivo aparece marcado y se puede elegir igual", async () => {
    stubSearch([buildCustomer({ id: "c-7", name: "Panadería Aurora", active: false })]);
    const user = userEvent.setup();
    const input = await renderPanel();

    await user.type(input, "aurora");
    const option = await screen.findByRole("option", { name: /Panadería Aurora/ });
    expect(within(option).getByText("Inactivo")).toBeTruthy();

    await user.click(option);
    await waitFor(() => expect(useRouter().currentRoute.value.path).toBe("/customers/c-7"));
  });

  it("las flechas mueven el resaltado y Enter abre el resaltado", async () => {
    stubSearch([
      buildCustomer({ id: "c-1", name: "Panadería Aurora" }),
      buildCustomer({ id: "c-2", name: "Bodega Aurora Norte" }),
    ]);
    const user = userEvent.setup();
    const input = await renderPanel();

    await user.type(input, "aurora");
    await screen.findByRole("option", { name: /Bodega Aurora Norte/ });
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() => expect(useRouter().currentRoute.value.path).toMatch(/^\/customers\/c-/));
    expect(useRouter().currentRoute.value.path).not.toBe("/");
  });

  it("Escape cierra la lista", async () => {
    stubSearch([buildCustomer({ name: "Panadería Aurora" })]);
    const user = userEvent.setup();
    const input = await renderPanel();

    await user.type(input, "aurora");
    await screen.findByRole("option", { name: /Panadería Aurora/ });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
  });

  it("sin coincidencias dice 'Sin resultados'", async () => {
    stubSearch([buildCustomer({ name: "Panadería Aurora" })]);
    const input = await renderPanel();

    await userEvent.setup().type(input, "zzz");

    expect(await screen.findByText("Sin resultados")).toBeTruthy();
  });

  it("un error de búsqueda se distingue de 'Sin resultados' y se puede reintentar", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/customers", (event: H3Event) => {
        attempt++;
        if (attempt === 1) {
          setResponseStatus(event, 500);
          return { message: "Base de datos no disponible" };
        }
        return pageOf([buildCustomer({ name: "Panadería Aurora" })]);
      }),
    );
    const user = userEvent.setup();
    const input = await renderPanel();

    await user.type(input, "aurora");

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    expect(screen.queryByText("Sin resultados")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("option", { name: /Panadería Aurora/ })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Panel — Puesta en marcha", () => {
  const PENDING: SetupChecklist & { locationsWithoutCoordinates: number } = {
    zonesWithoutDeliveryDays: [{ id: "z1", name: "Surco" }],
    activeDrivers: 0,
    activeSellers: 1,
    uncountedLocations: 4,
    locationsWithoutCoordinates: 3,
    activeTestUsers: 0,
    activeTestCustomers: 0,
    productsWithInitialListPrice: [],
  };
  const READY: SetupChecklist = {
    ...PENDING,
    zonesWithoutDeliveryDays: [],
    activeDrivers: 1,
    uncountedLocations: 0,
    locationsWithoutCoordinates: 0,
  };

  function stubChecklist(checklist: SetupChecklist) {
    let calls = 0;
    cleanups.push(
      registerEndpoint("/api/v1/reports/setup-checklist", () => {
        calls += 1;
        return checklist;
      }),
    );
    return () => calls;
  }

  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("el administrador ve cada pendiente con el enlace a su pantalla", async () => {
    cleanups.push(signIn(["ADMIN"]));
    stubChecklist(PENDING);

    await renderSuspended(App, { route: "/" });

    const card = await screen.findByRole("region", { name: "Puesta en marcha" });
    expect(within(card).getByText("No hay ningún chofer activo.")).toBeTruthy();
    expect(within(card).getByText("La zona Surco no tiene días de reparto.")).toBeTruthy();
    expect(
      within(card).getByText("Falta contar los bidones de 4 ubicaciones de clientes."),
    ).toBeTruthy();
    expect(within(card).getByText("Falta cargar la ubicación de 3 locales.")).toBeTruthy();
    expect(
      within(card).getByRole("link", { name: "Envases en poder de clientes" }).getAttribute("href"),
    ).toBe("/container-counts?uncountedOnly=true");
    expect(within(card).getByRole("link", { name: "Zonas" }).getAttribute("href")).toBe("/zones");
  });

  it("sin pendientes la tarjeta no está", async () => {
    cleanups.push(signIn(["ADMIN"]));
    const calls = stubChecklist(READY);

    await renderSuspended(App, { route: "/" });
    await screen.findByLabelText("Buscar cliente");

    await waitFor(() => expect(calls()).toBe(1));
    expect(screen.queryByRole("region", { name: "Puesta en marcha" })).toBeNull();
  });

  it("quien no es administrador no la ve ni la pide", async () => {
    cleanups.push(signIn(["SELLER"]));
    const calls = stubChecklist(PENDING);

    await renderSuspended(App, { route: "/" });
    await screen.findByLabelText("Buscar cliente");

    expect(screen.queryByRole("region", { name: "Puesta en marcha" })).toBeNull();
    expect(calls()).toBe(0);
  });
});

describe("Panel por rol", () => {
  const WITH_SPIGOT = { id: "ct-1", name: "Con caño" };
  const WITHOUT_SPIGOT = { id: "ct-2", name: "Sin caño" };

  function stubDashboard(dashboard: RoleDashboard) {
    let calls = 0;
    cleanups.push(
      registerEndpoint("/api/v1/reports/dashboard", () => {
        calls += 1;
        return dashboard;
      }),
    );
    return () => calls;
  }

  async function summary() {
    return screen.findByRole("region", { name: "Resumen del día" });
  }

  function hrefOf(region: HTMLElement, name: string): string | null {
    return within(region).getByRole("link", { name }).getAttribute("href");
  }

  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("el administrador ve ventas, cobros, deuda y rutas en curso, cada uno con su pantalla", async () => {
    cleanups.push(signIn(["ADMIN"]));
    stubDashboard({
      today: "2026-10-14",
      salesToday: "1250.50",
      paymentsToday: "300.00",
      totalDebt: "4820.00",
      routesInProgress: 2,
    });

    await renderSuspended(App, { route: "/" });
    const region = await summary();

    await within(region).findByRole("link", { name: "Ventas del día: S/ 1,250.50" });
    expect(hrefOf(region, "Ventas del día: S/ 1,250.50")).toBe("/routes?date=2026-10-14");
    expect(hrefOf(region, "Cobros del día: S/ 300.00")).toBe(
      "/payments?status=CONFIRMED&paidFrom=2026-10-14&paidTo=2026-10-14",
    );
    expect(hrefOf(region, "Deuda total: S/ 4,820.00")).toBe("/reports/debt");
    expect(hrefOf(region, "Rutas en curso: 2")).toBe("/routes?status=IN_PROGRESS");
    expect(within(region).queryByText("Pedidos del día")).toBeNull();
  });

  it("el vendedor ve pedidos, no entregados, rutas en curso y cobros por confirmar", async () => {
    cleanups.push(signIn(["SELLER"]));
    stubDashboard({
      today: "2026-10-14",
      ordersToday: 18,
      undeliveredOrders: 3,
      routesInProgress: 1,
      pendingPayments: { count: 4, amount: "62.50" },
    });

    await renderSuspended(App, { route: "/" });
    const region = await summary();

    await within(region).findByRole("link", { name: "Pedidos del día: 18" });
    expect(hrefOf(region, "Pedidos del día: 18")).toBe(
      "/orders?deliveryDateFrom=2026-10-14&deliveryDateTo=2026-10-14",
    );
    expect(hrefOf(region, "No entregados: 3")).toBe("/orders/undelivered");
    expect(hrefOf(region, "Rutas en curso: 1")).toBe("/routes?status=IN_PROGRESS");
    expect(hrefOf(region, "Cobros por confirmar: 4 · S/ 62.50")).toBe("/payments?status=PENDING");
    expect(within(region).queryByText("Ventas del día")).toBeNull();
  });

  it("el supervisor de planta entra al Panel y ve producción, stock y maquila, sin buscador", async () => {
    cleanups.push(signIn(["PLANT_SUPERVISOR"]));
    stubDashboard({
      today: "2026-10-14",
      producedToday: [
        { containerType: WITH_SPIGOT, quantity: 40 },
        { containerType: WITHOUT_SPIGOT, quantity: 3 },
      ],
      plantStock: [
        { containerType: WITH_SPIGOT, empty: 55, full: 45 },
        { containerType: WITHOUT_SPIGOT, empty: 0, full: 3 },
      ],
      maquilaPending: { emptyToFill: 4, fullToReturn: 1 },
    });

    await renderSuspended(App, { route: "/" });
    const region = await summary();

    await within(region).findByRole("link", {
      name: "Producción del día: Con caño 40 · Sin caño 3",
    });
    expect(useRouter().currentRoute.value.path).toBe("/");
    expect(hrefOf(region, "Producción del día: Con caño 40 · Sin caño 3")).toBe(
      "/production?dateFrom=2026-10-14&dateTo=2026-10-14",
    );
    expect(hrefOf(region, "Vacíos en planta: Con caño 55")).toBe("/inventory");
    expect(hrefOf(region, "Llenos en planta: Con caño 45 · Sin caño 3")).toBe("/inventory");
    expect(hrefOf(region, "Maquila por llenar: 4")).toBe("/production");
    expect(hrefOf(region, "Maquila por devolver: 1")).toBe("/production");
    expect(screen.queryByLabelText("Buscar cliente")).toBeNull();
    expect(within(region).queryByText(/S\//)).toBeNull();
  });

  it("el operador de planta ve sus llenadas de hoy y los vacíos para llenar", async () => {
    cleanups.push(signIn(["PLANT_OPERATOR"]));
    stubDashboard({
      today: "2026-10-14",
      myFillingsToday: [{ containerType: WITH_SPIGOT, quantity: 12 }],
      emptyToFill: [{ containerType: WITH_SPIGOT, quantity: 55 }],
    });

    await renderSuspended(App, { route: "/" });
    const region = await summary();

    await within(region).findByRole("link", { name: "Mis llenadas de hoy: Con caño 12" });
    expect(hrefOf(region, "Vacíos para llenar: Con caño 55")).toBe("/inventory");
    expect(within(region).queryByText("Producción del día")).toBeNull();
  });

  it("sin llenadas todavía, sus llenadas de hoy dicen 0", async () => {
    cleanups.push(signIn(["PLANT_OPERATOR"]));
    stubDashboard({ today: "2026-10-14", myFillingsToday: [], emptyToFill: [] });

    await renderSuspended(App, { route: "/" });
    const region = await summary();

    expect(
      await within(region).findByRole("link", { name: "Mis llenadas de hoy: 0" }),
    ).toBeTruthy();
  });

  it("con dos roles ve la suma, y lo que comparten una sola vez", async () => {
    cleanups.push(signIn(["ADMIN", "SELLER"]));
    stubDashboard({
      today: "2026-10-14",
      salesToday: "10.00",
      paymentsToday: "0.00",
      totalDebt: "0.00",
      routesInProgress: 1,
      ordersToday: 2,
      undeliveredOrders: 0,
      pendingPayments: { count: 0, amount: "0.00" },
    });

    await renderSuspended(App, { route: "/" });
    const region = await summary();

    await within(region).findByRole("link", { name: "Ventas del día: S/ 10.00" });
    expect(within(region).getByRole("link", { name: "Pedidos del día: 2" })).toBeTruthy();
    expect(within(region).getAllByRole("link", { name: /^Rutas en curso/ })).toHaveLength(1);
  });

  it("si el resumen falla lo dice, y se puede reintentar", async () => {
    cleanups.push(signIn(["SELLER"]));
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/reports/dashboard", (event: H3Event) => {
        attempt++;
        if (attempt === 1) {
          setResponseStatus(event, 500);
          return { message: "Base de datos no disponible" };
        }
        return { today: "2026-10-14", ordersToday: 5 };
      }),
    );

    await renderSuspended(App, { route: "/" });
    const region = await summary();

    const alert = await within(region).findByRole("alert");
    expect(alert.textContent).toContain("No se pudo cargar el resumen del día");
    await userEvent.setup().click(within(region).getByRole("button", { name: "Reintentar" }));
    expect(await within(region).findByRole("link", { name: "Pedidos del día: 5" })).toBeTruthy();
  });
});

describe("Revisiones por vencer", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn(["ADMIN"]));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra las alertas de revisiones y licencias cuando existen", async () => {
    cleanups.push(
      registerEndpoint("/api/v1/vehicles/upcoming-reviews", () => [
        {
          type: "VEHICLE_REVIEW",
          targetId: "v-1",
          targetName: "Camión 1",
          detail: "SOAT",
          expiresOn: "2026-10-20",
          daysRemaining: 8,
          status: "POR_VENCER",
        },
      ]),
    );

    await renderSuspended(App, { route: "/" });

    const card = await screen.findByRole("region", { name: "Revisiones por vencer" });
    expect(within(card).getByText("Camión 1")).toBeTruthy();
    expect(within(card).getByText(/— SOAT/)).toBeTruthy();
    expect(within(card).getByText("Por vencer")).toBeTruthy();
  });

  it("sin alertas la tarjeta no se muestra", async () => {
    cleanups.push(registerEndpoint("/api/v1/vehicles/upcoming-reviews", () => []));

    await renderSuspended(App, { route: "/" });
    await screen.findByLabelText("Buscar cliente");

    expect(screen.queryByRole("region", { name: "Revisiones por vencer" })).toBeNull();
  });
});
