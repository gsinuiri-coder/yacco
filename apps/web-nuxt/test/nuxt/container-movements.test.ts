import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery } from "h3";
import type { H3Event } from "h3";
import type { ContainerMovement, ContainerType } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer, buildLocation, pageOf } from "../support/fixtures";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const CON_CANO: ContainerType = { id: "con-cano", name: "Con caño", active: true };
const SIN_CANO: ContainerType = { id: "sin-cano", name: "Sin caño", active: true };

function movement(overrides: Partial<ContainerMovement> = {}): ContainerMovement {
  return {
    id: "mov-1",
    occurredAt: "2026-08-22T15:00:00.000Z",
    type: "FLEET_ENTRY",
    containerTypeId: CON_CANO.id,
    containerType: CON_CANO,
    quantity: 50,
    fromState: null,
    toState: "EMPTY_AT_PLANT",
    locationId: null,
    location: null,
    recordedById: "u-1",
    ...overrides,
  };
}

function stubPage(movements: ContainerMovement[] = [movement()]) {
  const queries: Array<Record<string, unknown>> = [];
  cleanups.push(
    registerEndpoint("/api/v1/container-types", () => [CON_CANO, SIN_CANO]),
    registerEndpoint("/api/v1/container-movements", {
      method: "GET",
      handler: (event: H3Event) => {
        queries.push(getQuery(event));
        return pageOf(movements);
      },
    }),
  );
  return queries;
}

async function renderPage() {
  cleanups.push(signIn());
  await renderSuspended(App, { route: "/container-movements" });
  await screen.findByRole("heading", { name: "Movimientos de envases", level: 1 });
}

function form(): HTMLElement {
  return screen.getByRole("form", { name: "Registrar movimiento" });
}

