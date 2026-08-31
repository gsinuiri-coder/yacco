import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectivePrice } from "../api/customer-prices";
import type { Product } from "../api/products";
import type { RouteStop } from "../api/routes";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { RouteStopMarkForm } from "./route-stop-mark-form";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
const STOP_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const BIDON = "55555555-5555-4555-8555-555555555555";
const RECARGA = "66666666-6666-4666-8666-666666666666";
const BIDON_NUEVO = "77777777-7777-4777-8777-777777777777";
const EFECTIVO = "88888888-8888-4888-8888-888888888888";
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";

/** Recarga: el agua se vende y el envase queda prestado (LOAN_DELIVERY). */
const RECARGA_PRODUCT: Product = {
  id: RECARGA,
  name: "Recarga 20L",
  type: "REFILL",
  containerType: { id: BIDON, name: "Bidón 20L" },
  listPrice: "12.50",
  active: true,
};

/** Bidón nuevo: se vende el envase, sale del parque (FULL_SALE). */
const BIDON_PRODUCT: Product = {
  id: BIDON_NUEVO,
  name: "Bidón 20L nuevo",
  type: "CONTAINER_SALE",
  containerType: { id: BIDON, name: "Bidón 20L" },
  listPrice: "30.00",
  active: true,
};

const PRICES: EffectivePrice[] = [
  { product: { id: RECARGA, name: "Recarga 20L" }, price: "12.50", source: "LIST" },
  { product: { id: BIDON_NUEVO, name: "Bidón 20L nuevo" }, price: "30.00", source: "LIST" },
];

function buildStop(overrides: Partial<RouteStop> = {}): RouteStop {
  return {
    id: STOP_ID,
    routeId: ROUTE_ID,
    position: 1,
    origin: "VAN_SALE",
    locationId: "loc-1",
    location: {
      id: "loc-1",
      name: "Principal",
      address: "Jr. Los Jazmines 245",
      customer: { id: CUSTOMER_ID, name: "Bodega Los Jazmines" },
    },
    orderId: null,
    status: "PENDING",
    failureReason: null,
    correction: null,
    ...overrides,
  };
}

