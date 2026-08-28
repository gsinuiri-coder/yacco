import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { ContainerBalanceRow, PaginatedContainerBalances } from "../api/container-balances";
import type { ContainerCount, CreateContainerCountBody } from "../api/container-counts";
import type { ContainerType } from "../api/container-types";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { ContainerCountsPage, startOfLimaDay } from "./container-counts-page";

const TYPE_V: ContainerType = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Bidón (V)",
  active: true,
};
const TYPE_R: ContainerType = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Bidón (R)",
  active: true,
};

const RECENT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const OLD = "2026-01-05T15:00:00.000Z";

function buildRow(overrides: Partial<ContainerBalanceRow> = {}): ContainerBalanceRow {
  return {
    customer: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Bodega Santa Rosa",
      active: true,
    },
    location: { id: "22222222-2222-4222-8222-222222222222", name: "Principal", active: true },
    zone: { id: "33333333-3333-4333-8333-333333333333", name: "Norte" },
    totalQuantity: 6,
    lastCountedAt: RECENT,
    containers: [{ containerType: TYPE_V, quantity: 6, lastCountedAt: RECENT }],
    ...overrides,
  };
}

const UNTOUCHED = buildRow({
  customer: { id: "44444444-4444-4444-8444-444444444444", name: "Kiosko Sin Tocar", active: true },
  location: { id: "55555555-5555-4555-8555-555555555555", name: "Principal", active: true },
  zone: null,
  totalQuantity: 0,
  lastCountedAt: null,
  containers: [],
});

const NEGATIVE = buildRow({
  customer: { id: "66666666-6666-4666-8666-666666666666", name: "Panadería Aurora", active: true },
  location: { id: "77777777-7777-4777-8777-777777777777", name: "Sucursal", active: true },
  totalQuantity: 1,
  lastCountedAt: null,
  containers: [
    { containerType: TYPE_V, quantity: -1, lastCountedAt: null },
    { containerType: TYPE_R, quantity: 2, lastCountedAt: null },
  ],
});

const CLOSED = buildRow({
  customer: { id: "88888888-8888-4888-8888-888888888888", name: "Bodega Cerrada", active: false },
  location: { id: "99999999-9999-4999-8999-999999999999", name: "Principal", active: false },
  totalQuantity: 3,
  lastCountedAt: OLD,
  containers: [{ containerType: TYPE_V, quantity: 3, lastCountedAt: OLD }],
});

/**
 * Serves the report the way the API does: filters by `uncountedOnly`, and
 * `total` counts the filtered rows so the progress calls (limit=1) get the
 * right number. Returns the URLs seen so a test can assert the query.
 */
function stubBalances(rows: () => ContainerBalanceRow[]): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(`${API_BASE_URL}/container-balances`, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      const uncountedOnly = url.searchParams.get("uncountedOnly") === "true";
      const filtered = rows().filter((row) => !uncountedOnly || row.lastCountedAt === null);
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const body: PaginatedContainerBalances = {
        data: filtered.slice(0, limit),
        total: filtered.length,
        page: 1,
        limit,
        totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
      };
      return HttpResponse.json(body);
    }),
  );
  return seen;
}

function stubTypes(types: ContainerType[] = [TYPE_V, TYPE_R]): void {
  server.use(http.get(`${API_BASE_URL}/container-types`, () => HttpResponse.json(types)));
}

/** Records every count POSTed and answers like the API (snapshotting expected). */
function stubCounts(
  expectedFor: (body: CreateContainerCountBody) => number,
  status = 201,
  errorMessage = "",
): CreateContainerCountBody[] {
  const bodies: CreateContainerCountBody[] = [];
  server.use(
    http.post(`${API_BASE_URL}/container-counts`, async ({ request }) => {
      const body = (await request.json()) as CreateContainerCountBody;
      bodies.push(body);
      if (status !== 201) {
        return HttpResponse.json({ message: errorMessage }, { status });
      }
      const expectedQuantity = expectedFor(body);
      const response: ContainerCount = {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        locationId: body.locationId,
        location: { id: body.locationId, name: "Principal" },
        containerTypeId: body.containerTypeId,
        containerType: { id: body.containerTypeId, name: "Bidón" },
        countedAt: new Date().toISOString(),
        countedQuantity: body.countedQuantity,
        expectedQuantity,
        adjustmentId:
          body.countedQuantity === expectedQuantity ? null : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        countedById: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      };
      return HttpResponse.json(response, { status: 201 });
    }),
  );
  return bodies;
}

