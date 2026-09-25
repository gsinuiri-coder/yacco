import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery } from "h3";
import type { H3Event } from "h3";
import type { ContainerBalanceRow, ContainerType } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { pageOf } from "../support/fixtures";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const TYPE_V: ContainerType = { id: "type-v", name: "Bidón (V)", active: true };
const TYPE_R: ContainerType = { id: "type-r", name: "Bidón (R)", active: true };
const RECENT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const OLD = "2026-01-05T15:00:00.000Z";

function buildRow(overrides: Partial<ContainerBalanceRow> = {}): ContainerBalanceRow {
  return {
    customer: { id: "c-1", name: "Bodega Santa Rosa", active: true },
    location: { id: "loc-1", name: "Principal", active: true },
    zone: { id: "z-1", name: "Norte" },
    totalQuantity: 6,
    lastCountedAt: RECENT,
    containers: [{ containerType: TYPE_V, quantity: 6, lastCountedAt: RECENT }],
    ...overrides,
  };
}

const UNTOUCHED = buildRow({
  customer: { id: "c-2", name: "Kiosko Sin Tocar", active: true },
  location: { id: "loc-2", name: "Principal", active: true },
  zone: null,
  totalQuantity: 0,
  lastCountedAt: null,
  containers: [],
});

const NEGATIVE = buildRow({
  customer: { id: "c-3", name: "Panadería Aurora", active: true },
  location: { id: "loc-3", name: "Sucursal", active: true },
  totalQuantity: 1,
  lastCountedAt: null,
  containers: [
    { containerType: TYPE_V, quantity: -1, lastCountedAt: null },
    { containerType: TYPE_R, quantity: 2, lastCountedAt: null },
  ],
});

const CLOSED = buildRow({
  customer: { id: "c-4", name: "Bodega Cerrada", active: false },
  location: { id: "loc-4", name: "Principal", active: false },
  totalQuantity: 3,
  lastCountedAt: OLD,
  containers: [{ containerType: TYPE_V, quantity: 3, lastCountedAt: OLD }],
});

function stubBalances(rows: () => ContainerBalanceRow[]) {
  const seen: Array<Record<string, unknown>> = [];
  cleanups.push(
    registerEndpoint("/api/v1/container-balances", {
      method: "GET",
      handler: (event: H3Event) => {
        const query = getQuery(event);
        seen.push(query);
        const uncountedOnly = query.uncountedOnly === "true";
        const filtered = rows().filter((row) => !uncountedOnly || row.lastCountedAt === null);
        const limit = Number(query.limit ?? "20");
        return pageOf(filtered.slice(0, limit), {
          total: filtered.length,
          limit,
          totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
        });
      },
    }),
  );
  return seen;
}

function stubTypes(types: ContainerType[] = [TYPE_V, TYPE_R]) {
  cleanups.push(registerEndpoint("/api/v1/container-types", () => types));
}

