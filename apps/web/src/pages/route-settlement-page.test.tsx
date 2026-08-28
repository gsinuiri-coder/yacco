import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { RouteSettlement, RouteSettlementExpected } from "../api/route-settlement";
import type { Route as RouteDto, RouteStatus } from "../api/routes";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { RouteSettlementPage } from "./route-settlement-page";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";

function buildRoute(status: RouteStatus = "FINISHED"): RouteDto {
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

/** fullOut 20, entregados 10, vendidos 4 -> deberían volver 6. */
const EXPECTED: RouteSettlementExpected = {
  fullOut: 20,
  fullDelivered: 10,
  fullSold: 4,
  emptiesPickedUp: 14,
  totalSold: "320.00",
  totalCollected: "280.00",
  totalCashCollected: "150.00",
  totalPendingConfirmation: "130.00",
  totalOnCredit: "40.00",
};

function buildSettlement(overrides: Partial<RouteSettlement> = {}): RouteSettlement {
  return {
    routeId: ROUTE_ID,
    fullOut: 20,
    fullDelivered: 10,
    fullSold: 4,
    fullReturned: 6,
    emptiesCollected: 14,
    totalSold: "320.00",
    totalCollected: "280.00",
    totalCashCollected: "150.00",
    totalPendingConfirmation: "130.00",
    totalOnCredit: "40.00",
    notes: null,
    settledById: "admin-1",
    settledAt: "2026-08-28T23:10:00.000Z",
    ...overrides,
  };
}

function stubView(
  status: RouteStatus,
  settlement: RouteSettlement | null,
  unresolvedStops = 0,
): void {
  server.use(
    http.get(`${API_BASE_URL}/routes/${ROUTE_ID}`, () => HttpResponse.json(buildRoute(status))),
    http.get(`${API_BASE_URL}/routes/${ROUTE_ID}/settlement`, () =>
      HttpResponse.json({ expected: EXPECTED, settlement, unresolvedStops }),
    ),
  );
}

/** La vista cambia después de liquidar: la segunda lectura ya trae la fila. */
function stubViewSequence(settlement: RouteSettlement): void {
  let call = 0;
  server.use(
    http.get(`${API_BASE_URL}/routes/${ROUTE_ID}`, () =>
      HttpResponse.json(buildRoute(call === 0 ? "FINISHED" : "SETTLED")),
    ),
    http.get(`${API_BASE_URL}/routes/${ROUTE_ID}/settlement`, () => {
      const body = {
        expected: EXPECTED,
        settlement: call === 0 ? null : settlement,
        unresolvedStops: 0,
      };
      call += 1;
      return HttpResponse.json(body);
    }),
  );
}

function stubSettle(status: number, payload: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post(`${API_BASE_URL}/routes/${ROUTE_ID}/settlement`, async ({ request }) => {
      captured.body = await request.json();
      return HttpResponse.json(payload, { status });
    }),
  );
  return captured;
}

function statOf(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/routes/:routeId/settlement" element={<RouteSettlementPage />} />
      <Route path="/routes/:routeId" element={<h1>Detalle</h1>} />
      <Route path="/routes" element={<h1>Rutas</h1>} />
    </Routes>,
    `/routes/${ROUTE_ID}/settlement`,
  );
}