function rowOf(customerName: string): HTMLElement {
  const row = screen.getByText(customerName).closest("tr");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function renderPage() {
  return renderWithProviders(<ContainerCountsPage />, "/container-counts");
}

async function openCountFor(user: ReturnType<typeof userEvent.setup>, customerName: string) {
  await user.click(within(rowOf(customerName)).getByRole("button", { name: "Contar" }));
  return screen.getByRole("form", { name: /Contar envases de/ });
}

describe("startOfLimaDay", () => {
  it("escribe el inicio del día en Lima como texto, sin pasar por Date", () => {
    expect(startOfLimaDay("2026-03-01")).toBe("2026-03-01T00:00:00-05:00");
    expect(startOfLimaDay("")).toBeUndefined();
    expect(startOfLimaDay("ayer")).toBeUndefined();
  });
});

describe("ContainerCountsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
    stubTypes();
  });

  it("lista las ubicaciones con su estado y comunica el avance", async () => {
    stubBalances(() => [buildRow(), UNTOUCHED, NEGATIVE, CLOSED]);

    renderPage();

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
    // 4 locations, 2 never counted (UNTOUCHED and NEGATIVE).
    expect(
      await screen.findByText("2 de 4 ubicaciones contadas · 2 sin contar"),
    ).toBeInTheDocument();

    const santaRosa = rowOf("Bodega Santa Rosa");
    expect(within(santaRosa).getByText("Norte")).toBeInTheDocument();
    expect(within(santaRosa).getByText("6 Bidón (V)")).toBeInTheDocument();
    expect(within(santaRosa).queryByText("Sin contar")).not.toBeInTheDocument();
    expect(within(santaRosa).queryByText(/Hace más de/)).not.toBeInTheDocument();

    const untouched = rowOf("Kiosko Sin Tocar");
    expect(within(untouched).getByText("Sin contar")).toBeInTheDocument();
    expect(within(untouched).getByText("Sin zona")).toBeInTheDocument();

    const negative = rowOf("Panadería Aurora");
    expect(within(negative).getByText("Entrega sin registrar")).toBeInTheDocument();
    expect(within(negative).getByText("-1 Bidón (V)")).toBeInTheDocument();
    expect(
      within(negative).getByText(/-1 Bidón \(V\): el cliente devolvió más envases/),
    ).toBeInTheDocument();
    expect(within(negative).getByText(/falta registrar una entrega/)).toBeInTheDocument();

    const closed = rowOf("Bodega Cerrada");
    expect(within(closed).getByText("Hace más de 60 días")).toBeInTheDocument();
    expect(within(closed).getByText("05/01/2026 10:00")).toBeInTheDocument();
  });

  it("una ubicación sin envases ni conteo se ve como sin contar, con total 0", async () => {
    stubBalances(() => [UNTOUCHED]);

    renderPage();

    const row = await screen.findByText("Kiosko Sin Tocar").then(() => rowOf("Kiosko Sin Tocar"));
    expect(within(row).getByText("Sin contar")).toBeInTheDocument();
    expect(within(row).getByText("0")).toBeInTheDocument();
  });

  it("marca al cliente de baja y a la ubicación retirada, sin esconderlos", async () => {
    stubBalances(() => [CLOSED]);

    renderPage();

    const row = await screen.findByText("Bodega Cerrada").then(() => rowOf("Bodega Cerrada"));
    expect(within(row).getByText("Cliente de baja")).toBeInTheDocument();
    expect(within(row).getByText("Ubicación retirada")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Contar" })).toBeInTheDocument();
  });

  it("el filtro «Solo sin contar» pide uncountedOnly=true y deja solo las pendientes", async () => {
    const user = userEvent.setup();
    const seen = stubBalances(() => [buildRow(), UNTOUCHED]);

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByLabelText("Solo sin contar"));

    await waitFor(() => expect(screen.queryByText("Bodega Santa Rosa")).not.toBeInTheDocument());
    expect(screen.getByText("Kiosko Sin Tocar")).toBeInTheDocument();
    const listCalls = seen.filter((url) => url.searchParams.get("limit") === "20");
    expect(listCalls.at(-1)?.searchParams.get("uncountedOnly")).toBe("true");
    expect(listCalls.at(-1)?.searchParams.get("page")).toBe("1");
    expect(screen.getByText("1 ubicación con este filtro")).toBeInTheDocument();
  });

  it("los otros filtros viajan como los espera la API", async () => {
    const user = userEvent.setup();
    const seen = stubBalances(() => [buildRow()]);

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await user.click(screen.getByLabelText("Solo con entregas sin registrar"));
    await user.type(screen.getByLabelText("Contadas antes del"), "2026-03-01");

    await waitFor(() =>
      expect(seen.at(-1)?.searchParams.get("countedBefore")).toBe("2026-03-01T00:00:00-05:00"),
    );
    expect(seen.at(-1)?.searchParams.get("withDiscrepancies")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    await waitFor(() => expect(seen.at(-1)?.searchParams.has("withDiscrepancies")).toBe(false));
    expect(seen.at(-1)?.searchParams.has("countedBefore")).toBe(false);
  });

  it("registra un conteo que coincide sin pedir revisión y actualiza la fila desde el reporte", async () => {
    const user = userEvent.setup();
    let counted = false;
    stubBalances(() => [
      counted
        ? buildRow({ lastCountedAt: "2026-08-25T15:00:00.000Z" })
        : buildRow({
            lastCountedAt: null,
            containers: [{ containerType: TYPE_V, quantity: 6, lastCountedAt: null }],
          }),
    ]);
    const bodies = stubCounts(() => 6);

    renderPage();
    await screen.findByText("Bodega Santa Rosa");
    expect(within(rowOf("Bodega Santa Rosa")).getByText("Sin contar")).toBeInTheDocument();
    await screen.findByText("0 de 1 ubicaciones contadas · 1 sin contar");

    const form = await openCountFor(user, "Bodega Santa Rosa");
    expect(within(form).getByText("Según el sistema: 6")).toBeInTheDocument();
    counted = true;
    await user.type(within(form).getByLabelText("Contado de Bidón (V)"), "6");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));

    expect(await screen.findByText(/Conteo registrado: Bodega Santa Rosa/)).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        locationId: "22222222-2222-4222-8222-222222222222",
        containerTypeId: TYPE_V.id,
        countedQuantity: 6,
      },
    ]);
    const row = rowOf("Bodega Santa Rosa");
    expect(within(row).queryByText("Sin contar")).not.toBeInTheDocument();
    expect(within(row).getByText("25/08/2026 10:00")).toBeInTheDocument();
    expect(
      await screen.findByText("1 de 1 ubicaciones contadas · 0 sin contar"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("un conteo que difiere muestra la diferencia con signo antes de confirmar", async () => {
    const user = userEvent.setup();
    let counted = false;
    stubBalances(() => [
      counted
        ? buildRow({
            totalQuantity: 4,
            containers: [{ containerType: TYPE_V, quantity: 4, lastCountedAt: RECENT }],
          })
        : buildRow(),
    ]);
    const bodies = stubCounts(() => 6);

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    const form = await openCountFor(user, "Bodega Santa Rosa");
    await user.type(within(form).getByLabelText("Contado de Bidón (V)"), "4");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));

    const review = screen.getByRole("group", { name: "Revisar conteo de Principal" });
    expect(review).toHaveTextContent("Bidón (V): según el sistema 6, contado 4 (diferencia -2)");
    expect(bodies).toHaveLength(0);
    // Information, not an error.
    expect(within(review).queryByRole("alert")).not.toBeInTheDocument();

    counted = true;
    await user.click(within(review).getByRole("button", { name: "Confirmar conteo" }));

    expect(bodies).toEqual([
      {
        locationId: "22222222-2222-4222-8222-222222222222",
        containerTypeId: TYPE_V.id,
        countedQuantity: 4,
      },
    ]);
    await waitFor(() =>
      expect(within(rowOf("Bodega Santa Rosa")).getByText("4 Bidón (V)")).toBeInTheDocument(),
    );
  });

  it("«Volver a contar» en la revisión regresa al formulario sin enviar nada", async () => {
    const user = userEvent.setup();
    stubBalances(() => [buildRow()]);
    const bodies = stubCounts(() => 6);

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    const form = await openCountFor(user, "Bodega Santa Rosa");
    await user.type(within(form).getByLabelText("Contado de Bidón (V)"), "9");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));
    expect(screen.getByRole("group", { name: /Revisar conteo/ })).toHaveTextContent(
      "diferencia +3",
    );

    await user.click(screen.getByRole("button", { name: "Volver a contar" }));

    expect(screen.getByRole("form", { name: /Contar envases de/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Contado de Bidón (V)")).toHaveValue(9);
    expect(bodies).toHaveLength(0);
  });

  it("contar cero es un dato válido y se envía como 0", async () => {
    const user = userEvent.setup();
    stubBalances(() => [buildRow()]);
    const bodies = stubCounts(() => 6);

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    const form = await openCountFor(user, "Bodega Santa Rosa");
    await user.type(within(form).getByLabelText("Contado de Bidón (V)"), "0");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));

    expect(screen.getByRole("group", { name: /Revisar conteo/ })).toHaveTextContent(
      "según el sistema 6, contado 0 (diferencia -6)",
    );
    await user.click(screen.getByRole("button", { name: "Confirmar conteo" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.countedQuantity).toBe(0);
  });

  it("un campo en blanco no es un conteo: hay que escribir al menos uno", async () => {
    const user = userEvent.setup();
    stubBalances(() => [buildRow()]);
    const bodies = stubCounts(() => 6);

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    const form = await openCountFor(user, "Bodega Santa Rosa");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));

    expect(within(form).getByRole("alert")).toHaveTextContent(
      "Escribe lo contado de al menos un tipo de envase",
    );
    expect(bodies).toHaveLength(0);
  });

  it("permite contar un tipo que la ubicación no tenía según el sistema", async () => {
    const user = userEvent.setup();
    stubBalances(() => [UNTOUCHED]);
    const bodies = stubCounts(() => 0);

    renderPage();
    await screen.findByText("Kiosko Sin Tocar");

    const form = await openCountFor(user, "Kiosko Sin Tocar");
    expect(within(form).getByText(/no tiene envases de ningún tipo/)).toBeInTheDocument();
    await user.selectOptions(
      within(form).getByLabelText("Otro tipo de envase encontrado"),
      TYPE_R.id,
    );
    await user.click(within(form).getByRole("button", { name: "Agregar tipo" }));

    expect(within(form).getByText("Según el sistema: 0")).toBeInTheDocument();
    // The type is now on the sheet, so it is no longer offered as "another".
    expect(
      within(within(form).getByLabelText("Otro tipo de envase encontrado")).queryByRole("option", {
        name: "Bidón (R)",
      }),
    ).not.toBeInTheDocument();

    await user.type(within(form).getByLabelText("Contado de Bidón (R)"), "2");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));
    expect(screen.getByRole("group", { name: /Revisar conteo/ })).toHaveTextContent(
      "Bidón (R): según el sistema 0, contado 2 (diferencia +2)",
    );
    await user.click(screen.getByRole("button", { name: "Confirmar conteo" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      locationId: UNTOUCHED.location.id,
      containerTypeId: TYPE_R.id,
      countedQuantity: 2,
    });
  });

  it("registra un conteo por cada tipo con valor, y omite los que quedaron en blanco", async () => {
    const user = userEvent.setup();
    stubBalances(() => [NEGATIVE]);
    const bodies = stubCounts((body) => (body.containerTypeId === TYPE_V.id ? -1 : 2));

    renderPage();
    await screen.findByText("Panadería Aurora");

    const form = await openCountFor(user, "Panadería Aurora");
    expect(within(form).getByText("Según el sistema: -1")).toBeInTheDocument();
    await user.type(within(form).getByLabelText("Contado de Bidón (R)"), "2");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      locationId: NEGATIVE.location.id,
      containerTypeId: TYPE_R.id,
      countedQuantity: 2,
    });
  });

  it("muestra el error del backend tal cual y deja el formulario abierto", async () => {
    const user = userEvent.setup();
    stubBalances(() => [buildRow()]);
    stubCounts(() => 6, 400, 'El tipo de envase "Bidón (V)" está retirado');

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    const form = await openCountFor(user, "Bodega Santa Rosa");
    await user.type(within(form).getByLabelText("Contado de Bidón (V)"), "6");
    await user.click(within(form).getByRole("button", { name: "Registrar conteo" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent(
      'El tipo de envase "Bidón (V)" está retirado',
    );
    expect(screen.getByRole("form", { name: /Contar envases de/ })).toBeInTheDocument();
  });

  it("«Cancelar» cierra el conteo sin tocar la API", async () => {
    const user = userEvent.setup();
    stubBalances(() => [buildRow()]);
    const bodies = stubCounts(() => 6);

    renderPage();
    await screen.findByText("Bodega Santa Rosa");

    await openCountFor(user, "Bodega Santa Rosa");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(
      within(rowOf("Bodega Santa Rosa")).getByRole("button", { name: "Contar" }),
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("muestra el error de carga y permite reintentar", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/container-balances`, () => {
        attempt += 1;
        if (attempt <= 3) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        const body: PaginatedContainerBalances = {
          data: [buildRow()],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        };
        return HttpResponse.json(body);
      }),
    );

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Bodega Santa Rosa")).toBeInTheDocument();
  });

  it("muestra un estado vacío cuando no hay ubicaciones", async () => {
    stubBalances(() => []);

    renderPage();

    expect(await screen.findByText("Todavía no hay ubicaciones")).toBeInTheDocument();
  });
});
