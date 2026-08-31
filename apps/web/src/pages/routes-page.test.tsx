import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Route as ReactRoute, Routes as ReactRoutes, useParams } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { Route, RouteStop } from "../api/routes";
import type { User } from "../api/users";
import type { Zone } from "../api/zones";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { RoutesPage } from "./routes-page";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ROUTE_ID = "22222222-2222-4222-8222-222222222222";
const DRIVER_ID = "33333333-3333-4333-8333-333333333333";
const ZONE_ID = "44444444-4444-4444-8444-444444444444";

const DRIVER: User = {
  id: DRIVER_ID,
  name: "Luis Quispe",
  username: "luis",
  active: true,
  roles: ["DRIVER"],
};

const ZONE: Zone = { id: ZONE_ID, name: "Norte", deliveryDays: [], active: true };

function stop(overrides: Partial<RouteStop> = {}): RouteStop {
  return {
    id: `stop-${String(overrides.position ?? 1)}`,
    routeId: ROUTE_ID,
    position: overrides.position ?? 1,
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
    correction: null,
    ...overrides,
  };
}

const ROUTE: Route = {
  id: ROUTE_ID,
  date: "2026-08-28",
  driverId: DRIVER_ID,
  driver: { id: DRIVER_ID, name: "Luis Quispe" },
  zoneId: ZONE_ID,
  zone: { id: ZONE_ID, name: "Norte" },
  status: "IN_PROGRESS",
  createdById: "admin-1",
  createdAt: "2026-08-28T12:00:00.000Z",
  stops: [
    stop({ position: 1, status: "DELIVERED" }),
    stop({ position: 2, status: "FAILED" }),
    stop({ position: 3, status: "PENDING" }),
  ],
};

const ROUTE_WITHOUT_ZONE: Route = {
  ...ROUTE,
  id: OTHER_ROUTE_ID,
  date: "2026-08-27",
  zoneId: null,
  zone: null,
  status: "PLANNED",
  stops: [],
};

/** Los dos catálogos de los filtros; cada test los necesita aunque no los use. */
function stubCatalogs(): void {
  server.use(
    http.get(`${API_BASE_URL}/users`, () => HttpResponse.json([DRIVER])),
    http.get(`${API_BASE_URL}/zones`, () => HttpResponse.json([ZONE])),
  );
}

function stubList(routes: Route[]): { url: string } {
  const captured = { url: "" };
  server.use(
    http.get(`${API_BASE_URL}/routes`, ({ request }) => {
      captured.url = request.url;
      return HttpResponse.json({
        data: routes,
        total: routes.length,
        page: 1,
        limit: 20,
        totalPages: routes.length === 0 ? 0 : 1,
      });
    }),
  );
  return captured;
}

function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

/** Destino real del router en memoria: prueba a qué ruta lleva un clic. */
function StubRouteDetail() {
  const { routeId } = useParams<{ routeId: string }>();
  return <h1>Detalle de {routeId}</h1>;
}

function renderPage() {
  return renderWithProviders(
    <ReactRoutes>
      <ReactRoute path="/routes" element={<RoutesPage />} />
      <ReactRoute path="/routes/:routeId" element={<StubRouteDetail />} />
    </ReactRoutes>,
    "/routes",
  );
}

