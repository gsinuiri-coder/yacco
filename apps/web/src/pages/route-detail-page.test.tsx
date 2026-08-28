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

/**
 * La ruta cambia entre recargas: cada acción vuelve a pedir `GET /routes/:id`
 * en vez de recomponer el estado a mano, así que el stub tiene que devolver
 * lo que devolvería el servidor después de la escritura.
 */
function stubRouteSequence(...versions: RouteDto[]): void {
  let call = 0;
  server.use(
    http.get(`${API_BASE_URL}/routes/${ROUTE_ID}`, () => {
      const version = versions[Math.min(call, versions.length - 1)] as RouteDto;
      call += 1;
      return HttpResponse.json(version);
    }),
  );
}

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Los catálogos que abre el formulario de agregar parada. */
function stubStopFormCatalogs(pendingOrders = 1): { ordersUrl: string } {
  const captured = { ordersUrl: "" };
  server.use(
    http.get(`${API_BASE_URL}/orders`, ({ request }) => {
      captured.ordersUrl = request.url;
      const data =
        pendingOrders === 0
          ? []
          : [
              {
                id: ORDER_ID,
                customerId: CUSTOMER_ID,
                customer: { id: CUSTOMER_ID, name: "Panadería Trigo", phone: "987000111" },
                deliveryDate: "2026-08-28",
                status: "PENDING",
                createdById: "admin-1",
                createdAt: "2026-08-27T10:00:00.000Z",
                items: [
                  {
                    id: "item-1",
                    productId: "prod-1",
                    product: { id: "prod-1", name: "Bidón 20L" },
                    quantity: 2,
                    unitPrice: "12.50",
                  },
                ],
                total: "25.00",
              },
            ];
      return HttpResponse.json({
        data,
        total: pendingOrders,
        page: 1,
        limit: 100,
        totalPages: 1,
      });
    }),
    http.get(`${API_BASE_URL}/customers`, () =>
      HttpResponse.json({
        data: [
          {
            id: CUSTOMER_ID,
            name: "Panadería Trigo",
            phone: "987000111",
            address: "Jr. Puno 45",
            addressReference: "Al lado del grifo",
            zoneId: null,
            zone: null,
            creditLimit: null,
            debtBalance: "0.00",
            active: true,
            createdAt: "2026-08-01T10:00:00.000Z",
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    ),
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/locations`, () =>
      HttpResponse.json([
        {
          id: LOCATION_ID,
          name: "Principal",
          address: "Jr. Puno 45",
          addressReference: "Al lado del grifo",
          phone: "987000111",
          isPrimary: true,
          active: true,
        },
      ]),
    ),
  );
  return captured;
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

/**
 * La sección de carga vive dentro de esta pantalla y pide sus propios datos.
 * Los tests de aquí no ejercitan la carga (tiene su propio archivo), pero MSW
 * falla ante una petición no declarada, así que se declaran vacías.
 */
function stubEmptyLoads(): void {
  server.use(
    http.get(`${API_BASE_URL}/routes/${ROUTE_ID}/loads`, () => HttpResponse.json([])),
    http.get(`${API_BASE_URL}/production-batches`, () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get(`${API_BASE_URL}/container-types`, () => HttpResponse.json([])),
  );
}

describe("RouteDetailPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
    stubEmptyLoads();
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

  describe("iniciar y terminar", () => {
    it("iniciar la ruta la pasa a en curso de un clic", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute());
      let called = false;
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/start`, () => {
          called = true;
          return HttpResponse.json(buildRoute({ status: "IN_PROGRESS" }));
        }),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Iniciar ruta" }));

      expect(called).toBe(true);
      expect(await screen.findByText("En curso")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Terminar ruta" })).toBeInTheDocument();
    });

    it("terminar avisa cuántas paradas quedan sin resolver y no bloquea", async () => {
      const user = userEvent.setup();
      const inProgress = buildRoute({
        status: "IN_PROGRESS",
        stops: [stop({ position: 1 }), stop({ position: 2, status: "DELIVERED" })],
      });
      stubRoute(inProgress);
      let called = false;
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/finish`, () => {
          called = true;
          return HttpResponse.json({ ...inProgress, status: "FINISHED" });
        }),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Terminar ruta" }));

      const confirm = screen.getByRole("group", { name: "Confirmar el fin de la ruta" });
      expect(confirm).toHaveTextContent("Queda 1 parada sin resolver");
      expect(called).toBe(false);

      await user.click(within(confirm).getByRole("button", { name: "Sí, terminar la ruta" }));

      expect(called).toBe(true);
      expect(await screen.findByText("Terminada")).toBeInTheDocument();
    });

    it("«No, todavía no» cierra la confirmación sin llamar a la API", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute({ status: "IN_PROGRESS", stops: [stop({ position: 1 })] }));
      let called = false;
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/finish`, () => {
          called = true;
          return HttpResponse.json(buildRoute({ status: "FINISHED" }));
        }),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Terminar ruta" }));
      await user.click(screen.getByRole("button", { name: "No, todavía no" }));

      expect(
        screen.queryByRole("group", { name: "Confirmar el fin de la ruta" }),
      ).not.toBeInTheDocument();
      expect(called).toBe(false);
    });

    it("un 409 al iniciar muestra el mensaje del backend y recarga la ruta", async () => {
      const user = userEvent.setup();
      stubRouteSequence(buildRoute(), buildRoute({ status: "IN_PROGRESS" }));
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/start`, () =>
          HttpResponse.json(
            { message: "Solo se puede iniciar una ruta planificada; esta está en IN_PROGRESS" },
            { status: 409 },
          ),
        ),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Iniciar ruta" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Solo se puede iniciar una ruta planificada",
      );
      expect(await screen.findByText("En curso")).toBeInTheDocument();
    });

    it("con varias paradas sin resolver el aviso va en plural", async () => {
      const user = userEvent.setup();
      stubRoute(
        buildRoute({
          status: "IN_PROGRESS",
          stops: [stop({ position: 1 }), stop({ position: 2 })],
        }),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Terminar ruta" }));

      expect(screen.getByRole("group", { name: "Confirmar el fin de la ruta" })).toHaveTextContent(
        "Quedan 2 paradas sin resolver",
      );
    });

    it("un 409 al terminar muestra el mensaje del backend y cierra la confirmación", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute({ status: "IN_PROGRESS", stops: [stop({ position: 1 })] }));
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/finish`, () =>
          HttpResponse.json(
            { message: "Solo se puede terminar una ruta en curso; esta está en FINISHED" },
            { status: 409 },
          ),
        ),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Terminar ruta" }));
      await user.click(screen.getByRole("button", { name: "Sí, terminar la ruta" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Solo se puede terminar una ruta en curso",
      );
      expect(
        screen.queryByRole("group", { name: "Confirmar el fin de la ruta" }),
      ).not.toBeInTheDocument();
    });

    it("una ruta terminada sin paradas lo dice sin invitar a agregarlas", async () => {
      stubRoute(buildRoute({ status: "FINISHED" }));

      renderPage();

      expect(
        await screen.findByText("Esta ruta terminó sin paradas: nunca se le agregó ninguna."),
      ).toBeInTheDocument();
    });

    it("una ruta terminada no ofrece iniciar, terminar ni tocar las paradas", async () => {
      stubRoute(buildRoute({ status: "FINISHED", stops: [stop({ position: 1 })] }));

      renderPage();

      expect(await screen.findByText("Terminada")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Iniciar ruta" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Terminar ruta" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Agregar parada" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Quitar la parada/ })).not.toBeInTheDocument();
    });
  });

  describe("armar las paradas", () => {
    it("agrega una parada desde un pedido pendiente y no ofrece los ya asignados", async () => {
      const user = userEvent.setup();
      stubRouteSequence(buildRoute(), buildRoute({ stops: [stop({ position: 1 })] }));
      const catalogs = stubStopFormCatalogs();
      let body: unknown;
      server.use(
        http.post(`${API_BASE_URL}/routes/${ROUTE_ID}/stops`, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ id: "stop-1" }, { status: 201 });
        }),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Agregar parada" }));
      await user.selectOptions(await screen.findByLabelText("Pedido pendiente"), ORDER_ID);
      await user.click(screen.getByRole("button", { name: "Agregar parada" }));

      expect(body).toEqual({ origin: "ORDER", orderId: ORDER_ID });
      // Lo que la API acepta es exactamente lo que el selector ofrece.
      const params = new URL(catalogs.ordersUrl).searchParams;
      expect(params.get("status")).toBe("PENDING");
      expect(params.get("hasRouteStop")).toBe("false");
      expect(await screen.findByText("Bodega Central")).toBeInTheDocument();
    });

    it("agrega una parada de autoventa eligiendo cliente y dirección", async () => {
      const user = userEvent.setup();
      stubRouteSequence(buildRoute(), buildRoute({ stops: [stop({ position: 1 })] }));
      stubStopFormCatalogs();
      let body: unknown;
      server.use(
        http.post(`${API_BASE_URL}/routes/${ROUTE_ID}/stops`, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ id: "stop-1" }, { status: 201 });
        }),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Agregar parada" }));
      await user.selectOptions(
        await screen.findByLabelText("¿De dónde sale la parada?"),
        "VAN_SALE",
      );
      await user.type(screen.getByLabelText("Cliente"), "Panadería");
      await user.click(await screen.findByRole("option", { name: /Panadería Trigo/ }));
      await user.click(screen.getByRole("button", { name: "Agregar parada" }));

      expect(body).toEqual({ origin: "VAN_SALE", locationId: LOCATION_ID });
    });

    it("sin pedidos pendientes lo dice y sugiere la autoventa", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute());
      stubStopFormCatalogs(0);

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Agregar parada" }));

      expect(
        await screen.findByText("Todos los pedidos pendientes ya están en una ruta.", {
          exact: false,
        }),
      ).toBeInTheDocument();
    });

    it("sin elegir nada, no llama a la API y pide elegir el pedido", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute());
      stubStopFormCatalogs();
      let called = false;
      server.use(
        http.post(`${API_BASE_URL}/routes/${ROUTE_ID}/stops`, () => {
          called = true;
          return HttpResponse.json({ id: "stop-1" }, { status: 201 });
        }),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Agregar parada" }));
      await screen.findByLabelText("Pedido pendiente");
      await user.click(screen.getByRole("button", { name: "Agregar parada" }));

      expect(
        await screen.findByText("Elige el pedido que va a entregar el chofer"),
      ).toBeInTheDocument();
      expect(called).toBe(false);
    });

    it("muestra tal cual el error del backend al agregar una parada", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute());
      stubStopFormCatalogs();
      server.use(
        http.post(`${API_BASE_URL}/routes/${ROUTE_ID}/stops`, () =>
          HttpResponse.json(
            { message: `El pedido "${ORDER_ID}" ya está asignado a otra parada` },
            { status: 400 },
          ),
        ),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Agregar parada" }));
      await user.selectOptions(await screen.findByLabelText("Pedido pendiente"), ORDER_ID);
      await user.click(screen.getByRole("button", { name: "Agregar parada" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("ya está asignado a otra parada");
    });

    it("subir una parada manda la lista completa en el orden nuevo", async () => {
      const user = userEvent.setup();
      const first = stop({ position: 1 });
      const second = stop({
        position: 2,
        location: {
          id: "loc-2",
          name: "Principal",
          address: "Jr. Puno 45",
          customer: { id: "cus-2", name: "Kiosco La Esquina" },
        },
      });
      stubRouteSequence(
        buildRoute({ stops: [first, second] }),
        buildRoute({
          stops: [
            { ...second, position: 1 },
            { ...first, position: 2 },
          ],
        }),
      );
      let body: unknown;
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/stops/reorder`, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json(buildRoute());
        }),
      );

      renderPage();
      await user.click(
        await screen.findByRole("button", { name: "Subir la parada de Kiosco La Esquina" }),
      );

      expect(body).toEqual({ stopIds: [second.id, first.id] });
    });

    it("la primera parada no se puede subir y la última no se puede bajar", async () => {
      stubRoute(
        buildRoute({
          stops: [
            stop({ position: 1 }),
            stop({
              position: 2,
              location: {
                id: "loc-2",
                name: "Principal",
                address: "Jr. Puno 45",
                customer: { id: "cus-2", name: "Kiosco La Esquina" },
              },
            }),
          ],
        }),
      );

      renderPage();

      expect(
        await screen.findByRole("button", { name: "Subir la parada de Bodega Central" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Bajar la parada de Kiosco La Esquina" }),
      ).toBeDisabled();
    });

    it("quitar una parada pide confirmación antes de llamar al DELETE", async () => {
      const user = userEvent.setup();
      stubRouteSequence(buildRoute({ stops: [stop({ position: 1 })] }), buildRoute());
      let called = false;
      server.use(
        http.delete(`${API_BASE_URL}/routes/${ROUTE_ID}/stops/stop-1`, () => {
          called = true;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      renderPage();
      await user.click(
        await screen.findByRole("button", { name: "Quitar la parada de Bodega Central" }),
      );

      const confirm = screen.getByRole("group", { name: "Confirmar quitar a Bodega Central" });
      expect(called).toBe(false);

      await user.click(within(confirm).getByRole("button", { name: "Sí, quitar" }));

      expect(called).toBe(true);
      expect(await screen.findByText("Esta ruta todavía no tiene paradas")).toBeInTheDocument();
    });

    // Una parada resuelta tiene venta y movimientos colgando: la API la
    // rechaza, así que la pantalla ni siquiera la ofrece.
    it("una parada ya entregada no ofrece quitarla", async () => {
      stubRoute(
        buildRoute({ status: "IN_PROGRESS", stops: [stop({ position: 1, status: "DELIVERED" })] }),
      );

      renderPage();

      expect(await screen.findByText("Entregada")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Quitar la parada de Bodega Central" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Subir la parada de Bodega Central" }),
      ).toBeInTheDocument();
    });

    it("muestra el error del backend al reordenar", async () => {
      const user = userEvent.setup();
      stubRoute(
        buildRoute({
          stops: [
            stop({ position: 1 }),
            stop({
              position: 2,
              location: {
                id: "loc-2",
                name: "Principal",
                address: "Jr. Puno 45",
                customer: { id: "cus-2", name: "Kiosco La Esquina" },
              },
            }),
          ],
        }),
      );
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/stops/reorder`, () =>
          HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 }),
        ),
      );

      renderPage();
      await user.click(
        await screen.findByRole("button", { name: "Subir la parada de Kiosco La Esquina" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");
    });

    it("un catálogo de pedidos caído lo dice al lado del selector", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute());
      server.use(
        http.get(`${API_BASE_URL}/orders`, () =>
          HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 }),
        ),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Agregar parada" }));

      expect(
        await screen.findByText(/No se pudieron cargar los pedidos pendientes/),
      ).toBeInTheDocument();
    });

    // El selector no pagina: si hay más pendientes que el tope de la API, lo
    // dice en vez de recortar en silencio.
    it("avisa cuando hay más pendientes de los que entran en el selector", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute());
      stubStopFormCatalogs(140);

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Agregar parada" }));

      expect(
        await screen.findByText(/Se muestran los 1 pedidos con entrega más próxima, de 140/),
      ).toBeInTheDocument();
    });

    it("autoventa sin dirección elegida no llama a la API y lo pide", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute());
      stubStopFormCatalogs();
      let called = false;
      server.use(
        http.post(`${API_BASE_URL}/routes/${ROUTE_ID}/stops`, () => {
          called = true;
          return HttpResponse.json({ id: "stop-1" }, { status: 201 });
        }),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Agregar parada" }));
      await user.selectOptions(
        await screen.findByLabelText("¿De dónde sale la parada?"),
        "VAN_SALE",
      );
      await user.click(screen.getByRole("button", { name: "Agregar parada" }));

      expect(
        await screen.findByText("Elige el cliente y la dirección a la que va el chofer"),
      ).toBeInTheDocument();
      expect(called).toBe(false);
    });

    it("«Cancelar» cierra el formulario de parada sin llamar a la API", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute());
      stubStopFormCatalogs();
      let called = false;
      server.use(
        http.post(`${API_BASE_URL}/routes/${ROUTE_ID}/stops`, () => {
          called = true;
          return HttpResponse.json({ id: "stop-1" }, { status: 201 });
        }),
      );

      renderPage();
      await user.click(await screen.findByRole("button", { name: "Agregar parada" }));
      await screen.findByLabelText("Pedido pendiente");
      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(screen.queryByLabelText("Pedido pendiente")).not.toBeInTheDocument();
      expect(called).toBe(false);
    });

    it("solo ofrece registrar la parada con la ruta en curso", async () => {
      stubRoute(buildRoute({ status: "PLANNED", stops: [stop({ position: 1 })] }));

      renderPage();

      expect(await screen.findByText("Bodega Central")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Registrar la parada de Bodega Central" }),
      ).not.toBeInTheDocument();
    });

    it("muestra el error del backend al quitar una parada", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute({ stops: [stop({ position: 1 })] }));
      server.use(
        http.delete(`${API_BASE_URL}/routes/${ROUTE_ID}/stops/stop-1`, () =>
          HttpResponse.json(
            { message: "Solo se puede quitar una parada pendiente; esta está en DELIVERED" },
            { status: 409 },
          ),
        ),
      );

      renderPage();
      await user.click(
        await screen.findByRole("button", { name: "Quitar la parada de Bodega Central" }),
      );
      await user.click(screen.getByRole("button", { name: "Sí, quitar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Solo se puede quitar una parada pendiente",
      );
    });
  });

  describe("registrar lo que pasó en la parada", () => {
    const CUSTOMER_ID = "cus-1";
    const RECARGA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const BIDON = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    /** Los catálogos que abre el formulario de registrar una parada. */
    function stubMarkFormCatalogs(): void {
      server.use(
        http.get(`${API_BASE_URL}/products`, () =>
          HttpResponse.json([
            {
              id: RECARGA,
              name: "Recarga 20L",
              type: "REFILL",
              containerType: { id: BIDON, name: "Bidón 20L" },
              listPrice: "12.50",
              active: true,
            },
          ]),
        ),
        http.get(`${API_BASE_URL}/payment-methods`, () => HttpResponse.json([])),
        http.get(`${API_BASE_URL}/users`, () => HttpResponse.json([])),
        http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/effective-prices`, () =>
          HttpResponse.json([]),
        ),
      );
    }

    async function markFirstStop(user: ReturnType<typeof userEvent.setup>) {
      await user.click(
        await screen.findByRole("button", { name: "Registrar la parada de Bodega Central" }),
      );
      await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
      await user.click(screen.getByRole("button", { name: "Registrar la parada" }));
    }

    it("registra la entrega y resume venta, cobro y saldo de envases", async () => {
      const user = userEvent.setup();
      const inProgress = buildRoute({ status: "IN_PROGRESS", stops: [stop({ position: 1 })] });
      stubRouteSequence(inProgress, {
        ...inProgress,
        stops: [stop({ position: 1, status: "DELIVERED" })],
      });
      stubMarkFormCatalogs();
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/stops/stop-1`, () =>
          HttpResponse.json({
            ...stop({ position: 1, status: "DELIVERED" }),
            sale: { id: "sale-1", total: "37.50", creditLimitExceeded: false },
            payment: { id: "pay-1", status: "CONFIRMED", amount: "20.00" },
            containerBalances: [
              {
                containerTypeId: BIDON,
                containerType: { id: BIDON, name: "Bidón 20L" },
                quantity: 2,
              },
            ],
          }),
        ),
      );

      renderPage();
      await markFirstStop(user);

      const notice = await screen.findByText(/Entrega de Bodega Central registrada/);
      expect(notice).toHaveTextContent("por S/ 37.50");
      expect(notice).toHaveTextContent("Cobro de S/ 20.00 (confirmado)");
      expect(notice).toHaveTextContent("Envases en poder del cliente: 2 × Bidón 20L");
    });

    // HU-13 E2: la advertencia se muestra y nunca bloquea — para cuando se ve,
    // la venta ya quedó registrada.
    it("avisa del límite de crédito superado sin haber bloqueado nada", async () => {
      const user = userEvent.setup();
      const inProgress = buildRoute({ status: "IN_PROGRESS", stops: [stop({ position: 1 })] });
      stubRouteSequence(inProgress, {
        ...inProgress,
        stops: [stop({ position: 1, status: "DELIVERED" })],
      });
      stubMarkFormCatalogs();
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/stops/stop-1`, () =>
          HttpResponse.json({
            ...stop({ position: 1, status: "DELIVERED" }),
            sale: { id: "sale-1", total: "500.00", creditLimitExceeded: true },
            payment: null,
            containerBalances: [],
          }),
        ),
      );

      renderPage();
      await markFirstStop(user);

      expect(
        await screen.findByText(
          "Esta venta superó el límite de crédito de Bodega Central. Quedó registrada igual.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(/Entrega de Bodega Central registrada/)).toHaveTextContent(
        "No se cobró nada: queda al fiado",
      );
    });

    it("una parada fallida se resume con su motivo", async () => {
      const user = userEvent.setup();
      const inProgress = buildRoute({ status: "IN_PROGRESS", stops: [stop({ position: 1 })] });
      stubRouteSequence(inProgress, {
        ...inProgress,
        stops: [stop({ position: 1, status: "FAILED", failureReason: "Estaba cerrado" })],
      });
      stubMarkFormCatalogs();
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/stops/stop-1`, () =>
          HttpResponse.json(
            stop({ position: 1, status: "FAILED", failureReason: "Estaba cerrado" }),
          ),
        ),
      );

      renderPage();
      await user.click(
        await screen.findByRole("button", { name: "Registrar la parada de Bodega Central" }),
      );
      await user.selectOptions(await screen.findByLabelText("¿Qué pasó en esta parada?"), "FAILED");
      await user.type(screen.getByLabelText("¿Por qué no se pudo entregar?"), "Estaba cerrado");
      await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

      expect(
        await screen.findByText(
          "La parada de Bodega Central quedó registrada como no entregada: Estaba cerrado.",
        ),
      ).toBeInTheDocument();
    });

    it("«Cancelar» cierra el formulario sin registrar nada", async () => {
      const user = userEvent.setup();
      stubRoute(buildRoute({ status: "IN_PROGRESS", stops: [stop({ position: 1 })] }));
      stubMarkFormCatalogs();
      let called = false;
      server.use(
        http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/stops/stop-1`, () => {
          called = true;
          return HttpResponse.json(stop({ position: 1, status: "DELIVERED" }));
        }),
      );

      renderPage();
      await user.click(
        await screen.findByRole("button", { name: "Registrar la parada de Bodega Central" }),
      );
      await screen.findByLabelText("Producto 1");
      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(screen.queryByLabelText("Producto 1")).not.toBeInTheDocument();
      expect(called).toBe(false);
    });
  });
});
