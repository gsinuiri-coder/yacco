import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { ContainerType } from "../api/container-types";
import type { ProductionBatch } from "../api/production-batches";
import type { Route, RouteLoad, RouteStatus } from "../api/routes";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { RouteLoadsSection } from "./route-loads-section";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
const BIDON = "22222222-2222-4222-8222-222222222222";

const BIDON_TYPE: ContainerType = { id: BIDON, name: "Bidón 20L", active: true };

function buildRoute(status: RouteStatus = "PLANNED"): Route {
  return {
    id: ROUTE_ID,
    date: "2026-08-28",
    driverId: "driver-1",
    driver: { id: "driver-1", name: "Luis Quispe" },
    zoneId: null,
    zone: null,
    status,
    createdById: "admin-1",
    createdAt: "2026-08-28T14:30:00.000Z",
    stops: [],
  };
}

function batch(code: string, date: string, availableQty: number, itemId: string): ProductionBatch {
  return {
    id: `batch-${code}`,
    code,
    date,
    filledById: "admin-1",
    filledBy: { id: "admin-1", name: "Administrador" },
    notes: null,
    items: [
      {
        id: itemId,
        containerTypeId: BIDON,
        containerType: { id: BIDON, name: "Bidón 20L" },
        producedQty: availableQty,
        availableQty,
      },
    ],
  };
}

function buildLoad(id: string, quantity: number, code = "LOTE-A"): RouteLoad {
  return {
    id,
    routeId: ROUTE_ID,
    batchItemId: `item-${id}`,
    batchItem: {
      id: `item-${id}`,
      containerTypeId: BIDON,
      containerType: { id: BIDON, name: "Bidón 20L" },
      batchId: `batch-${code}`,
      batch: { id: `batch-${code}`, code },
    },
    quantity,
  };
}

/** El listado de cargas cambia después de cada escritura. */
function stubLoadsSequence(...versions: RouteLoad[][]): void {
  let call = 0;
  server.use(
    http.get(`${API_BASE_URL}/routes/${ROUTE_ID}/loads`, () => {
      const version = versions[Math.min(call, versions.length - 1)] as RouteLoad[];
      call += 1;
      return HttpResponse.json(version);
    }),
  );
}

function stubCatalogs(
  batches: ProductionBatch[],
  types: ContainerType[] = [BIDON_TYPE],
): {
  batchesUrl: string;
} {
  const captured = { batchesUrl: "" };
  server.use(
    http.get(`${API_BASE_URL}/production-batches`, ({ request }) => {
      captured.batchesUrl = request.url;
      return HttpResponse.json({
        data: batches,
        total: batches.length,
        page: 1,
        limit: 100,
        totalPages: 1,
      });
    }),
    http.get(`${API_BASE_URL}/container-types`, () => HttpResponse.json(types)),
  );
  return captured;
}

function renderSection(status: RouteStatus = "PLANNED") {
  return renderWithProviders(<RouteLoadsSection route={buildRoute(status)} />, "/routes/x");
}