describe("RoutesPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
    stubCatalogs();
  });

  it("lista las rutas con día, chofer, zona, estado y el resumen de paradas", async () => {
    stubList([ROUTE, ROUTE_WITHOUT_ZONE]);

    renderPage();

    // El día viaja como "2026-08-28" y se muestra como 28/08/2026: nunca pasa
    // por Date, que en Lima (UTC-5) lo leería un día antes.
    await screen.findByText("28/08/2026");
    const row = rowOf("28/08/2026");
    expect(within(row).getByText("Luis Quispe")).toBeInTheDocument();
    expect(within(row).getByText("Norte")).toBeInTheDocument();
    expect(within(row).getByText("En curso")).toBeInTheDocument();
    expect(within(row).getByText("3 paradas")).toBeInTheDocument();
    expect(within(row).getByText("1 entregada · 1 no entregada · 1 pendiente")).toBeInTheDocument();

    const other = rowOf("27/08/2026");
    expect(within(other).getByText("Sin zona")).toBeInTheDocument();
    expect(within(other).getByText("Planificada")).toBeInTheDocument();
    expect(within(other).getByText("Sin paradas")).toBeInTheDocument();
  });

  it("elegir un chofer manda driverId en la consulta", async () => {
    const user = userEvent.setup();
    const captured = stubList([ROUTE]);

    renderPage();
    await screen.findByText("28/08/2026");
    await user.selectOptions(await screen.findByLabelText("Chofer"), DRIVER_ID);

    await waitFor(() => expect(new URL(captured.url).searchParams.get("driverId")).toBe(DRIVER_ID));
  });

  it("elegir un estado manda status y «Limpiar filtros» lo deshace", async () => {
    const user = userEvent.setup();
    const captured = stubList([ROUTE]);

    renderPage();
    await screen.findByText("28/08/2026");
    await user.selectOptions(await screen.findByLabelText("Estado"), "SETTLED");

    await waitFor(() => expect(new URL(captured.url).searchParams.get("status")).toBe("SETTLED"));

    await user.click(await screen.findByRole("button", { name: "Limpiar filtros" }));

    await waitFor(() => expect(new URL(captured.url).searchParams.get("status")).toBeNull());
  });

  it("filtrar por día y por zona manda ambos como texto, sin pasar por Date", async () => {
    const user = userEvent.setup();
    const captured = stubList([ROUTE]);

    renderPage();
    await screen.findByText("28/08/2026");
    await user.type(screen.getByLabelText("Día"), "2026-08-28");
    await user.selectOptions(await screen.findByLabelText("Zona"), ZONE_ID);

    await waitFor(() => {
      const params = new URL(captured.url).searchParams;
      expect(params.get("date")).toBe("2026-08-28");
      expect(params.get("zoneId")).toBe(ZONE_ID);
    });
  });

  it("hacer clic en una fila abre el detalle de esa ruta", async () => {
    const user = userEvent.setup();
    stubList([ROUTE]);

    renderPage();
    await user.click(await screen.findByText("28/08/2026"));

    expect(
      await screen.findByRole("heading", { name: `Detalle de ${ROUTE_ID}` }),
    ).toBeInTheDocument();
  });

  it("«Siguiente» pide la página 2", async () => {
    const user = userEvent.setup();
    const captured = { url: "" };
    server.use(
      http.get(`${API_BASE_URL}/routes`, ({ request }) => {
        captured.url = request.url;
        const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
        return HttpResponse.json({
          data: [page === 1 ? ROUTE : ROUTE_WITHOUT_ZONE],
          total: 2,
          page,
          limit: 1,
          totalPages: 2,
        });
      }),
    );

    renderPage();
    await screen.findByText("28/08/2026");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(await screen.findByText("27/08/2026")).toBeInTheDocument();
    expect(new URL(captured.url).searchParams.get("page")).toBe("2");
  });

  it("sin rutas y sin filtros invita a planificar la primera", async () => {
    stubList([]);

    renderPage();

    expect(await screen.findByText("Todavía no hay rutas")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planificar ruta" })).toHaveAttribute(
      "href",
      "/routes/new",
    );
  });

  it("muestra el error de carga y permite reintentar", async () => {
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/routes`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json({ data: [ROUTE], total: 1, page: 1, limit: 20, totalPages: 1 });
      }),
    );
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("28/08/2026")).toBeInTheDocument();
  });

  it("un catálogo caído deja el filtro sin opciones pero no rompe la lista", async () => {
    server.use(
      http.get(`${API_BASE_URL}/users`, () =>
        HttpResponse.json({ message: "no" }, { status: 500 }),
      ),
      http.get(`${API_BASE_URL}/zones`, () =>
        HttpResponse.json({ message: "no" }, { status: 500 }),
      ),
    );
    stubList([ROUTE]);

    renderPage();

    expect(await screen.findByText("28/08/2026")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Chofer")).getAllByRole("option")).toHaveLength(1);
  });
});
