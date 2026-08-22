import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { Order } from "../api/orders";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { OrderDetailPage } from "./order-detail-page";

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    customerId: "11111111-1111-4111-8111-111111111111",
    customer: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Bodega Santa Rosa",
      phone: "987654321",
    },
    deliveryDate: "2026-08-25",
    status: "PENDING",
    createdById: "55555555-5555-4555-8555-555555555555",
    createdAt: "2026-08-21T15:00:00.000Z",
    items: [
      {
        id: "item-1",
        productId: "22222222-2222-4222-8222-222222222222",
        product: { id: "22222222-2222-4222-8222-222222222222", name: "Recarga 20L" },
        quantity: 3,
        unitPrice: "12.50",
      },
    ],
    total: "37.50",
    ...overrides,
  };
}

function stubGetOrder(order: Order): void {
  server.use(http.get(`${API_BASE_URL}/orders/:id`, () => HttpResponse.json(order)));
}

function stubCancel(status: number, payload: JsonBodyType): void {
  server.use(
    http.patch(`${API_BASE_URL}/orders/:id/cancel`, () => HttpResponse.json(payload, { status })),
  );
}

function renderDetail(id = "44444444-4444-4444-8444-444444444444") {
  return renderWithProviders(
    <Routes>
      <Route path="/orders/:orderId" element={<OrderDetailPage />} />
      <Route path="/orders" element={<h1>Pedidos</h1>} />
    </Routes>,
    `/orders/${id}`,
  );
}

describe("OrderDetailPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("muestra el detalle con sus ítems, subtotales y el total del backend", async () => {
    const order = buildOrder({
      items: [
        {
          id: "item-1",
          productId: "p1",
          product: { id: "p1", name: "Recarga 20L" },
          quantity: 3,
          unitPrice: "12.50",
        },
        {
          id: "item-2",
          productId: "p2",
          product: { id: "p2", name: "Bidón 20L" },
          quantity: 2,
          unitPrice: "17.00",
        },
      ],
      total: "71.50",
    });
    stubGetOrder(order);

    renderDetail(order.id);

    expect(
      await screen.findByRole("heading", { name: `Pedido de ${order.customer.name}` }),
    ).toBeInTheDocument();
    expect(screen.getByText(order.customer.phone)).toBeInTheDocument();
    expect(screen.getByText("Recarga 20L")).toBeInTheDocument();
    expect(screen.getByText("Bidón 20L")).toBeInTheDocument();
    expect(screen.getByText("S/ 12.50")).toBeInTheDocument();
    expect(screen.getByText("S/ 37.50")).toBeInTheDocument();
    expect(screen.getByText("S/ 17.00")).toBeInTheDocument();
    expect(screen.getByText("S/ 34.00")).toBeInTheDocument();
    // El total es el del backend (71.50), no un recálculo del front.
    expect(screen.getByText("S/ 71.50")).toBeInTheDocument();
  });

  it("muestra la fecha de entrega como el día exacto y la creación en hora de Lima", async () => {
    stubGetOrder(buildOrder({ deliveryDate: "2026-08-25", createdAt: "2026-08-21T15:00:00.000Z" }));

    renderDetail();

    // new Date("2026-08-25") es medianoche UTC, que en Lima (UTC-5) lee 24/08.
    expect(await screen.findByText("25/08/2026")).toBeInTheDocument();
    expect(screen.queryByText("24/08/2026")).not.toBeInTheDocument();
    // 15:00 UTC son 10:00 en Lima.
    expect(screen.getByText("21/08/2026 10:00")).toBeInTheDocument();
  });

  it("no muestra el botón de cancelar si el pedido no está pendiente", async () => {
    stubGetOrder(buildOrder({ status: "ON_ROUTE" }));

    renderDetail();

    await screen.findByRole("heading", { name: /Pedido de/ });
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
  });

  it("cancela con éxito y repinta el estado como Cancelado", async () => {
    const user = userEvent.setup();
    const order = buildOrder({ status: "PENDING" });
    stubGetOrder(order);
    stubCancel(200, { ...order, status: "CANCELLED" });

    renderDetail(order.id);
    await user.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    await user.click(screen.getByRole("button", { name: "Sí, cancelar" }));

    expect(await screen.findByText("Cancelado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
  });

  it("un 409 muestra su mensaje y deja ver el estado actualizado", async () => {
    const user = userEvent.setup();
    const order = buildOrder({ status: "PENDING" });
    let getCallCount = 0;
    server.use(
      http.get(`${API_BASE_URL}/orders/:id`, () => {
        getCallCount++;
        return HttpResponse.json(
          buildOrder({ status: getCallCount === 1 ? "PENDING" : "ON_ROUTE" }),
        );
      }),
    );
    stubCancel(409, {
      message: "Solo se puede cancelar un pedido pendiente; este está en ON_ROUTE",
    });

    renderDetail(order.id);
    await user.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    await user.click(screen.getByRole("button", { name: "Sí, cancelar" }));

    expect(
      await screen.findByText("Solo se puede cancelar un pedido pendiente; este está en ON_ROUTE"),
    ).toBeInTheDocument();
    expect(await screen.findByText("En ruta")).toBeInTheDocument();
  });

  it("muestra el error genérico de la API y permite reintentar", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/orders/:id`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json(buildOrder());
      }),
    );

    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("heading", { name: /Pedido de/ })).toBeInTheDocument();
  });

  it("«No» cierra la confirmación sin cancelar", async () => {
    const user = userEvent.setup();
    stubGetOrder(buildOrder({ status: "PENDING" }));
    // Sin handler de PATCH: si «No» disparara el cancel, MSW haría fallar el test.

    renderDetail();
    await user.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    await user.click(screen.getByRole("button", { name: "No" }));

    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sí, cancelar" })).not.toBeInTheDocument();
  });

  it("un id inexistente muestra 'no existe', no un error genérico", async () => {
    server.use(
      http.get(`${API_BASE_URL}/orders/:id`, () =>
        HttpResponse.json({ message: 'El pedido "x" no existe' }, { status: 404 }),
      ),
    );

    renderDetail("99999999-9999-4999-8999-999999999999");

    expect(await screen.findByText("Ese pedido no existe")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un doble clic en cancelar dispara un solo PATCH", async () => {
    const user = userEvent.setup();
    const order = buildOrder({ status: "PENDING" });
    stubGetOrder(order);
    let patchCount = 0;
    server.use(
      http.patch(`${API_BASE_URL}/orders/:id/cancel`, async () => {
        patchCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json(buildOrder({ status: "CANCELLED" }));
      }),
    );

    renderDetail(order.id);
    await user.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    const confirmButton = screen.getByRole("button", { name: "Sí, cancelar" });
    await user.click(confirmButton);
    await user.click(confirmButton);

    await screen.findByText("Cancelado");
    expect(patchCount).toBe(1);
  });
});