describe("RouteSettlementPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
  });

  it("muestra lo que dice el libro, incluido cuántos llenos deberían volver", async () => {
    stubView("FINISHED", null);

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Liquidación de la ruta del 28/08/2026" }),
    ).toBeInTheDocument();
    expect(within(statOf("Llenos que salieron")).getByText("20")).toBeInTheDocument();
    expect(within(statOf("Entregados en canje")).getByText("10")).toBeInTheDocument();
    expect(within(statOf("Vendidos completos")).getByText("4")).toBeInTheDocument();
    // 20 - 10 - 4: el número contra el que se cuenta en la puerta.
    expect(within(statOf("Deberían volver")).getByText("6")).toBeInTheDocument();
    expect(within(statOf("Vacíos recogidos")).getByText("14")).toBeInTheDocument();
  });

  it("muestra el dinero como string de 2 decimales, sin pasar por Number", async () => {
    stubView("FINISHED", null);

    renderPage();

    expect(await screen.findByText("S/ 320.00")).toBeInTheDocument();
    expect(screen.getByText("S/ 280.00")).toBeInTheDocument();
    expect(screen.getByText("S/ 150.00")).toBeInTheDocument();
    expect(screen.getByText("S/ 130.00")).toBeInTheDocument();
    expect(screen.getByText("S/ 40.00")).toBeInTheDocument();
  });

  it("con los conteos que cuadran lo dice antes de liquidar", async () => {
    const user = userEvent.setup();
    stubView("FINISHED", null);

    renderPage();
    await user.type(await screen.findByLabelText("Llenos que volvieron sin entregar"), "6");
    await user.type(screen.getByLabelText("Vacíos contados al descargar"), "14");

    expect(await screen.findByText("Con estos números la ruta cuadra.")).toBeInTheDocument();
  });

  // HU-17: la diferencia se registra, no se impide.
  it("anuncia la diferencia antes de liquidar y no bloquea el botón", async () => {
    const user = userEvent.setup();
    stubView("FINISHED", null);

    renderPage();
    await user.type(await screen.findByLabelText("Llenos que volvieron sin entregar"), "4");
    await user.type(screen.getByLabelText("Vacíos contados al descargar"), "16");

    expect(
      await screen.findByText(/Llenos: \+2 \(faltan 2 respecto del libro\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Vacíos: -2 \(sobran 2 respecto del libro\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Liquidar la ruta" })).toBeEnabled();
  });

  it("liquida con una diferencia y la muestra con su número", async () => {
    const user = userEvent.setup();
    const settlement = buildSettlement({ fullReturned: 4, notes: "Se rompieron dos en la ruta" });
    stubViewSequence(settlement);
    const captured = stubSettle(201, {
      settlement,
      differences: { containers: 2, empties: 0 },
    });

    renderPage();
    await user.type(await screen.findByLabelText("Llenos que volvieron sin entregar"), "4");
    await user.type(screen.getByLabelText("Vacíos contados al descargar"), "14");
    await user.type(screen.getByLabelText("Nota (opcional)"), "Se rompieron dos en la ruta");
    await user.click(screen.getByRole("button", { name: "Liquidar la ruta" }));

    expect(captured.body).toEqual({
      fullReturned: 4,
      emptiesCollected: 14,
      notes: "Se rompieron dos en la ruta",
    });
    expect(await screen.findByRole("heading", { name: "Liquidada" })).toBeInTheDocument();
    expect(within(statOf("Diferencia de llenos")).getByText("+2")).toBeInTheDocument();
    expect(within(statOf("Diferencia de vacíos")).getByText("Cuadró")).toBeInTheDocument();
    expect(screen.getByText("Se rompieron dos en la ruta")).toBeInTheDocument();
  });

  it("sin nota, el POST omite el campo en vez de mandarlo vacío", async () => {
    const user = userEvent.setup();
    const settlement = buildSettlement();
    stubViewSequence(settlement);
    const captured = stubSettle(201, { settlement, differences: { containers: 0, empties: 0 } });

    renderPage();
    await user.type(await screen.findByLabelText("Llenos que volvieron sin entregar"), "6");
    await user.type(screen.getByLabelText("Vacíos contados al descargar"), "14");
    await user.click(screen.getByRole("button", { name: "Liquidar la ruta" }));

    expect(captured.body).not.toHaveProperty("notes");
    expect(await screen.findByRole("heading", { name: "Liquidada" })).toBeInTheDocument();
  });

  // Al volver a entrar, la diferencia de llenos se recalcula de la fila
  // persistida con la misma fórmula que usa la API.
  it("una ruta ya liquidada muestra el resultado, sin formulario", async () => {
    stubView("SETTLED", buildSettlement({ fullReturned: 5 }));

    renderPage();

    expect(await screen.findByRole("heading", { name: "Liquidada" })).toBeInTheDocument();
    expect(within(statOf("Diferencia de llenos")).getByText("+1")).toBeInTheDocument();
    expect(screen.queryByLabelText("Llenos que volvieron sin entregar")).not.toBeInTheDocument();
  });

  // Al volver a entrar, la diferencia de vacíos se recalcula contra el libro:
  // el POST ya no está para traerla.
  it("una ruta liquidada recalcula también la diferencia de vacíos", async () => {
    stubView("SETTLED", buildSettlement({ emptiesCollected: 11 }));

    renderPage();

    await screen.findByRole("heading", { name: "Liquidada" });
    // El libro dice 14 recogidos; se contaron 11.
    expect(within(statOf("Diferencia de vacíos")).getByText("+3")).toBeInTheDocument();
  });

  // Deuda técnica conocida: una liquidación congela el dinero del cierre. Si
  // después se rechaza un pago que estaba PENDING, el libro cambia y la fila
  // no. La pantalla lo dice en vez de mostrar un número que ya no es cierto.
  it("avisa cuando el libro se movió después de liquidar", async () => {
    stubView(
      "SETTLED",
      buildSettlement({ totalCollected: "280.00", totalPendingConfirmation: "130.00" }),
    );
    server.use(
      http.get(`${API_BASE_URL}/routes/${ROUTE_ID}/settlement`, () =>
        HttpResponse.json({
          expected: { ...EXPECTED, totalCollected: "150.00", totalPendingConfirmation: "0.00" },
          settlement: buildSettlement({
            totalCollected: "280.00",
            totalPendingConfirmation: "130.00",
          }),
          unresolvedStops: 0,
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText(/el libro hoy dice S\/ 150\.00 cobrado/)).toBeInTheDocument();
  });

  it("una ruta en curso no deja liquidar y lo explica", async () => {
    stubView("IN_PROGRESS", null);

    renderPage();

    expect(
      await screen.findByText(
        "La ruta todavía está en curso. Se puede liquidar cuando esté terminada.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Liquidar la ruta" })).toBeDisabled();
  });

  it("una ruta planificada tampoco deja liquidar", async () => {
    stubView("PLANNED", null);

    renderPage();

    expect(
      await screen.findByText("La ruta todavía no salió. Se puede liquidar cuando esté terminada."),
    ).toBeInTheDocument();
  });

  it("avisa cuando quedan paradas sin resolver", async () => {
    stubView("FINISHED", null, 2);

    renderPage();

    expect(
      await screen.findByText(
        "Quedan 2 paradas sin resolver: lo que haya pasado ahí no está en estos números.",
      ),
    ).toBeInTheDocument();
  });

  it("con una sola parada sin resolver el aviso va en singular", async () => {
    stubView("FINISHED", null, 1);

    renderPage();

    expect(
      await screen.findByText(
        "Queda 1 parada sin resolver: lo que haya pasado ahí no está en estos números.",
      ),
    ).toBeInTheDocument();
  });

  it("sin contar los llenos no llama a la API", async () => {
    const user = userEvent.setup();
    stubView("FINISHED", null);
    const captured = stubSettle(201, {
      settlement: buildSettlement(),
      differences: { containers: 0, empties: 0 },
    });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Liquidar la ruta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Los llenos que volvieron deben ser un número entero, 0 o más",
    );
    expect(captured.body).toBeUndefined();
  });

  it("sin contar los vacíos tampoco llama a la API", async () => {
    const user = userEvent.setup();
    stubView("FINISHED", null);
    const captured = stubSettle(201, {
      settlement: buildSettlement(),
      differences: { containers: 0, empties: 0 },
    });

    renderPage();
    await user.type(await screen.findByLabelText("Llenos que volvieron sin entregar"), "6");
    await user.click(screen.getByRole("button", { name: "Liquidar la ruta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Los vacíos descargados deben ser un número entero, 0 o más",
    );
    expect(captured.body).toBeUndefined();
  });

  // El 403 de Nest es genérico; este sí se traduce al vocabulario de la planta.
  it("un vendedor que intenta liquidar ve por qué no puede", async () => {
    const user = userEvent.setup();
    stubView("FINISHED", null);
    stubSettle(403, { message: "Forbidden resource" });

    renderPage();
    await user.type(await screen.findByLabelText("Llenos que volvieron sin entregar"), "6");
    await user.type(screen.getByLabelText("Vacíos contados al descargar"), "14");
    await user.click(screen.getByRole("button", { name: "Liquidar la ruta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo un administrador puede liquidar la ruta.",
    );
  });

  it("muestra tal cual el 409 del backend cuando la ruta ya no está terminada", async () => {
    const user = userEvent.setup();
    stubView("FINISHED", null);
    stubSettle(409, {
      message: "Solo se puede liquidar una ruta terminada; esta está en SETTLED",
    });

    renderPage();
    await user.type(await screen.findByLabelText("Llenos que volvieron sin entregar"), "6");
    await user.type(screen.getByLabelText("Vacíos contados al descargar"), "14");
    await user.click(screen.getByRole("button", { name: "Liquidar la ruta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo se puede liquidar una ruta terminada",
    );
  });

  it("una ruta que no existe ofrece volver a la lista", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_BASE_URL}/routes/${ROUTE_ID}`, () =>
        HttpResponse.json({ message: "La ruta no existe" }, { status: 404 }),
      ),
      http.get(`${API_BASE_URL}/routes/${ROUTE_ID}/settlement`, () =>
        HttpResponse.json({ message: "La ruta no existe" }, { status: 404 }),
      ),
    );

    renderPage();

    expect(await screen.findByText("Esa ruta no existe")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Volver a rutas" }));

    expect(await screen.findByRole("heading", { name: "Rutas" })).toBeInTheDocument();
  });

  it("muestra el error de carga y permite reintentar", async () => {
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/routes/${ROUTE_ID}`, () => HttpResponse.json(buildRoute())),
      http.get(`${API_BASE_URL}/routes/${ROUTE_ID}/settlement`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json({ expected: EXPECTED, settlement: null, unresolvedStops: 0 });
      }),
    );
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(
      await screen.findByRole("heading", { name: "Lo que dice el libro" }),
    ).toBeInTheDocument();
  });
});
