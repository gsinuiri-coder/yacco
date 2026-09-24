import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, readBody } from "h3";
import type { H3Event } from "h3";
import type { ProductionBatch, RouteLoad, RouteStatus } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildRoute } from "../support/fixtures";
import { failWith } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const LOADS = "/api/v1/routes/r-1/loads";

function batch(code: string, date: string, availableQty: number, itemId: string): ProductionBatch {
  return {
    id: `batch-${code}`,
    code,
    date,
    filledById: "u-1",
    filledBy: { id: "u-1", name: "Administrador" },
    notes: null,
    items: [
      {
        id: itemId,
        containerTypeId: "ct-bidon",
        containerType: { id: "ct-bidon", name: "Bidón 20L" },
        producedQty: availableQty,
        availableQty,
      },
    ],
  };
}

function load(id: string, quantity: number, code = "LOTE-A"): RouteLoad {
  return {
    id,
    routeId: "r-1",
    batchItemId: `item-${id}`,
    batchItem: {
      id: `item-${id}`,
      containerTypeId: "ct-bidon",
      containerType: { id: "ct-bidon", name: "Bidón 20L" },
      batchId: `batch-${code}`,
      batch: { id: `batch-${code}`, code },
    },
    quantity,
  };
}

/** La ruta, su carga (que cambia tras cada escritura), los lotes y los tipos de envase. */
function stubSection(
  status: RouteStatus,
  loadVersions: Array<RouteLoad[] | "falla">,
  batches: ProductionBatch[] = [],
) {
  let loadCalls = 0;
  const batchQueries: Array<Record<string, unknown>> = [];
  cleanups.push(
    registerEndpoint("/api/v1/routes/r-1", {
      method: "GET",
      handler: () => buildRoute({ status }),
    }),
    registerEndpoint(LOADS, {
      method: "GET",
      handler: (event: H3Event) => {
        const version = loadVersions[Math.min(loadCalls++, loadVersions.length - 1)]!;
        return version === "falla" ? failWith(500, "Base de datos no disponible")(event) : version;
      },
    }),
    registerEndpoint("/api/v1/production-batches", (event: H3Event) => {
      batchQueries.push(getQuery(event));
      return { data: batches, total: batches.length, page: 1, limit: 100, totalPages: 1 };
    }),
    registerEndpoint("/api/v1/container-types", () => [
      { id: "ct-bidon", name: "Bidón 20L", active: true },
    ]),
  );
  return { batchQueries };
}

async function renderSection() {
  await renderSuspended(App, { route: "/routes/r-1" });
  await screen.findByRole("heading", { name: "Carga del camión" });
}

async function fill(type: string | null, quantity: string) {
  const user = userEvent.setup();
  if (type !== null) {
    await user.click(screen.getByLabelText("Tipo de envase"));
    await user.click(await screen.findByRole("option", { name: type }));
  }
  if (quantity !== "") await user.type(screen.getByLabelText("Cantidad"), quantity);
  await user.click(screen.getByRole("button", { name: "Cargar al camión" }));
}

