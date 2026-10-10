import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { Customer, SetupChecklist } from "@yacco/shared";
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