async function chooseInForm(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(within(form()).getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("Movimientos de envases", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("sólo ofrece las tres operaciones permitidas; llenado y las de ruta no aparecen", async () => {
    stubPage();
    await renderPage();

    await userEvent.setup().click(within(form()).getByLabelText("Operación"));
    const options = await screen.findAllByRole("option");

    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "Ingreso de envases nuevos",
      "Baja por daño",
      "Baja por pérdida",
    ]);
  });

  it("ingreso de envases nuevos: el POST lleva toState EMPTY_AT_PLANT, sin fromState ni locationId", async () => {
    stubPage();
    const bodies = stubWrite(cleanups, "/api/v1/container-movements", "POST", () => movement());
    const user = userEvent.setup();

    await renderPage();
    await chooseInForm("Operación", "Ingreso de envases nuevos");
    await chooseInForm("Tipo de envase", "Con caño");
    await user.type(within(form()).getByLabelText("Cantidad"), "50");

    expect(within(form()).queryByLabelText("¿De dónde sale?")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));

    expect(await screen.findByText("Movimiento registrado.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver inventario actualizado" })).toBeTruthy();
    expect(bodies).toEqual([
      { type: "FLEET_ENTRY", containerTypeId: "con-cano", quantity: 50, toState: "EMPTY_AT_PLANT" },
    ]);
  });

  it("baja por daño eligiendo el origen: el POST lleva ese origen", async () => {
    stubPage();
    const bodies = stubWrite(cleanups, "/api/v1/container-movements", "POST", () => movement());
    const user = userEvent.setup();

    await renderPage();
    await chooseInForm("Operación", "Baja por daño");
    await chooseInForm("Tipo de envase", "Con caño");
    await user.type(within(form()).getByLabelText("Cantidad"), "3");
    await chooseInForm("¿De dónde sale?", "de los llenos en camión");

    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));

    expect(await screen.findByText("Movimiento registrado.")).toBeTruthy();
    expect(bodies).toEqual([
      {
        type: "DAMAGE_WRITE_OFF",
        containerTypeId: "con-cano",
        quantity: 3,
        fromState: "FULL_ON_ROUTE",
      },
    ]);
  });

  it("baja por pérdida: el POST lleva el locationId de la ubicación elegida, no el id del cliente", async () => {
    stubPage();
    const customer = buildCustomer();
    const location = buildLocation({ id: "location-not-customer-id" });
    cleanups.push(
      registerEndpoint("/api/v1/customers", () => pageOf([customer])),
      registerEndpoint(`/api/v1/customers/${customer.id}/locations`, () => [location]),
    );
    const bodies = stubWrite(cleanups, "/api/v1/container-movements", "POST", () => movement());
    const user = userEvent.setup();

    await renderPage();
    await chooseInForm("Operación", "Baja por pérdida");
    await chooseInForm("Tipo de envase", "Con caño");
    await user.type(within(form()).getByLabelText("Cantidad"), "2");

    // Sin selector de origen: la pérdida sale siempre de "en cliente".
    expect(within(form()).queryByLabelText("¿De dónde sale?")).toBeNull();

    await user.type(within(form()).getByLabelText("Cliente"), customer.name);
    await user.click(await screen.findByRole("option", { name: new RegExp(customer.name) }));
    await chooseInForm("Ubicación", `${location.name} (${location.address})`);

    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));

    expect(await screen.findByText("Movimiento registrado.")).toBeTruthy();
    expect(bodies).toEqual([
      {
        type: "LOSS_WRITE_OFF",
        containerTypeId: "con-cano",
        quantity: 2,
        fromState: "WITH_CUSTOMER",
        locationId: location.id,
      },
    ]);
  });

  it("un cliente sin ubicaciones muestra su propio mensaje, no un desplegable vacío", async () => {
    stubPage();
    const customer = buildCustomer();
    cleanups.push(
      registerEndpoint("/api/v1/customers", () => pageOf([customer])),
      registerEndpoint(`/api/v1/customers/${customer.id}/locations`, () => []),
    );
    const user = userEvent.setup();

    await renderPage();
    await chooseInForm("Operación", "Baja por pérdida");
    await user.type(within(form()).getByLabelText("Cliente"), customer.name);
    await user.click(await screen.findByRole("option", { name: new RegExp(customer.name) }));

    expect(await screen.findByText("Este cliente no tiene ubicaciones registradas.")).toBeTruthy();
    expect(within(form()).queryByLabelText("Ubicación")).toBeNull();
  });

  it("un error al cargar las ubicaciones se muestra con opción de reintentar", async () => {
    stubPage();
    const customer = buildCustomer();
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/customers", () => pageOf([customer])),
      registerEndpoint(`/api/v1/customers/${customer.id}/locations`, (event: H3Event) => {
        attempt++;
        return attempt === 1 ? failWith(500, "Base de datos no disponible")(event) : [];
      }),
    );
    const user = userEvent.setup();

    await renderPage();
    await chooseInForm("Operación", "Baja por pérdida");
    await user.type(within(form()).getByLabelText("Cliente"), customer.name);
    await user.click(await screen.findByRole("option", { name: new RegExp(customer.name) }));

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    await user.click(within(form()).getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Este cliente no tiene ubicaciones registradas.")).toBeTruthy();
  });

  it("un 400 de transición inválida se muestra con su mensaje del backend", async () => {
    stubPage();
    stubWrite(
      cleanups,
      "/api/v1/container-movements",
      "POST",
      failWith(
        400,
        'El movimiento "DAMAGE_WRITE_OFF" no admite pasar de WITH_CUSTOMER a EMPTY_AT_PLANT',
      ),
    );
    const user = userEvent.setup();

    await renderPage();
    await chooseInForm("Operación", "Baja por daño");
    await chooseInForm("Tipo de envase", "Con caño");
    await user.type(within(form()).getByLabelText("Cantidad"), "3");
    await chooseInForm("¿De dónde sale?", "de los vacíos en planta");

    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      'El movimiento "DAMAGE_WRITE_OFF" no admite pasar de WITH_CUSTOMER a EMPTY_AT_PLANT',
    );
  });

  it("un doble clic en registrar dispara un solo POST", async () => {
    stubPage();
    let posts = 0;
    cleanups.push(
      registerEndpoint("/api/v1/container-movements", {
        method: "POST",
        handler: async () => {
          posts++;
          await new Promise((resolve) => setTimeout(resolve, 30));
          return movement();
        },
      }),
    );
    const user = userEvent.setup();

    await renderPage();
    await chooseInForm("Operación", "Ingreso de envases nuevos");
    await chooseInForm("Tipo de envase", "Con caño");
    await user.type(within(form()).getByLabelText("Cantidad"), "50");

    const submit = screen.getByRole("button", { name: "Registrar movimiento" });
    await user.dblClick(submit);

    expect(await screen.findByText("Movimiento registrado.")).toBeTruthy();
    expect(posts).toBe(1);
  });

  it("el historial pagina y filtra por operación, tipo de envase y rango de fechas", async () => {
    const queries = stubPage(Array.from({ length: 2 }, (_, i) => movement({ id: `mov-${i}` })));
    const user = userEvent.setup();

    await renderPage();
    await screen.findByRole("table");
    expect(queries[0]).toEqual({ page: "1", limit: "20" });

    await chooseInHistory("Operación", "Baja por daño");
    await waitFor(() => expect(queries.at(-1)?.type).toBe("DAMAGE_WRITE_OFF"));

    await chooseInHistory("Tipo de envase", "Sin caño");
    await waitFor(() => expect(queries.at(-1)?.containerTypeId).toBe("sin-cano"));

    await fireEventUpdate("Desde", "2026-08-01");
    await waitFor(() => expect(queries.at(-1)?.dateFrom).toBe("2026-08-01"));
    await fireEventUpdate("Hasta", "2026-08-31");
    await waitFor(() => expect(queries.at(-1)?.dateTo).toBe("2026-08-31"));

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() => expect(queries.at(-1)).toEqual({ page: "1", limit: "20" }));
  });

  it("muestra fecha, operación, tipo de envase, cantidad y de qué estado a cuál por fila", async () => {
    stubPage([
      movement({
        type: "DAMAGE_WRITE_OFF",
        fromState: "FULL_AT_PLANT",
        toState: null,
        quantity: 4,
      }),
    ]);

    await renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("22/08/2026 10:00")).toBeTruthy();
    expect(within(table).getByText("Baja por daño")).toBeTruthy();
    expect(within(table).getByText("Con caño")).toBeTruthy();
    expect(within(table).getByText("4")).toBeTruthy();
    expect(within(table).getByText("Llenos en planta → Fuera de la empresa")).toBeTruthy();
  });

  it("sin movimientos explica dónde van a aparecer; con filtro explica que ninguno coincide", async () => {
    const queries = stubPage([]);

    await renderPage();
    expect(await screen.findByText("Todavía no hay movimientos")).toBeTruthy();

    await chooseInHistory("Operación", "Baja por daño");
    await waitFor(() => expect(queries.at(-1)?.type).toBe("DAMAGE_WRITE_OFF"));
    expect(await screen.findByText("Ningún movimiento coincide con el filtro")).toBeTruthy();
  });
});

function historySection(): HTMLElement {
  return screen.getByRole("region", { name: "Historial" });
}

async function chooseInHistory(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(within(historySection()).getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

async function fireEventUpdate(label: string, value: string) {
  await fireEvent.update(within(historySection()).getByLabelText(label), value);
}
