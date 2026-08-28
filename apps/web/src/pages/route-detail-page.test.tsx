import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { Route as RouteDto, RouteStop } from "../api/routes";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { RouteDetailPage } from "./route-detail-page";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
const DRIVER_ID = "33333333-3333-4333-8333-333333333333";

function stop(overrides: Partial<RouteStop> = {}): RouteStop {
  const position = overrides.position ?? 1;
  return {
    id: `stop-${String(position)}`,
    routeId: ROUTE_ID,
    position,
    origin: "ORDER",
    locationId: "loc-1",
    location: {
      id: "loc-1",
      name: "Principal",
      address: "Av. Siempre Viva 123",
      customer: { id: "cus-1", name: "Bodega Central" },
    },
    orderId: null,
    status: "PENDING",
    failureReason: null,
    ...overrides,
  };
}

function buildRoute(overrides: Partial<RouteDto> = {}): RouteDto {
  return {
    id: ROUTE_ID,
    date: "2026-08-28",
    driverId: DRIVER_ID,
    driver: { id: DRIVER_ID, name: "Luis Quispe" },
    zoneId: null,
    zone: null,
    status: "PLANNED",
    createdById: "admin-1",
    createdAt: "2026-08-28T14:30:00.000Z",
    stops: [],
    ...overrides,
  };
}

function stubRoute(route: RouteDto): void {
  server.use(http.get(`${API_BASE_URL}/routes/${ROUTE_ID}`, () => HttpResponse.json(route)));
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/routes/:routeId" element={<RouteDetailPage />} />
      <Route path="/routes" element={<h1>Rutas</h1>} />
    </Routes>,
    `/routes/${ROUTE_ID}`,
  );
}

describe("RouteDetailPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
  });

  it("muestra el día, el chofer, el estado y la zona de la ruta", async () => {
    stubRoute(
      buildRoute({ status: "IN_PROGRESS", zoneId: "z1", zone: { id: "z1", name: "Norte" } }),
    );

    renderPage();

    // "2026-08-28" se parte como texto: con Date sería el 27 en Lima (UTC-5).
    expect(await screen.findByRole("heading", { name: "Ruta del 28/08/2026" })).toBeInTheDocument();
    expect(screen.getAllByText("Luis Quispe").length).toBeGreaterThan(0);
    expect(screen.getByText("En curso")).toBeInTheDocument();
    expect(screen.getByText("Norte")).toBeInTheDocument();
  });

  it("una ruta recién planificada dice que todavía no tiene paradas", async () => {
    stubRoute(buildRoute());

    renderPage();

    expect(await screen.findByText("Esta ruta todavía no tiene paradas")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Sin zona")).toBeInTheDocument();
  });

  it("lista las paradas en el orden en que el chofer las visita, con origen y estado", async () => {
    stubRoute(
      buildRoute({
        status: "IN_PROGRESS",
        stops: [
          stop({ position: 1, status: "DELIVERED" }),
          stop({
            position: 2,
            origin: "VAN_SALE",
            status: "FAILED",
            failureReason: "El local estaba cerrado",
            location: {
              id: "loc-2",
              name: "Depósito",
              address: "Jr. Puno 45",
              customer: { id: "cus-2", name: "Kiosco La Esquina" },
            },
          }),
        ],
      }),
    );

    renderPage();

    // La fila nombra al CLIENTE, no a la locación: "Principal" se repetiría en
    // toda la hoja de ruta y no diría a quién va cada parada.
    const delivered = (await screen.findByText("Bodega Central")).closest("tr") as HTMLElement;
    expect(within(delivered).getByText("Principal · Av. Siempre Viva 123")).toBeInTheDocument();
    expect(within(delivered).getByText("Pedido")).toBeInTheDocument();
    expect(within(delivered).getByText("Entregada")).toBeInTheDocument();

    const failed = screen.getByText("Kiosco La Esquina").closest("tr") as HTMLElement;
    expect(within(failed).getByText("Autoventa")).toBeInTheDocument();
    expect(within(failed).getByText("No entregada")).toBeInTheDocument();
    expect(within(failed).getByText("El local estaba cerrado")).toBeInTheDocument();
  });

  it("una ruta que no existe ofrece volver a la lista", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_BASE_URL}/routes/${ROUTE_ID}`, () =>
        HttpResponse.json({ message: `La ruta "${ROUTE_ID}" no existe` }, { status: 404 }),
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
      http.get(`${API_BASE_URL}/routes/${ROUTE_ID}`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json(buildRoute());
      }),
    );
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("heading", { name: "Ruta del 28/08/2026" })).toBeInTheDocument();
  });
});