function stubCatalogs(prices: EffectivePrice[] = PRICES): void {
  server.use(
    http.get(`${API_BASE_URL}/products`, () => HttpResponse.json([RECARGA_PRODUCT, BIDON_PRODUCT])),
    http.get(`${API_BASE_URL}/container-types`, () =>
      HttpResponse.json([{ id: BIDON, name: "Bidón 20L", active: true }]),
    ),
    http.get(`${API_BASE_URL}/payment-methods`, () =>
      HttpResponse.json([
        { id: EFECTIVO, name: "Efectivo", active: true, requiresConfirmation: false },
      ]),
    ),
    http.get(`${API_BASE_URL}/users`, () =>
      HttpResponse.json([
        {
          id: ADMIN_ID,
          name: "Administrador",
          username: "admin",
          active: true,
          roles: ["ADMIN"],
        },
      ]),
    ),
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/effective-prices`, () =>
      HttpResponse.json(prices),
    ),
  );
}

function stubMark(
  status = 200,
  payload: JsonBodyType = { id: STOP_ID, status: "DELIVERED" },
): {
  body: unknown;
} {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.patch(`${API_BASE_URL}/routes/${ROUTE_ID}/stops/${STOP_ID}`, async ({ request }) => {
      captured.body = await request.json();
      return HttpResponse.json(payload, { status });
    }),
  );
  return captured;
}

/** El total de la venta, para distinguirlo del subtotal de una única línea. */
function totalBox(): HTMLElement {
  return screen.getByText("Total de la venta").parentElement as HTMLElement;
}

const onMarked = vi.fn();
const onCancel = vi.fn();

function renderForm(stop = buildStop()) {
  return renderWithProviders(
    <RouteStopMarkForm routeId={ROUTE_ID} stop={stop} onCancel={onCancel} onMarked={onMarked} />,
    "/routes/x",
  );
}

describe("RouteStopMarkForm", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
    onMarked.mockClear();
    onCancel.mockClear();
  });

  // HU-12 E1: 3 llenos entregados y 3 vacíos recogidos — el saldo no varía.
  it("registra un canje 1:1: recargas entregadas y los mismos vacíos devueltos", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    const quantity = screen.getByLabelText("Cantidad del producto 1");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.click(screen.getByRole("button", { name: "Agregar envases devueltos" }));
    await user.selectOptions(screen.getByLabelText("Tipo de envase 1"), BIDON);
    const returned = screen.getByLabelText("Vacíos devueltos 1");
    await user.clear(returned);
    await user.type(returned, "3");
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(captured.body).toEqual({
      status: "DELIVERED",
      items: [{ productId: RECARGA, quantity: 3 }],
      containersReturned: [{ containerTypeId: BIDON, quantity: 3 }],
    });
    expect(onMarked).toHaveBeenCalled();
  });

  // HU-12 E2: 3 llenos y 1 vacío — el cliente queda debiendo 2 envases.
  it("registra una deuda de envases: menos vacíos que llenos", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    const quantity = screen.getByLabelText("Cantidad del producto 1");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.click(screen.getByRole("button", { name: "Agregar envases devueltos" }));
    await user.selectOptions(screen.getByLabelText("Tipo de envase 1"), BIDON);
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(captured.body).toMatchObject({
      items: [{ productId: RECARGA, quantity: 3 }],
      containersReturned: [{ containerTypeId: BIDON, quantity: 1 }],
    });
  });

  // HU-12 E3: 1 canjeado y 2 vendidos como envase — esos salen del parque.
  it("registra una venta completa: una recarga más dos envases vendidos", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.click(screen.getByRole("button", { name: "Agregar producto" }));
    await user.selectOptions(screen.getByLabelText("Producto 2"), BIDON_NUEVO);
    const second = screen.getByLabelText("Cantidad del producto 2");
    await user.clear(second);
    await user.type(second, "2");
    await user.click(screen.getByRole("button", { name: "Agregar envases devueltos" }));
    await user.selectOptions(screen.getByLabelText("Tipo de envase 1"), BIDON);
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(captured.body).toMatchObject({
      items: [
        { productId: RECARGA, quantity: 1 },
        { productId: BIDON_NUEVO, quantity: 2 },
      ],
      containersReturned: [{ containerTypeId: BIDON, quantity: 1 }],
    });
  });

  it("muestra el precio pactado y el total en vivo sin escribir ningún precio", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    const quantity = screen.getByLabelText("Cantidad del producto 1");
    await user.clear(quantity);
    await user.type(quantity, "4");

    expect(screen.getByText("Pactado: S/ 12.50")).toBeInTheDocument();
    expect(within(totalBox()).getByText("S/ 50.00")).toBeInTheDocument();
  });

  // HU-13 E1: un cobro parcial deja el resto como deuda; el formulario lo
  // manda tal cual y no obliga a cubrir el total.
  it("registra un cobro parcial con su método de pago", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    const quantity = screen.getByLabelText("Cantidad del producto 1");
    await user.clear(quantity);
    await user.type(quantity, "4");
    await user.selectOptions(screen.getByLabelText("Método de pago"), EFECTIVO);
    await user.type(screen.getByLabelText("Monto cobrado"), "25.00");
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(captured.body).toMatchObject({
      payment: { paymentMethodId: EFECTIVO, amount: "25.00" },
    });
  });

  it("sin método de pago la venta va al fiado y el cuerpo no lleva payment", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(captured.body).not.toHaveProperty("payment");
  });

  it("un monto sin método de pago no se envía y lo dice", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.type(screen.getByLabelText("Monto cobrado"), "25.00");
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Elige con qué método se cobró");
    expect(captured.body).toBeUndefined();
  });

  // La misma regla que SalesService aplica del otro lado: un precio distinto
  // del pactado se registra, pero necesita quién lo autorizó.
  it("un precio distinto del pactado pide quién lo autorizó y lo manda", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.type(screen.getByLabelText("Precio cobrado del producto 1"), "10.00");

    expect(await screen.findByText("Distinto del pactado")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Un precio distinto del pactado necesita quién lo autorizó",
    );
    expect(captured.body).toBeUndefined();

    await user.selectOptions(
      screen.getByLabelText("¿Quién autorizó el precio distinto?"),
      ADMIN_ID,
    );
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(captured.body).toMatchObject({
      items: [{ productId: RECARGA, quantity: 1, unitPrice: "10.00" }],
      priceOverrideAuthorizedById: ADMIN_ID,
    });
  });

  it("escribir el mismo precio pactado no se considera un precio distinto", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.type(screen.getByLabelText("Precio cobrado del producto 1"), "12.5");
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(screen.queryByLabelText("¿Quién autorizó el precio distinto?")).not.toBeInTheDocument();
    expect(captured.body).toMatchObject({
      items: [{ productId: RECARGA, quantity: 1, unitPrice: "12.5" }],
    });
  });

  it("una parada fallida manda solo el motivo", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark(200, { id: STOP_ID, status: "FAILED" });

    renderForm();
    await user.selectOptions(await screen.findByLabelText("¿Qué pasó en esta parada?"), "FAILED");
    await user.type(
      screen.getByLabelText("¿Por qué no se pudo entregar?"),
      "El local estaba cerrado",
    );
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(captured.body).toEqual({
      status: "FAILED",
      failureReason: "El local estaba cerrado",
    });
  });

  it("una parada fallida sin motivo no se envía", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("¿Qué pasó en esta parada?"), "FAILED");
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escribe por qué no se pudo entregar",
    );
    expect(captured.body).toBeUndefined();
  });

  it("sin producto elegido no se envía y nombra la línea", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await screen.findByLabelText("Producto 1");
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Elige el producto de la línea 1");
    expect(captured.body).toBeUndefined();
  });

  it("una cantidad inválida no se envía y nombra la línea", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.clear(screen.getByLabelText("Cantidad del producto 1"));
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La cantidad de la línea 1 debe ser un número entero mayor que 0",
    );
    expect(captured.body).toBeUndefined();
  });

  // Una parada que salió de un pedido ya sabe qué se pidió.
  it("precarga los ítems del pedido cuando la parada viene de uno", async () => {
    stubCatalogs();
    stubMark();
    server.use(
      http.get(`${API_BASE_URL}/orders/${ORDER_ID}`, () =>
        HttpResponse.json({
          id: ORDER_ID,
          customerId: CUSTOMER_ID,
          customer: { id: CUSTOMER_ID, name: "Bodega Los Jazmines", phone: "987000111" },
          deliveryDate: "2026-08-28",
          status: "PENDING",
          createdById: "admin-1",
          createdAt: "2026-08-27T10:00:00.000Z",
          items: [
            {
              id: "item-1",
              productId: RECARGA,
              product: { id: RECARGA, name: "Recarga 20L" },
              quantity: 5,
              unitPrice: "12.50",
            },
          ],
          total: "62.50",
        }),
      ),
    );

    renderForm(buildStop({ origin: "ORDER", orderId: ORDER_ID }));

    expect(await screen.findByDisplayValue("5")).toBeInTheDocument();
    expect(within(totalBox()).getByText("S/ 62.50")).toBeInTheDocument();
  });

  it("muestra tal cual el error del backend, por ejemplo el stock del camión", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    stubMark(400, {
      message: 'Stock insuficiente de "Bidón 20L" en el camión: hay 2, se pidió 3',
    });

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Stock insuficiente");
    expect(onMarked).not.toHaveBeenCalled();
  });

  it("«Cancelar» no llama a la API", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await screen.findByLabelText("Producto 1");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onCancel).toHaveBeenCalled();
    expect(captured.body).toBeUndefined();
  });

  it("sin precios pactados a la vista, el precio escrito viaja sin exigir autorizador", async () => {
    const user = userEvent.setup();
    stubCatalogs([]);
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.type(screen.getByLabelText("Precio cobrado del producto 1"), "9.00");
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    // No hay con qué comparar, así que la decisión la toma la API: si el
    // precio difiere de verdad, responde 400 pidiendo el autorizador.
    expect(captured.body).toMatchObject({
      items: [{ productId: RECARGA, quantity: 1, unitPrice: "9.00" }],
    });
  });

  it("quitar una línea de envases devueltos la saca del cuerpo", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.click(screen.getByRole("button", { name: "Agregar envases devueltos" }));
    await user.selectOptions(screen.getByLabelText("Tipo de envase 1"), BIDON);
    await user.click(screen.getByRole("button", { name: "Quitar los vacíos devueltos 1" }));
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(captured.body).not.toHaveProperty("containersReturned");
  });

  it("quitar una línea de productos la saca del cuerpo", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.click(screen.getByRole("button", { name: "Agregar producto" }));
    await user.selectOptions(screen.getByLabelText("Producto 2"), BIDON_NUEVO);
    await user.click(screen.getByRole("button", { name: "Quitar el producto 2" }));
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(captured.body).toMatchObject({ items: [{ productId: RECARGA, quantity: 1 }] });
  });

  it("un envase devuelto sin tipo elegido no se envía", async () => {
    const user = userEvent.setup();
    stubCatalogs();
    const captured = stubMark();

    renderForm();
    await user.selectOptions(await screen.findByLabelText("Producto 1"), RECARGA);
    await user.click(screen.getByRole("button", { name: "Agregar envases devueltos" }));
    await user.click(screen.getByRole("button", { name: "Registrar la parada" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elige el tipo de envase devuelto de la línea 1",
    );
    expect(captured.body).toBeUndefined();
  });
});
