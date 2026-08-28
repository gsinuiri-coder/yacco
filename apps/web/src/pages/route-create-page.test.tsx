import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { Route, Routes, useParams } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { User } from "../api/users";
import type { Zone } from "../api/zones";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { RouteCreatePage } from "./route-create-page";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
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

function stubCatalogs(drivers: User[] = [DRIVER], zones: Zone[] = [ZONE]): { usersUrl: string } {
  const captured = { usersUrl: "" };
  server.use(
    http.get(`${API_BASE_URL}/users`, ({ request }) => {
      captured.usersUrl = request.url;
      return HttpResponse.json(drivers);
    }),
    http.get(`${API_BASE_URL}/zones`, () => HttpResponse.json(zones)),
  );
  return captured;
}

function stubCreate(status: number, payload: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post(`${API_BASE_URL}/routes`, async ({ request }) => {
      captured.body = await request.json();
      return HttpResponse.json(payload, { status });
    }),
  );
  return captured;
}

/** Destino real del router en memoria: prueba a qué ruta se navegó, no un mock. */
function StubRouteDetail() {
  const { routeId } = useParams<{ routeId: string }>();
  return <h1>Detalle de {routeId}</h1>;
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/routes/new" element={<RouteCreatePage />} />
      <Route path="/routes/:routeId" element={<StubRouteDetail />} />
      <Route path="/routes" element={<h1>Rutas</h1>} />
    </Routes>,
    "/routes/new",
  );
}

describe("RouteCreatePage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
  });

  it("solo ofrece choferes: pide /users con role=DRIVER", async () => {
    const catalogs = stubCatalogs();

    renderPage();

    expect(await screen.findByRole("option", { name: "Luis Quispe" })).toBeInTheDocument();
    expect(new URL(catalogs.usersUrl).searchParams.get("role")).toBe("DRIVER");
  });

  it("planifica la ruta y cae en su detalle", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubCreate(201, { id: ROUTE_ID });

    renderPage();
    await user.selectOptions(await screen.findByLabelText("Chofer"), DRIVER_ID);
    await user.selectOptions(screen.getByLabelText("Zona (opcional)"), ZONE_ID);
    await user.click(screen.getByRole("button", { name: "Planificar ruta" }));

    expect(
      await screen.findByRole("heading", { name: `Detalle de ${ROUTE_ID}` }),
    ).toBeInTheDocument();
    expect(captured.body).toEqual({
      driverId: DRIVER_ID,
      // El día por defecto es hoy en Lima, en formato de negocio.
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown as string,
      zoneId: ZONE_ID,
    });
  });

  it("sin zona elegida el POST omite zoneId, no lo manda vacío", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubCreate(201, { id: ROUTE_ID });

    renderPage();
    await user.selectOptions(await screen.findByLabelText("Chofer"), DRIVER_ID);
    await user.click(screen.getByRole("button", { name: "Planificar ruta" }));

    await screen.findByRole("heading", { name: `Detalle de ${ROUTE_ID}` });
    expect(captured.body).not.toHaveProperty("zoneId");
  });

  it("sin chofer no llama a la API y pide elegirlo", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubCreate(201, { id: ROUTE_ID });

    renderPage();
    await screen.findByRole("option", { name: "Luis Quispe" });
    await user.click(screen.getByRole("button", { name: "Planificar ruta" }));

    expect(await screen.findByText("Elige el chofer que va a hacer la ruta")).toBeInTheDocument();
    expect(captured.body).toBeUndefined();
  });

  it("muestra tal cual el error del backend cuando el chofer ya tiene ruta ese día", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    stubCreate(400, {
      message: 'El chofer "Luis Quispe" ya tiene una ruta planificada para el 2026-08-28',
    });

    renderPage();
    await user.selectOptions(await screen.findByLabelText("Chofer"), DRIVER_ID);
    await user.click(screen.getByRole("button", { name: "Planificar ruta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'El chofer "Luis Quispe" ya tiene una ruta planificada para el 2026-08-28',
    );
    expect(screen.getByRole("button", { name: "Planificar ruta" })).toBeEnabled();
  });

  it("si el catálogo de zonas cae, la ruta se planifica igual sin zona", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_BASE_URL}/users`, () => HttpResponse.json([DRIVER])),
      http.get(`${API_BASE_URL}/zones`, () =>
        HttpResponse.json({ message: "no disponible" }, { status: 500 }),
      ),
    );
    const captured = stubCreate(201, { id: ROUTE_ID });

    renderPage();
    await user.selectOptions(await screen.findByLabelText("Chofer"), DRIVER_ID);
    await user.click(screen.getByRole("button", { name: "Planificar ruta" }));

    await screen.findByRole("heading", { name: `Detalle de ${ROUTE_ID}` });
    expect(captured.body).not.toHaveProperty("zoneId");
  });

  it("si el catálogo de choferes cae, lo dice en vez de dejar un select vacío", async () => {
    server.use(
      http.get(`${API_BASE_URL}/users`, () =>
        HttpResponse.json({ message: "no disponible" }, { status: 500 }),
      ),
      http.get(`${API_BASE_URL}/zones`, () => HttpResponse.json([ZONE])),
    );

    renderPage();

    expect(await screen.findByText(/No hay choferes activos/)).toBeInTheDocument();
  });

  it("sin choferes activos lo dice y no deja enviar", async () => {
    stubCatalogs([]);

    renderPage();

    expect(await screen.findByText(/No hay choferes activos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planificar ruta" })).toBeDisabled();
  });

  it("«Cancelar» vuelve a la lista de rutas sin llamar a la API", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubCreate(201, { id: ROUTE_ID });

    renderPage();
    await screen.findByRole("option", { name: "Luis Quispe" });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByRole("heading", { name: "Rutas" })).toBeInTheDocument();
    expect(captured.body).toBeUndefined();
  });
});