describe("Carga del camión", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("el camión vacío lo dice e invita a cargarlo", async () => {
    stubSection("PLANNED", [[]]);

    await renderSection();

    expect(await screen.findByText("El camión todavía va vacío")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Cargar el camión" })).toBeTruthy();
  });

  it("pide sólo lotes con stock y reparte entre dos lotes del más viejo al más nuevo, un POST por lote", async () => {
    const { batchQueries } = stubSection(
      "PLANNED",
      [[], [load("l-1", 30, "LOTE-A"), load("l-2", 20, "LOTE-B")]],
      [batch("LOTE-A", "2026-08-01", 30, "item-a"), batch("LOTE-B", "2026-08-03", 40, "item-b")],
    );
    const posted: unknown[] = [];
    cleanups.push(
      registerEndpoint(LOADS, {
        method: "POST",
        handler: async (event: H3Event) => {
          posted.push(await readBody(event));
          return load(`l-${posted.length}`, 1);
        },
      }),
    );
    const user = userEvent.setup();

    await renderSection();
    await user.click(screen.getByLabelText("Tipo de envase"));
    await user.click(await screen.findByRole("option", { name: "Bidón 20L" }));
    await user.type(screen.getByLabelText("Cantidad"), "50");

    expect(
      await screen.findByText("Sale de: 30 del LOTE-A (01/08/2026), 20 del LOTE-B (03/08/2026)"),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cargar al camión" }));

    expect(await screen.findByText("50 × Bidón 20L")).toBeTruthy();
    expect(posted).toEqual([
      { batchItemId: "item-a", quantity: 30 },
      { batchItemId: "item-b", quantity: 20 },
    ]);
    expect(batchQueries[0]).toEqual({ withStock: "true", limit: "100" });
  });

  it("si la planta no tiene tantas unidades no llama a la API y dice cuántas hay", async () => {
    stubSection("PLANNED", [[]], [batch("LOTE-A", "2026-08-01", 10, "item-a")]);
    let posts = 0;
    cleanups.push(
      registerEndpoint(LOADS, {
        method: "POST",
        handler: () => {
          posts++;
          return {};
        },
      }),
    );

    await renderSection();
    await fill("Bidón 20L", "50");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "En la planta hay 10 disponibles de ese envase; no alcanzan para 50",
    );
    expect(posts).toBe(0);
  });

  it("sin tipo elegido lo pide; una cantidad que no es entero positivo se rechaza antes de llamar", async () => {
    stubSection("PLANNED", [[]], [batch("LOTE-A", "2026-08-01", 10, "item-a")]);

    await renderSection();
    await fill(null, "5");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Elige qué tipo de envase sube al camión",
    );

    await userEvent.setup().clear(screen.getByLabelText("Cantidad"));
    await fill("Bidón 20L", "0");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "La cantidad debe ser un número entero mayor que 0",
      ),
    );
  });

  it("muestra tal cual el error de la API al cargar, y recarga lo que sí se registró", async () => {
    stubSection(
      "PLANNED",
      [[], [load("l-1", 30)]],
      [batch("LOTE-A", "2026-08-01", 30, "item-a"), batch("LOTE-B", "2026-08-03", 40, "item-b")],
    );
    let posts = 0;
    cleanups.push(
      registerEndpoint(LOADS, {
        method: "POST",
        handler: (event: H3Event) => {
          posts++;
          return posts === 1
            ? load("l-1", 30)
            : failWith(400, "El lote LOTE-B no es el más antiguo con stock")(event);
        },
      }),
    );

    await renderSection();
    await fill("Bidón 20L", "50");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "El lote LOTE-B no es el más antiguo con stock",
    );
    expect(await screen.findByText("30 × Bidón 20L")).toBeTruthy();
  });

  it("corregir una carga pide confirmación antes del DELETE", async () => {
    stubSection("PLANNED", [[load("l-1", 30)], []]);
    let deletes = 0;
    cleanups.push(
      registerEndpoint(`${LOADS}/l-1`, {
        method: "DELETE",
        handler: () => {
          deletes++;
          return null;
        },
      }),
    );
    const user = userEvent.setup();

    await renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Corregir la carga del lote LOTE-A" }),
    );
    const confirm = screen.getByRole("group", {
      name: "Confirmar corregir la carga del lote LOTE-A",
    });
    expect(deletes).toBe(0);
    await user.click(within(confirm).getByRole("button", { name: "Sí, quitar" }));

    expect(await screen.findByText("El camión todavía va vacío")).toBeTruthy();
    expect(deletes).toBe(1);
  });

  it("muestra el error de la API al corregir una carga", async () => {
    stubSection("PLANNED", [[load("l-1", 30)]]);
    cleanups.push(
      registerEndpoint(`${LOADS}/l-1`, {
        method: "DELETE",
        handler: failWith(409, "La ruta ya salió"),
      }),
    );
    const user = userEvent.setup();

    await renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Corregir la carga del lote LOTE-A" }),
    );
    await user.click(screen.getByRole("button", { name: "Sí, quitar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("La ruta ya salió");
  });

  it("con la ruta en curso no ofrece corregir y explica por qué", async () => {
    stubSection("IN_PROGRESS", [[load("l-1", 30)]]);

    await renderSection();

    expect(await screen.findByText(/una carga mal ingresada no se borra/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Corregir la carga/ })).toBeNull();
  });

  it("con la ruta en curso separa lo cargado de lo que queda arriba del camión", async () => {
    stubSection("IN_PROGRESS", [[load("l-1", 30)]]);
    cleanups.push(
      registerEndpoint("/api/v1/routes/r-1/truck-stock", () => [
        { containerType: { id: "ct-bidon", name: "Bidón 20L" }, loaded: 30, onBoard: 12 },
      ]),
    );

    await renderSection();

    const loaded = await screen.findByRole("group", { name: "Cargado en el camión" });
    expect(within(loaded).getByText("30 × Bidón 20L")).toBeTruthy();
    const remaining = await screen.findByRole("group", { name: "Queda arriba del camión" });
    expect(within(remaining).getByText("12 × Bidón 20L")).toBeTruthy();
  });

  it("una ruta planificada muestra solo lo cargado: todavía no salió", async () => {
    stubSection("PLANNED", [[load("l-1", 30)]]);

    await renderSection();

    await screen.findByRole("group", { name: "Cargado en el camión" });
    expect(screen.queryByRole("group", { name: "Queda arriba del camión" })).toBeNull();
  });

  it("una ruta terminada no ofrece cargar nada", async () => {
    stubSection("FINISHED", [[]]);

    await renderSection();

    expect(await screen.findByText("Esta ruta salió sin carga registrada.")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Cargar el camión" })).toBeNull();
  });

  it("un error al listar la carga se muestra y se reintenta", async () => {
    stubSection("PLANNED", ["falla", [load("l-1", 30)]]);

    await renderSection();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Base de datos no disponible");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("30 × Bidón 20L")).toBeTruthy();
  });
});
