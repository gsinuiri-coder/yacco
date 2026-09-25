import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery } from "h3";
import type { H3Event } from "h3";
import type { CustomerLocation } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer, buildOrder, buildRoute, buildStop, pageOf } from "../support/fixtures";
import { failWith, stubRouteDetail, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const ROUTE = "/api/v1/routes/r-1";

async function renderDetail() {
  await renderSuspended(App, { route: "/routes/r-1" });
  await screen.findByRole("heading", { name: "Ruta del 28/08/2026", level: 1 });
}

function row(name: string): HTMLElement {
  const table = screen.getByRole("table", { name: /Paradas de la ruta/ });
  return within(table).getByText(name).closest("tr") as HTMLElement;
}

describe("Detalle de ruta", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra el día, el chofer, el estado y la zona", async () => {
    stubRouteDetail(cleanups, buildRoute({ status: "IN_PROGRESS" }));

    await renderDetail();

    expect(screen.getByText("En curso")).toBeTruthy();
    expect(screen.getAllByText("Luis Quispe").length).toBeGreaterThan(0);
    expect(screen.getByText("Norte")).toBeTruthy();
    expect(screen.getByText("28/08/2026 07:00")).toBeTruthy();
  });

  it("lista las paradas en su orden, con origen y estado", async () => {
    stubRouteDetail(
      cleanups,
      buildRoute({
        status: "IN_PROGRESS",
        stops: [
          buildStop({ position: 1, status: "DELIVERED" }),
          buildStop({
            id: "stop-2",
            position: 2,
            origin: "VAN_SALE",
            location: {
              id: "loc-2",
              name: "Principal",
              address: "Jr. Puno 1",
              addressReference: "Frente al mercado",
              phone: "987000222",
              customer: { id: "c-2", name: "Panadería Aurora" },
            },
          }),
        ],
      }),
    );

    await renderDetail();

    const aurora = row("Panadería Aurora");
    expect(within(aurora).getByText("Autoventa")).toBeTruthy();
    expect(within(aurora).getByText("Pendiente")).toBeTruthy();
    expect(within(row("Bodega Central")).getByText("Entregada")).toBeTruthy();
    expect(within(row("Bodega Central")).getByText("Pedido")).toBeTruthy();
  });

  describe("la corrección de una parada", () => {
    const correction = {
      correctedAt: "2026-08-28T20:15:00.000Z",
      correctedBy: { id: "u-admin", name: "Giancarlo" },
      correctionReason: "El chofer anotó mal: sí se entregó",
    };

    it("corregida a entregada, ya NO muestra su motivo de falla original aunque la API lo conserve", async () => {
      stubRouteDetail(
        cleanups,
        buildRoute({
          status: "FINISHED",
          stops: [
            buildStop({ status: "DELIVERED", failureReason: "Nadie atendió", correction }),
            buildStop({
              id: "stop-2",
              position: 2,
              status: "FAILED",
              failureReason: "Local cerrado",
              location: {
                id: "loc-2",
                name: "Principal",
                address: "Jr. Puno 1",
                addressReference: "Frente al mercado",
                phone: "987000222",
                customer: { id: "c-2", name: "Panadería Aurora" },
              },
            }),
          ],
        }),
      );

      await renderDetail();

      const corrected = row("Bodega Central");
      expect(within(corrected).getByText("Entregada")).toBeTruthy();
      expect(within(corrected).queryByText("Nadie atendió")).toBeNull();
      // La que sigue no entregada sí muestra su motivo: el dato para la regla.
      expect(within(row("Panadería Aurora")).getByText("Local cerrado")).toBeTruthy();
    });

    it("el sello de la corrección (quién, cuándo, motivo) va sólo en la parada corregida", async () => {
      stubRouteDetail(
        cleanups,
        buildRoute({
          status: "FINISHED",
          stops: [
            buildStop({ status: "DELIVERED", correction }),
            buildStop({
              id: "stop-2",
              position: 2,
              status: "DELIVERED",
              location: {
                id: "loc-2",
                name: "Principal",
                address: "Jr. Puno 1",
                addressReference: "Frente al mercado",
                phone: "987000222",
                customer: { id: "c-2", name: "Panadería Aurora" },
              },
            }),
          ],
        }),
      );

      await renderDetail();

      const corrected = row("Bodega Central");
      expect(within(corrected).getByText("Corregida")).toBeTruthy();
      expect(
        within(corrected).getByText("Corregida el 28/08/2026 15:15 por Giancarlo"),
      ).toBeTruthy();
      expect(
        within(corrected).getByText("Motivo: El chofer anotó mal: sí se entregó"),
      ).toBeTruthy();
      expect(within(row("Panadería Aurora")).queryByText("Corregida")).toBeNull();
    });

    it("sin motivo, la corrección se pinta igual con quién y cuándo", async () => {
      stubRouteDetail(
        cleanups,
        buildRoute({
          status: "FINISHED",
          stops: [
            buildStop({
              status: "DELIVERED",
              correction: { ...correction, correctionReason: null },
            }),
          ],
        }),
      );

      await renderDetail();

      expect(within(row("Bodega Central")).getByText(/Corregida el .* por Giancarlo/)).toBeTruthy();
      expect(screen.queryByText(/^Motivo:/)).toBeNull();
    });
  });

  it("una ruta que no existe ofrece volver; un error de carga se reintenta", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint(ROUTE, {
        method: "GET",
        handler: (event: H3Event) => {
          attempt++;
          return failWith(
            attempt === 1 ? 500 : 404,
            attempt === 1 ? "Base de datos no disponible" : "no existe",
          )(event);
        },
      }),
    );

    await renderSuspended(App, { route: "/routes/r-1" });
    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Esa ruta no existe")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Volver a rutas" }).length).toBeGreaterThan(0);
  });

  describe("iniciar y terminar", () => {
    it("iniciar pasa la ruta a en curso de un clic", async () => {
      stubRouteDetail(cleanups, buildRoute({ status: "PLANNED" }));
      stubWrite(cleanups, `${ROUTE}/start`, "PATCH", () => buildRoute({ status: "IN_PROGRESS" }));

      await renderDetail();
      await userEvent.setup().click(screen.getByRole("button", { name: "Iniciar ruta" }));

      expect(await screen.findByText("En curso")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Iniciar ruta" })).toBeNull();
    });

    it("un 409 al iniciar muestra el mensaje de la API y recarga la ruta", async () => {
      const detail = stubRouteDetail(cleanups, [
        buildRoute({ status: "PLANNED" }),
        buildRoute({ status: "IN_PROGRESS" }),
      ]);
      stubWrite(cleanups, `${ROUTE}/start`, "PATCH", failWith(409, "La ruta ya está en curso"));

      await renderDetail();
      await userEvent.setup().click(screen.getByRole("button", { name: "Iniciar ruta" }));

      expect((await screen.findByRole("alert")).textContent).toContain("La ruta ya está en curso");
      expect(await screen.findByText("En curso")).toBeTruthy();
      expect(detail.gets()).toBe(2);
    });

    it("con todo resuelto, confirmar termina la ruta; «No, todavía no» no llama a la API", async () => {
      stubRouteDetail(
        cleanups,
        buildRoute({ status: "IN_PROGRESS", stops: [buildStop({ status: "DELIVERED" })] }),
      );
      const finishes = stubWrite(cleanups, `${ROUTE}/finish`, "PATCH", () =>
        buildRoute({ status: "FINISHED", stops: [buildStop({ status: "DELIVERED" })] }),
      );
      const user = userEvent.setup();

      await renderDetail();
      await user.click(screen.getByRole("button", { name: "Terminar ruta" }));
      await user.click(screen.getByRole("button", { name: "No, todavía no" }));
      expect(finishes).toHaveLength(0);

      await user.click(screen.getByRole("button", { name: "Terminar ruta" }));
      const dialog = screen.getByRole("group", { name: "Confirmar el fin de la ruta" });
      expect(within(dialog).getByText(/Todas las paradas están resueltas/)).toBeTruthy();
      await user.click(within(dialog).getByRole("button", { name: "Sí, terminar la ruta" }));

      expect(await screen.findByText("Terminada")).toBeTruthy();
      expect(finishes).toHaveLength(1);
      expect(screen.getByRole("link", { name: "Liquidar la ruta" }).getAttribute("href")).toBe(
        "/routes/r-1/settlement",
      );
    });

    it("con paradas sin resolver el diálogo explica, en singular y en plural, y no ofrece confirmar", async () => {
      stubRouteDetail(
        cleanups,
        buildRoute({
          status: "IN_PROGRESS",
          stops: [buildStop({ position: 1 }), buildStop({ id: "stop-2", position: 2 })],
        }),
      );
      const user = userEvent.setup();

      await renderDetail();
      await user.click(screen.getByRole("button", { name: "Terminar ruta" }));

      const dialog = screen.getByRole("group", { name: "Confirmar el fin de la ruta" });
      expect(within(dialog).getByText(/quedan 2 paradas sin resolver/)).toBeTruthy();
      expect(within(dialog).queryByRole("button", { name: "Sí, terminar la ruta" })).toBeNull();
      await user.click(within(dialog).getByRole("button", { name: "Entendido" }));
      expect(screen.queryByRole("group", { name: "Confirmar el fin de la ruta" })).toBeNull();
    });

    it("con una sola parada pendiente lo dice en singular", async () => {
      stubRouteDetail(cleanups, buildRoute({ status: "IN_PROGRESS", stops: [buildStop()] }));

      await renderDetail();
      await userEvent.setup().click(screen.getByRole("button", { name: "Terminar ruta" }));

      expect(screen.getByText(/queda 1 parada sin resolver/)).toBeTruthy();
    });

    it("un 409 al terminar muestra el mensaje y cierra la confirmación", async () => {
      stubRouteDetail(
        cleanups,
        buildRoute({ status: "IN_PROGRESS", stops: [buildStop({ status: "DELIVERED" })] }),
      );
      stubWrite(cleanups, `${ROUTE}/finish`, "PATCH", failWith(409, "Queda una parada pendiente"));
      const user = userEvent.setup();

      await renderDetail();
      await user.click(screen.getByRole("button", { name: "Terminar ruta" }));
      await user.click(screen.getByRole("button", { name: "Sí, terminar la ruta" }));

      expect((await screen.findByRole("alert")).textContent).toContain(
        "Queda una parada pendiente",
      );
      await waitFor(() =>
        expect(screen.queryByRole("group", { name: "Confirmar el fin de la ruta" })).toBeNull(),
      );
    });

    it("una ruta terminada no ofrece iniciar, terminar ni tocar paradas, y sin paradas no invita a agregarlas", async () => {
      stubRouteDetail(cleanups, buildRoute({ status: "FINISHED", stops: [] }));

      await renderDetail();

      expect(
        screen.getByText("Esta ruta terminó sin paradas: nunca se le agregó ninguna."),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Iniciar ruta" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Terminar ruta" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Agregar parada" })).toBeNull();
    });

    it("una ruta liquidada ofrece ver la liquidación", async () => {
      stubRouteDetail(cleanups, buildRoute({ status: "SETTLED" }));

      await renderDetail();

      expect(screen.getByRole("link", { name: "Ver la liquidación" })).toBeTruthy();
    });
  });

  describe("agregar pedidos pendientes en lote", () => {
    const early = buildOrder({ id: "o-1", deliveryDate: "2026-08-28" });
    const late = buildOrder({
      id: "o-2",
      deliveryDate: "2026-08-28",
      customerId: "c-aurora",
      customer: { id: "c-aurora", name: "Panadería Aurora", phone: "987000111" },
    });

    function stubDayOrders(orders = [early, late]) {
      const queries: Array<Record<string, unknown>> = [];
      cleanups.push(
        registerEndpoint("/api/v1/orders", (event: H3Event) => {
          queries.push(getQuery(event));
          return pageOf(orders);
        }),
      );
      return queries;
    }

    async function openBatch() {
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Agregar pedidos pendientes" }));
      return screen.findByRole("form", { name: "Agregar pedidos pendientes" });
    }

    it("lista los pedidos pendientes sin parada del día y la zona de la ruta, y agrega los marcados en el orden de la lista", async () => {
      const detail = stubRouteDetail(cleanups, [
        buildRoute(),
        buildRoute({ stops: [buildStop()] }),
      ]);
      const queries = stubDayOrders();
      const bodies = stubWrite(cleanups, `${ROUTE}/stops/batch`, "POST", () => [buildStop()]);
      const user = userEvent.setup();

      await renderDetail();
      const form = await openBatch();
      await within(form).findByText(/Panadería Aurora/);
      expect(queries[0]).toEqual({
        status: "PENDING",
        hasRouteStop: "false",
        deliveryDateFrom: "2026-08-28",
        deliveryDateTo: "2026-08-28",
        zoneId: "z-norte",
        limit: "100",
      });
      expect(within(form).getByRole("button", { name: "Agregar 0 paradas" })).toHaveProperty(
        "disabled",
        true,
      );

      // Se marcan al revés de como aparecen: el lote va en el orden de la lista.
      await user.click(within(form).getByRole("checkbox", { name: /Panadería Aurora/ }));
      await user.click(within(form).getByRole("checkbox", { name: /Bodega Santa Rosa/ }));
      await user.click(within(form).getByRole("button", { name: "Agregar 2 paradas" }));

      await waitFor(() => expect(detail.gets()).toBe(2));
      expect(bodies).toEqual([{ orderIds: ["o-1", "o-2"] }]);
    });

    it("con «Ver pedidos de todas las zonas» vuelve a pedir sin zona", async () => {
      stubRouteDetail(cleanups, buildRoute());
      const queries = stubDayOrders();
      const user = userEvent.setup();

      await renderDetail();
      const form = await openBatch();
      await within(form).findByText(/Panadería Aurora/);
      await user.click(
        within(form).getByRole("checkbox", { name: "Ver pedidos de todas las zonas" }),
      );

      await waitFor(() => expect(queries.at(-1)).not.toHaveProperty("zoneId"));
      expect(queries.at(-1)?.deliveryDateFrom).toBe("2026-08-28");
    });

    it("una ruta sin zona no filtra por zona ni ofrece la opción", async () => {
      stubRouteDetail(cleanups, buildRoute({ zoneId: null, zone: null }));
      const queries = stubDayOrders();

      await renderDetail();
      const form = await openBatch();
      await within(form).findByText(/Panadería Aurora/);

      expect(queries[0]).not.toHaveProperty("zoneId");
      expect(
        within(form).queryByRole("checkbox", { name: "Ver pedidos de todas las zonas" }),
      ).toBeNull();
    });

    it("si la API rechaza el lote, dice por qué y no agrega nada", async () => {
      const detail = stubRouteDetail(cleanups, buildRoute());
      stubDayOrders();
      stubWrite(
        cleanups,
        `${ROUTE}/stops/batch`,
        "POST",
        failWith(400, 'El pedido "o-2" ya está asignado a otra parada'),
      );
      const user = userEvent.setup();

      await renderDetail();
      const form = await openBatch();
      await user.click(await within(form).findByRole("checkbox", { name: /Panadería Aurora/ }));
      await user.click(within(form).getByRole("button", { name: "Agregar 1 parada" }));

      expect((await within(form).findByRole("alert")).textContent).toContain(
        'El pedido "o-2" ya está asignado a otra parada',
      );
      expect(detail.gets()).toBe(1);
    });

    it("sin pedidos pendientes para ese día lo dice", async () => {
      stubRouteDetail(cleanups, buildRoute());
      stubDayOrders([]);

      await renderDetail();
      const form = await openBatch();

      expect(
        await within(form).findByText(
          "No hay pedidos pendientes sin parada para el 28/08/2026 en la zona Norte.",
        ),
      ).toBeTruthy();
    });

    it("si hay más pedidos de los que entran en la lista, lo dice", async () => {
      stubRouteDetail(cleanups, buildRoute());
      cleanups.push(registerEndpoint("/api/v1/orders", () => pageOf([early], { total: 130 })));

      await renderDetail();
      const form = await openBatch();

      expect(
        await within(form).findByText(
          "Se muestran 1 de 130 pedidos: agrega estos y vuelve a abrir la lista para ver el resto.",
        ),
      ).toBeTruthy();
    });

    it("si la lista no carga, lo dice", async () => {
      stubRouteDetail(cleanups, buildRoute());
      cleanups.push(registerEndpoint("/api/v1/orders", failWith(500, "Base caída")));

      await renderDetail();
      const form = await openBatch();

      expect((await within(form).findByRole("alert")).textContent).toContain("Base caída");
    });

    it("una ruta que ya salió no lo ofrece: ahí se agrega de a una", async () => {
      stubRouteDetail(cleanups, buildRoute({ status: "IN_PROGRESS" }));

      await renderDetail();

      expect(screen.getByRole("button", { name: "Agregar parada" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Agregar pedidos pendientes" })).toBeNull();
    });
  });

  describe("armar las paradas", () => {
    const aurora = buildCustomer({ id: "c-aurora", name: "Panadería Aurora" });
    const location: CustomerLocation = {
      id: "loc-aurora",
      name: "Principal",
      address: "Jr. Unión 100",
      addressReference: "Esquina",
      phone: "987000111",
      isPrimary: true,
      active: true,
    };

    function stubPendingOrders(orders = [buildOrder({ id: "o-9" })], total = orders.length) {
      const queries: Array<Record<string, unknown>> = [];
      cleanups.push(
        registerEndpoint("/api/v1/orders", (event: H3Event) => {
          queries.push(getQuery(event));
          return pageOf(orders, { total });
        }),
      );
      return queries;
    }

    async function openAddForm() {
      await userEvent.setup().click(screen.getByRole("button", { name: "Agregar parada" }));
      return screen.findByRole("form", { name: "Agregar parada" });
    }

    it("una ruta recién planificada dice que no tiene paradas e invita a agregarlas", async () => {
      stubRouteDetail(cleanups, buildRoute());

      await renderDetail();

      expect(screen.getByText("Esta ruta todavía no tiene paradas")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Agregar parada" })).toBeTruthy();
    });

    it("agrega una parada desde un pedido pendiente sin ruta, y recarga", async () => {
      const detail = stubRouteDetail(cleanups, [
        buildRoute(),
        buildRoute({ stops: [buildStop()] }),
      ]);
      const queries = stubPendingOrders();
      const bodies = stubWrite(cleanups, `${ROUTE}/stops`, "POST", () => buildStop());
      const user = userEvent.setup();

      await renderDetail();
      await openAddForm();
      await user.click(screen.getByLabelText("Pedido pendiente"));
      await user.click(
        await screen.findByRole("option", {
          name: /Bodega Santa Rosa · entrega 25\/08\/2026 · 3× Recarga 20L · S\/ 37.50/,
        }),
      );
      await user.click(screen.getByRole("button", { name: "Agregar parada" }));

      await waitFor(() => expect(detail.gets()).toBe(2));
      expect(queries[0]).toEqual({ status: "PENDING", hasRouteStop: "false", limit: "100" });
      expect(bodies).toEqual([{ origin: "ORDER", orderId: "o-9" }]);
    });

    it("agrega una autoventa eligiendo cliente, con la primera dirección ya elegida", async () => {
      stubRouteDetail(cleanups, buildRoute());
      stubPendingOrders([]);
      cleanups.push(
        registerEndpoint("/api/v1/customers", () => pageOf([aurora])),
        registerEndpoint("/api/v1/customers/c-aurora/locations", () => [location]),
      );
      const bodies = stubWrite(cleanups, `${ROUTE}/stops`, "POST", () => buildStop());
      const user = userEvent.setup();

      await renderDetail();
      const form = await openAddForm();
      await user.click(
        within(form).getByRole("button", { name: "Autoventa: un cliente sin pedido" }),
      );
      await user.type(screen.getByLabelText("Cliente"), "aurora");
      await user.click(await screen.findByRole("option", { name: /Panadería Aurora/ }));
      await waitFor(() =>
        expect(screen.getByLabelText("Dirección de entrega").textContent).toContain(
          "Jr. Unión 100",
        ),
      );
      await user.click(within(form).getByRole("button", { name: "Agregar parada" }));

      await waitFor(() =>
        expect(bodies).toEqual([{ origin: "VAN_SALE", locationId: "loc-aurora" }]),
      );
    });

    it("sin pedidos pendientes lo dice y sugiere la autoventa", async () => {
      stubRouteDetail(cleanups, buildRoute());
      stubPendingOrders([]);

      await renderDetail();
      await openAddForm();

      expect(
        await screen.findByText(/Usa autoventa para agregar un cliente sin pedido/),
      ).toBeTruthy();
    });

    it("avisa cuando hay más pendientes de los que entran en el selector", async () => {
      stubRouteDetail(cleanups, buildRoute());
      stubPendingOrders([buildOrder({ id: "o-1" })], 140);

      await renderDetail();
      await openAddForm();

      expect(
        await screen.findByText(/Se muestran los 1 pedidos con entrega más próxima, de 140/),
      ).toBeTruthy();
    });

    it("un catálogo de pedidos caído lo dice al lado del selector", async () => {
      stubRouteDetail(cleanups, buildRoute());
      cleanups.push(
        registerEndpoint("/api/v1/orders", failWith(500, "Base de datos no disponible")),
      );

      await renderDetail();
      await openAddForm();

      expect(
        await screen.findByText(
          "No se pudieron cargar los pedidos pendientes: Base de datos no disponible",
        ),
      ).toBeTruthy();
    });

    it("sin elegir nada no llama a la API; en autoventa pide cliente y dirección; «Cancelar» cierra", async () => {
      stubRouteDetail(cleanups, buildRoute());
      stubPendingOrders();
      const bodies = stubWrite(cleanups, `${ROUTE}/stops`, "POST");
      const user = userEvent.setup();

      await renderDetail();
      const form = await openAddForm();
      await user.click(within(form).getByRole("button", { name: "Agregar parada" }));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Elige el pedido que va a entregar el chofer",
      );

      await user.click(
        within(form).getByRole("button", { name: "Autoventa: un cliente sin pedido" }),
      );
      await user.click(within(form).getByRole("button", { name: "Agregar parada" }));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Elige el cliente y la dirección a la que va el chofer",
      );

      await user.click(within(form).getByRole("button", { name: "Cancelar" }));
      expect(screen.queryByRole("form", { name: "Agregar parada" })).toBeNull();
      expect(bodies).toHaveLength(0);
    });

    it("muestra tal cual el error de la API al agregar", async () => {
      stubRouteDetail(cleanups, buildRoute());
      stubPendingOrders();
      stubWrite(
        cleanups,
        `${ROUTE}/stops`,
        "POST",
        failWith(400, "El pedido ya está en otra ruta"),
      );
      const user = userEvent.setup();

      await renderDetail();
      const form = await openAddForm();
      await user.click(screen.getByLabelText("Pedido pendiente"));
      await user.click(await screen.findByRole("option", { name: /Bodega Santa Rosa/ }));
      await user.click(within(form).getByRole("button", { name: "Agregar parada" }));

      expect((await screen.findByRole("alert")).textContent).toContain(
        "El pedido ya está en otra ruta",
      );
    });

    const twoStops = () =>
      buildRoute({
        stops: [
          buildStop({ position: 1 }),
          buildStop({
            id: "stop-2",
            position: 2,
            location: {
              id: "loc-2",
              name: "Principal",
              address: "Jr. Puno 1",
              addressReference: "Frente al mercado",
              phone: "987000222",
              customer: { id: "c-2", name: "Panadería Aurora" },
            },
          }),
        ],
      });

    it("subir una parada manda la lista COMPLETA en el orden nuevo; primera no sube, última no baja", async () => {
      stubRouteDetail(cleanups, twoStops());
      const bodies = stubWrite(cleanups, `${ROUTE}/stops/reorder`, "PATCH", () => twoStops());

      await renderDetail();
      const up = (name: string) =>
        screen.getByRole("button", { name: `Subir la parada de ${name}` }) as HTMLButtonElement;
      const down = (name: string) =>
        screen.getByRole("button", { name: `Bajar la parada de ${name}` }) as HTMLButtonElement;
      expect(up("Bodega Central").disabled).toBe(true);
      expect(down("Panadería Aurora").disabled).toBe(true);

      await userEvent.setup().click(up("Panadería Aurora"));

      await waitFor(() => expect(bodies).toEqual([{ stopIds: ["stop-2", "stop-1"] }]));
    });

    it("muestra el error de la API al reordenar", async () => {
      stubRouteDetail(cleanups, twoStops());
      stubWrite(cleanups, `${ROUTE}/stops/reorder`, "PATCH", failWith(409, "La ruta ya terminó"));

      await renderDetail();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Bajar la parada de Bodega Central" }));

      expect((await screen.findByRole("alert")).textContent).toContain("La ruta ya terminó");
    });

    it("quitar pide confirmación antes del DELETE; una parada entregada no ofrece quitarla", async () => {
      stubRouteDetail(cleanups, [
        buildRoute({
          stops: [
            buildStop(),
            buildStop({
              id: "stop-2",
              position: 2,
              status: "DELIVERED",
              location: {
                id: "loc-2",
                name: "Principal",
                address: "Jr. Puno 1",
                addressReference: "Frente al mercado",
                phone: "987000222",
                customer: { id: "c-2", name: "Panadería Aurora" },
              },
            }),
          ],
        }),
      ]);
      const deletes = stubWrite(cleanups, `${ROUTE}/stops/stop-1`, "DELETE", (event) => {
        event.node.res.statusCode = 204;
        return null;
      });
      const user = userEvent.setup();

      await renderDetail();
      expect(
        screen.queryByRole("button", { name: "Quitar la parada de Panadería Aurora" }),
      ).toBeNull();

      await user.click(screen.getByRole("button", { name: "Quitar la parada de Bodega Central" }));
      const confirm = screen.getByRole("group", { name: "Confirmar quitar a Bodega Central" });
      expect(deletes).toHaveLength(0);
      await user.click(within(confirm).getByRole("button", { name: "Sí, quitar" }));

      await waitFor(() => expect(deletes).toHaveLength(1));
    });

    it("muestra el error de la API al quitar una parada", async () => {
      stubRouteDetail(cleanups, buildRoute({ stops: [buildStop()] }));
      stubWrite(
        cleanups,
        `${ROUTE}/stops/stop-1`,
        "DELETE",
        failWith(409, "La parada ya tiene una venta"),
      );
      const user = userEvent.setup();

      await renderDetail();
      await user.click(screen.getByRole("button", { name: "Quitar la parada de Bodega Central" }));
      await user.click(screen.getByRole("button", { name: "Sí, quitar" }));

      expect((await screen.findByRole("alert")).textContent).toContain(
        "La parada ya tiene una venta",
      );
    });

    it("sólo con la ruta en curso se ofrece registrar una parada", async () => {
      stubRouteDetail(cleanups, buildRoute({ status: "PLANNED", stops: [buildStop()] }));

      await renderDetail();

      expect(
        screen.queryByRole("button", { name: "Registrar la parada de Bodega Central" }),
      ).toBeNull();
    });
  });
});