async function renderPage() {
  cleanups.push(signIn());
  await renderSuspended(App, { route: "/container-counts" });
  await screen.findByRole("heading", { name: "Envases en poder de clientes", level: 1 });
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

async function openCountFor(customerName: string) {
  await screen.findByText(customerName);
  const user = userEvent.setup();
  await user.click(within(rowOf(customerName)).getByRole("button", { name: "Contar" }));
  return screen.getByRole("form", { name: /Contar envases de/ });
}

describe("Envases en poder de clientes", () => {
  beforeEach(async () => {
    resetSession();
    stubTypes();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista las ubicaciones con su estado y comunica el avance", async () => {
    stubBalances(() => [buildRow(), UNTOUCHED, NEGATIVE, CLOSED]);

    await renderPage();

    expect(await screen.findByText("Bodega Santa Rosa")).toBeTruthy();
    expect(await screen.findByText("2 de 4 ubicaciones contadas · 2 sin contar")).toBeTruthy();

    const santaRosa = rowOf("Bodega Santa Rosa");
    expect(within(santaRosa).getByText("Norte")).toBeTruthy();
    expect(within(santaRosa).getByText(/6 Bidón \(V\)/)).toBeTruthy();
    expect(within(santaRosa).queryByText("Sin contar")).toBeNull();

    const untouched = rowOf("Kiosko Sin Tocar");
    expect(within(untouched).getByText("Sin contar")).toBeTruthy();
    expect(within(untouched).getByText("Sin zona")).toBeTruthy();

    const negative = rowOf("Panadería Aurora");
    expect(within(negative).getByText("Entrega sin registrar")).toBeTruthy();
    expect(within(negative).getByText(/-1 Bidón \(V\)/)).toBeTruthy();

    const closed = rowOf("Bodega Cerrada");
    expect(within(closed).getByText("Hace más de 60 días")).toBeTruthy();
    expect(within(closed).getByText("Cliente de baja")).toBeTruthy();
    expect(within(closed).getByText("Ubicación retirada")).toBeTruthy();
  });

  it("el filtro «Solo sin contar» pide uncountedOnly=true y deja solo las pendientes", async () => {
    const seen = stubBalances(() => [buildRow(), UNTOUCHED]);

    await renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await userEvent.setup().click(screen.getByLabelText("Solo sin contar"));

    await waitFor(() => expect(screen.queryByText("Bodega Santa Rosa")).toBeNull());
    expect(screen.getByText("Kiosko Sin Tocar")).toBeTruthy();
    const listCalls = seen.filter((query) => query.limit === "20");
    expect(listCalls.at(-1)?.uncountedOnly).toBe("true");
    expect(listCalls.at(-1)?.page).toBe("1");
    expect(screen.getByText("1 ubicación con este filtro")).toBeTruthy();
  });

  it("los otros filtros viajan como los espera la API", async () => {
    const seen = stubBalances(() => [buildRow()]);
    const user = userEvent.setup();

    await renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByLabelText("Solo con entregas sin registrar"));
    await user.type(screen.getByLabelText("Contadas antes del"), "2026-03-01");

    await waitFor(() => expect(seen.at(-1)?.countedBefore).toBe("2026-03-01T00:00:00-05:00"));
    expect(seen.at(-1)?.withDiscrepancies).toBe("true");

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    await waitFor(() => expect(seen.at(-1)).not.toHaveProperty("withDiscrepancies"));
    expect(seen.at(-1)).not.toHaveProperty("countedBefore");
  });

  it("busca a un cliente por nombre y recorre por zona, con las zonas del catálogo", async () => {
    const seen = stubBalances(() => [buildRow()]);
    cleanups.push(
      registerEndpoint("/api/v1/zones", () => [
        { id: "zone-norte", name: "Norte", deliveryDays: [], active: true },
      ]),
    );
    const user = userEvent.setup();

    await renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.type(screen.getByLabelText("Buscar"), " santa ");
    await waitFor(() => expect(seen.at(-1)?.search).toBe("santa"));

    await user.click(screen.getByRole("combobox", { name: "Zona" }));
    await user.click(await screen.findByRole("option", { name: "Norte" }));
    await waitFor(() => expect(seen.at(-1)?.zoneId).toBe("zone-norte"));
    expect(seen.at(-1)?.search).toBe("santa");

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() => {
      expect(seen.at(-1)).not.toHaveProperty("zoneId");
      expect(seen.at(-1)).not.toHaveProperty("search");
    });
  });

  it("registra un conteo que coincide sin pedir revisión y actualiza la fila desde el reporte", async () => {
    let counted = false;
    stubBalances(() => [
      counted
        ? buildRow({ lastCountedAt: "2026-08-25T15:00:00.000Z" })
        : buildRow({
            lastCountedAt: null,
            containers: [{ containerType: TYPE_V, quantity: 6, lastCountedAt: null }],
          }),
    ]);
    const bodies = stubWrite(cleanups, "/api/v1/container-counts", "POST", () => ({}));
    const user = userEvent.setup();

    await renderPage();
    await screen.findByText("Bodega Santa Rosa");
    expect(within(rowOf("Bodega Santa Rosa")).getByText("Sin contar")).toBeTruthy();
    await screen.findByText("0 de 1 ubicaciones contadas · 1 sin contar");

    const form = await openCountFor("Bodega Santa Rosa");
    expect(within(form).getByText("Según el sistema: 6")).toBeTruthy();
    counted = true;
    await user.type(within(form).getByLabelText("Contado de Bidón (V)"), "6");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));

    expect(await screen.findByText(/Conteo registrado: Bodega Santa Rosa/)).toBeTruthy();
    expect(bodies).toEqual([
      { locationId: "loc-1", containerTypeId: TYPE_V.id, countedQuantity: 6 },
    ]);
    await waitFor(() =>
      expect(within(rowOf("Bodega Santa Rosa")).queryByText("Sin contar")).toBeNull(),
    );
    expect(await screen.findByText("1 de 1 ubicaciones contadas · 0 sin contar")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("un conteo que difiere muestra la diferencia con signo antes de confirmar", async () => {
    stubBalances(() => [buildRow()]);
    const bodies = stubWrite(cleanups, "/api/v1/container-counts", "POST", () => ({}));
    const user = userEvent.setup();

    await renderPage();
    const form = await openCountFor("Bodega Santa Rosa");
    await user.type(within(form).getByLabelText("Contado de Bidón (V)"), "4");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));

    const review = screen.getByRole("group", { name: "Revisar conteo de Principal" });
    expect(review.textContent).toContain("Bidón (V): según el sistema 6, contado 4");
    expect(review.textContent).toContain("diferencia -2");
    expect(bodies).toHaveLength(0);
    expect(within(review).queryByRole("alert")).toBeNull();

    await user.click(within(review).getByRole("button", { name: "Confirmar conteo" }));

    expect(bodies).toEqual([
      { locationId: "loc-1", containerTypeId: TYPE_V.id, countedQuantity: 4 },
    ]);
  });

  it("«Volver a contar» en la revisión regresa al formulario sin enviar nada", async () => {
    stubBalances(() => [buildRow()]);
    const bodies = stubWrite(cleanups, "/api/v1/container-counts", "POST", () => ({}));
    const user = userEvent.setup();

    await renderPage();
    const form = await openCountFor("Bodega Santa Rosa");
    await user.type(within(form).getByLabelText("Contado de Bidón (V)"), "9");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));
    expect(screen.getByRole("group", { name: /Revisar conteo/ }).textContent).toContain(
      "diferencia +3",
    );

    await user.click(screen.getByRole("button", { name: "Volver a contar" }));

    expect(screen.getByRole("form", { name: /Contar envases de/ })).toBeTruthy();
    expect((screen.getByLabelText("Contado de Bidón (V)") as HTMLInputElement).value).toBe("9");
    expect(bodies).toHaveLength(0);
  });

  it("contar cero es un dato válido y se envía como 0", async () => {
    stubBalances(() => [buildRow()]);
    const bodies = stubWrite(cleanups, "/api/v1/container-counts", "POST", () => ({}));
    const user = userEvent.setup();

    await renderPage();
    const form = await openCountFor("Bodega Santa Rosa");
    await user.type(within(form).getByLabelText("Contado de Bidón (V)"), "0");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));

    expect(screen.getByRole("group", { name: /Revisar conteo/ }).textContent).toContain(
      "según el sistema 6, contado 0",
    );
    await user.click(screen.getByRole("button", { name: "Confirmar conteo" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0] as { countedQuantity: number }).countedQuantity).toBe(0);
  });

  it("un campo en blanco no es un conteo: hay que escribir al menos uno", async () => {
    stubBalances(() => [buildRow()]);
    const bodies = stubWrite(cleanups, "/api/v1/container-counts", "POST", () => ({}));

    await renderPage();
    const form = await openCountFor("Bodega Santa Rosa");
    await userEvent.setup().click(within(form).getByRole("button", { name: "Registrar conteo" }));

    expect((await within(form).findByRole("alert")).textContent).toContain(
      "Escribe lo contado de al menos un tipo de envase",
    );
    expect(bodies).toHaveLength(0);
  });

  it("permite contar un tipo que la ubicación no tenía según el sistema", async () => {
    stubBalances(() => [UNTOUCHED]);
    const bodies = stubWrite(cleanups, "/api/v1/container-counts", "POST", () => ({}));
    const user = userEvent.setup();

    await renderPage();
    const form = await openCountFor("Kiosko Sin Tocar");
    expect(within(form).getByText(/no tiene envases de ningún tipo/)).toBeTruthy();

    await user.click(within(form).getByLabelText("Otro tipo de envase encontrado"));
    await user.click(await screen.findByRole("option", { name: "Bidón (R)" }));
    await user.click(within(form).getByRole("button", { name: "Agregar tipo" }));

    expect(within(form).getByText("Según el sistema: 0")).toBeTruthy();

    await user.type(within(form).getByLabelText("Contado de Bidón (R)"), "2");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));
    expect(screen.getByRole("group", { name: /Revisar conteo/ }).textContent).toContain(
      "Bidón (R): según el sistema 0, contado 2",
    );
    await user.click(screen.getByRole("button", { name: "Confirmar conteo" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies).toEqual([
      { locationId: UNTOUCHED.location.id, containerTypeId: TYPE_R.id, countedQuantity: 2 },
    ]);
  });

  it("registra un conteo por cada tipo con valor, y omite los que quedaron en blanco", async () => {
    stubBalances(() => [NEGATIVE]);
    const bodies = stubWrite(cleanups, "/api/v1/container-counts", "POST", () => ({}));

    await renderPage();
    const form = await openCountFor("Panadería Aurora");
    expect(within(form).getByText("Según el sistema: -1")).toBeTruthy();
    await userEvent.setup().type(within(form).getByLabelText("Contado de Bidón (R)"), "2");
    await userEvent.setup().click(within(form).getByRole("button", { name: "Registrar conteo" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies).toEqual([
      { locationId: NEGATIVE.location.id, containerTypeId: TYPE_R.id, countedQuantity: 2 },
    ]);
  });

  it("muestra el error del backend tal cual y deja el formulario abierto", async () => {
    stubBalances(() => [buildRow()]);
    stubWrite(
      cleanups,
      "/api/v1/container-counts",
      "POST",
      failWith(400, 'El tipo de envase "Bidón (V)" está retirado'),
    );
    const user = userEvent.setup();

    await renderPage();
    const form = await openCountFor("Bodega Santa Rosa");
    await user.type(within(form).getByLabelText("Contado de Bidón (V)"), "6");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));

    expect((await within(form).findByRole("alert")).textContent).toContain(
      'El tipo de envase "Bidón (V)" está retirado',
    );
    expect(screen.getByRole("form", { name: /Contar envases de/ })).toBeTruthy();
  });

  it("«Cancelar» cierra el conteo sin tocar la API", async () => {
    stubBalances(() => [buildRow()]);
    const bodies = stubWrite(cleanups, "/api/v1/container-counts", "POST", () => ({}));

    await renderPage();
    await openCountFor("Bodega Santa Rosa");
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("form")).toBeNull();
    expect(within(rowOf("Bodega Santa Rosa")).getByRole("button", { name: "Contar" })).toBeTruthy();
    expect(bodies).toHaveLength(0);
  });

  it("muestra el error de carga y permite reintentar", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/container-balances", {
        method: "GET",
        handler: (event: H3Event) => {
          attempt++;
          if (attempt <= 3) return failWith(500, "Base de datos no disponible")(event);
          return pageOf([buildRow()]);
        },
      }),
    );

    await renderPage();

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");

    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Bodega Santa Rosa")).toBeTruthy();
  });

  it("muestra un estado vacío cuando no hay ubicaciones", async () => {
    stubBalances(() => []);

    await renderPage();

    expect(await screen.findByText("Todavía no hay ubicaciones")).toBeTruthy();
  });
});