describe("RouteLoadsSection", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
  });

  it("el camión vacío lo dice e invita a cargarlo", async () => {
    stubLoadsSequence([]);
    stubCatalogs([]);

    renderSection();

    expect(await screen.findByText("El camión todavía va vacío")).toBeInTheDocument();
  });

  it("lista lo cargado con su lote y suma el total por tipo de envase", async () => {
    stubLoadsSequence([buildLoad("load-1", 30, "LOTE-A"), buildLoad("load-2", 20, "LOTE-B")]);
    stubCatalogs([]);

    renderSection();

    expect(await screen.findByText("LOTE-A")).toBeInTheDocument();
    expect(screen.getByText("LOTE-B")).toBeInTheDocument();
    expect(screen.getByText("50 × Bidón 20L")).toBeInTheDocument();
  });

  // La regla del dominio: el lote más antiguo primero, siempre.
  it("pide solo lotes con stock y reparte una carga entre dos lotes, del más viejo al más nuevo", async () => {
    const user = userEvent.setup();
    stubLoadsSequence([], [buildLoad("load-1", 30, "LOTE-A"), buildLoad("load-2", 20, "LOTE-B")]);
    const catalogs = stubCatalogs([
      batch("LOTE-A", "2026-08-01", 30, "item-a"),
      batch("LOTE-B", "2026-08-03", 40, "item-b"),
    ]);
    const posted: unknown[] = [];
    server.use(
      http.post(`${API_BASE_URL}/routes/${ROUTE_ID}/loads`, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({ id: `load-${String(posted.length)}` }, { status: 201 });
      }),
    );

    renderSection();
    await user.selectOptions(await screen.findByLabelText("Tipo de envase"), BIDON);
    await user.type(screen.getByLabelText("Cantidad"), "50");

    expect(
      await screen.findByText("Sale de: 30 del LOTE-A (01/08/2026), 20 del LOTE-B (03/08/2026)"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cargar al camión" }));

    expect(posted).toEqual([
      { batchItemId: "item-a", quantity: 30 },
      { batchItemId: "item-b", quantity: 20 },
    ]);
    expect(new URL(catalogs.batchesUrl).searchParams.get("withStock")).toBe("true");
    expect(await screen.findByText("50 × Bidón 20L")).toBeInTheDocument();
  });

  it("no llama a la API cuando la planta no tiene tantas unidades", async () => {
    const user = userEvent.setup();
    stubLoadsSequence([]);
    stubCatalogs([batch("LOTE-A", "2026-08-01", 10, "item-a")]);
    let called = false;
    server.use(
      http.post(`${API_BASE_URL}/routes/${ROUTE_ID}/loads`, () => {
        called = true;
        return HttpResponse.json({ id: "load-1" }, { status: 201 });
      }),
    );

    renderSection();
    await user.selectOptions(await screen.findByLabelText("Tipo de envase"), BIDON);
    await user.type(screen.getByLabelText("Cantidad"), "50");
    await user.click(screen.getByRole("button", { name: "Cargar al camión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "En la planta hay 10 disponibles de ese envase; no alcanzan para 50",
    );
    expect(called).toBe(false);
  });

  it("sin tipo de envase elegido pide elegirlo", async () => {
    const user = userEvent.setup();
    stubLoadsSequence([]);
    stubCatalogs([batch("LOTE-A", "2026-08-01", 10, "item-a")]);

    renderSection();
    await screen.findByLabelText("Tipo de envase");
    await user.click(screen.getByRole("button", { name: "Cargar al camión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elige qué tipo de envase sube al camión",
    );
  });

  it("una cantidad que no es un entero positivo se rechaza antes de llamar", async () => {
    const user = userEvent.setup();
    stubLoadsSequence([]);
    stubCatalogs([batch("LOTE-A", "2026-08-01", 10, "item-a")]);

    renderSection();
    await user.selectOptions(await screen.findByLabelText("Tipo de envase"), BIDON);
    await user.type(screen.getByLabelText("Cantidad"), "0");
    await user.click(screen.getByRole("button", { name: "Cargar al camión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La cantidad debe ser un número entero mayor que 0",
    );
  });

  it("muestra tal cual el error del backend al cargar", async () => {
    const user = userEvent.setup();
    stubLoadsSequence([]);
    stubCatalogs([batch("LOTE-A", "2026-08-01", 30, "item-a")]);
    server.use(
      http.post(`${API_BASE_URL}/routes/${ROUTE_ID}/loads`, () =>
        HttpResponse.json(
          { message: 'Stock insuficiente en el ítem de lote "item-a" para cargar 10 unidades' },
          { status: 400 },
        ),
      ),
    );

    renderSection();
    await user.selectOptions(await screen.findByLabelText("Tipo de envase"), BIDON);
    await user.type(screen.getByLabelText("Cantidad"), "10");
    await user.click(screen.getByRole("button", { name: "Cargar al camión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Stock insuficiente");
  });

  it("corregir una carga pide confirmación antes del DELETE", async () => {
    const user = userEvent.setup();
    stubLoadsSequence([buildLoad("load-1", 30)], []);
    stubCatalogs([]);
    let called = false;
    server.use(
      http.delete(`${API_BASE_URL}/routes/${ROUTE_ID}/loads/load-1`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Corregir la carga del lote LOTE-A" }),
    );

    const confirm = screen.getByRole("group", {
      name: "Confirmar corregir la carga del lote LOTE-A",
    });
    expect(called).toBe(false);

    await user.click(within(confirm).getByRole("button", { name: "Sí, quitar" }));

    expect(called).toBe(true);
    expect(await screen.findByText("El camión todavía va vacío")).toBeInTheDocument();
  });

  // La API solo deja borrar una carga con la ruta PLANNED: una vez que el
  // camión salió, la diferencia se registra al liquidar.
  it("con la ruta en curso no ofrece corregir y explica por qué", async () => {
    stubLoadsSequence([buildLoad("load-1", 30)]);
    stubCatalogs([]);

    renderSection("IN_PROGRESS");

    expect(await screen.findByText("LOTE-A")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Corregir la carga del lote LOTE-A" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /una carga mal ingresada no se borra: la diferencia se registra al liquidar/,
      ),
    ).toBeInTheDocument();
  });

  it("una ruta terminada no ofrece cargar nada", async () => {
    stubLoadsSequence([]);
    stubCatalogs([]);

    renderSection("FINISHED");

    expect(await screen.findByText("Esta ruta salió sin carga registrada.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tipo de envase")).not.toBeInTheDocument();
  });

  it("muestra el error al listar la carga y permite reintentar", async () => {
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/routes/${ROUTE_ID}/loads`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json([buildLoad("load-1", 30)]);
      }),
    );
    stubCatalogs([]);
    const user = userEvent.setup();

    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("LOTE-A")).toBeInTheDocument();
  });

  it("muestra el error del backend al corregir una carga", async () => {
    const user = userEvent.setup();
    stubLoadsSequence([buildLoad("load-1", 30)]);
    stubCatalogs([]);
    server.use(
      http.delete(`${API_BASE_URL}/routes/${ROUTE_ID}/loads/load-1`, () =>
        HttpResponse.json(
          {
            message:
              "Solo se puede corregir una carga mientras la ruta está planificada; esta está en IN_PROGRESS",
          },
          { status: 409 },
        ),
      ),
    );

    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Corregir la carga del lote LOTE-A" }),
    );
    await user.click(screen.getByRole("button", { name: "Sí, quitar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo se puede corregir una carga mientras la ruta está planificada",
    );
  });
});
