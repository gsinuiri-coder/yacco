import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { Customer, PaginatedCustomers } from "../api/customers";
import type { EffectivePrice } from "../api/customer-prices";
import type { Product } from "../api/products";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { OrderCreatePage } from "./order-create-page";

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Recarga 20L",
    type: "REFILL",
    containerType: { id: "33333333-3333-4333-8333-333333333333", name: "Bidón 20L" },
    listPrice: "12.50",
    active: true,
    ...overrides,
  };
}

function buildCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Bodega Santa Rosa",
    phone: "987654321",
    address: "Av. Los Alamos 452",
    addressReference: "Portón azul",
    zoneId: null,
    zone: null,
    creditLimit: null,
    debtBalance: "0.00",
    active: true,
    createdAt: "2026-08-21T15:00:00.000Z",
    ...overrides,
  };
}

function stubProducts(products: Product[]): void {
  server.use(http.get(`${API_BASE_URL}/products`, () => HttpResponse.json(products)));
}

function stubCustomerSearch(customers: Customer[]): void {
  server.use(
    http.get(`${API_BASE_URL}/customers`, ({ request }) => {
      const url = new URL(request.url);
      const search = url.searchParams.get("search")?.toLowerCase() ?? "";
      const data = customers.filter((customer) => customer.name.toLowerCase().includes(search));
      const page: PaginatedCustomers = {
        data,
        total: data.length,
        page: 1,
        limit: 10,
        totalPages: 1,
      };
      return HttpResponse.json(page);
    }),
  );
}

/** By default every product prices at list, mirroring "no agreement" for this customer. */
function stubEffectivePrices(customerId: string, items: EffectivePrice[]): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${customerId}/effective-prices`, () =>
      HttpResponse.json(items),
    ),
  );
}

function listPriced(products: Product[]): EffectivePrice[] {
  return products.map((product) => ({
    product: { id: product.id, name: product.name },
    price: product.listPrice,
    source: "LIST",
  }));
}

/** Captures the JSON body of the POST so the test can assert the contract. */
function stubCreate(status = 201, payload?: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post(`${API_BASE_URL}/orders`, async ({ request }) => {
      captured.body = await request.json();
      if (status >= 400) {
        return HttpResponse.json(payload, { status });
      }
      return HttpResponse.json(payload ?? { id: "new-order" }, { status });
    }),
  );
  return captured;
}

function renderCreate() {
  return renderWithProviders(
    <Routes>
      <Route path="/orders/new" element={<OrderCreatePage />} />
      <Route path="/orders" element={<h1>Pedidos</h1>} />
    </Routes>,
    "/orders/new",
  );
}

async function pickCustomer(user: ReturnType<typeof userEvent.setup>, customer: Customer) {
  await user.type(screen.getByLabelText("Cliente"), customer.name);
  await user.click(await screen.findByRole("option", { name: new RegExp(customer.name) }));
}

describe("OrderCreatePage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("arma un pedido de varias líneas y manda el BODY con unitPrice como string", async () => {
    const user = userEvent.setup();
    const products = [
      buildProduct(),
      buildProduct({
        id: "44444444-4444-4444-8444-444444444444",
        name: "Bidón 20L (venta)",
        listPrice: "35.00",
      }),
    ];
    stubProducts(products);
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    stubEffectivePrices(customer.id, listPriced(products));
    const captured = stubCreate();

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });
    await pickCustomer(user, customer);

    await user.selectOptions(await screen.findByLabelText("Producto (ítem 1)"), products[0]!.id);
    await user.clear(screen.getByLabelText("Cantidad (ítem 1)"));
    await user.type(screen.getByLabelText("Cantidad (ítem 1)"), "3");

    await user.click(screen.getByRole("button", { name: "Agregar ítem" }));
    await user.selectOptions(screen.getByLabelText("Producto (ítem 2)"), products[1]!.id);
    await user.clear(screen.getByLabelText("Cantidad (ítem 2)"));
    await user.type(screen.getByLabelText("Cantidad (ítem 2)"), "2");

    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    const body = captured.body as {
      customerId: string;
      deliveryDate: string;
      items: { productId: string; quantity: number; unitPrice: string }[];
    };
    expect(body.customerId).toBe(customer.id);
    expect(body.deliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.items).toEqual([
      { productId: products[0]!.id, quantity: 3, unitPrice: "12.50" },
      { productId: products[1]!.id, quantity: 2, unitPrice: "35.00" },
    ]);
    expect(typeof body.items[0]!.unitPrice).toBe("string");
  });

  it("elegir cliente y producto prellena con el precio PACTADO, no el de lista", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    stubEffectivePrices(customer.id, [
      { product: { id: product.id, name: product.name }, price: "9.90", source: "CUSTOMER" },
    ]);
    const captured = stubCreate();

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });
    await pickCustomer(user, customer);
    await user.selectOptions(await screen.findByLabelText("Producto (ítem 1)"), product.id);

    expect(screen.getByLabelText("Precio unitario (ítem 1)")).toHaveValue("9.90");
    expect(screen.getByText("Pactado")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));
    await screen.findByRole("heading", { name: "Pedidos" });
    const body = captured.body as { items: { unitPrice: string }[] };
    expect(body.items[0]!.unitPrice).toBe("9.90");
  });

  it("actualiza el total en vivo al cambiar cantidad y al agregar línea", async () => {
    const user = userEvent.setup();
    const product = buildProduct({ listPrice: "10.00" });
    stubProducts([product]);
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    stubEffectivePrices(customer.id, listPriced([product]));

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });
    await pickCustomer(user, customer);

    await user.selectOptions(await screen.findByLabelText("Producto (ítem 1)"), product.id);
    await user.clear(screen.getByLabelText("Cantidad (ítem 1)"));
    await user.type(screen.getByLabelText("Cantidad (ítem 1)"), "3");
    // Una sola línea: el subtotal y el total coinciden, ambos en pantalla.
    expect(await screen.findAllByText("S/ 30.00")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Agregar ítem" }));
    await user.selectOptions(screen.getByLabelText("Producto (ítem 2)"), product.id);
    await user.clear(screen.getByLabelText("Cantidad (ítem 2)"));
    await user.type(screen.getByLabelText("Cantidad (ítem 2)"), "2");

    // línea 1: 30.00, línea 2: 20.00, total: 50.00 — tres valores distintos.
    expect(screen.getByText("S/ 20.00")).toBeInTheDocument();
    expect(await screen.findByText("S/ 50.00")).toBeInTheDocument();
  });

  it("prellena el precio de lista al elegir producto, pero el editado manda", async () => {
    const user = userEvent.setup();
    const product = buildProduct({ listPrice: "12.50" });
    stubProducts([product]);
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    stubEffectivePrices(customer.id, listPriced([product]));
    const captured = stubCreate();

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });
    await pickCustomer(user, customer);

    await user.selectOptions(await screen.findByLabelText("Producto (ítem 1)"), product.id);
    expect(screen.getByLabelText("Precio unitario (ítem 1)")).toHaveValue("12.50");

    await user.clear(screen.getByLabelText("Precio unitario (ítem 1)"));
    await user.type(screen.getByLabelText("Precio unitario (ítem 1)"), "11.00");

    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));

    await screen.findByRole("heading", { name: "Pedidos" });
    const body = captured.body as { items: { unitPrice: string }[] };
    expect(body.items[0]!.unitPrice).toBe("11.00");
  });

  it("exige elegir un cliente antes de enviar", async () => {
    stubProducts([buildProduct()]);
    stubCustomerSearch([]);
    // Sin handler de POST: si el formulario llamara a la API, MSW haría fallar el test.
    // Sin cliente, el producto está deshabilitado — no hay forma de completar
    // el ítem, así que el error de cliente es el único camino de validación.

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });
    expect(screen.getByLabelText("Producto (ítem 1)")).toBeDisabled();

    await userEvent.setup().click(screen.getByRole("button", { name: "Registrar pedido" }));

    expect(await screen.findByText("Elige un cliente")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nuevo pedido" })).toBeInTheDocument();
  });

  it("el error de 'Elige un cliente' desaparece al elegir uno, sin volver a enviar", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    stubEffectivePrices(customer.id, listPriced([product]));

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });
    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));
    expect(await screen.findByText("Elige un cliente")).toBeInTheDocument();

    // Corrige el campo sin tocar el botón de enviar de nuevo.
    await pickCustomer(user, customer);

    expect(screen.queryByText("Elige un cliente")).not.toBeInTheDocument();
  });

  it("corregir el precio de una línea no borra el error de otra línea que sigue mal", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    stubEffectivePrices(customer.id, listPriced([product]));
    // Sin handler de POST: si el formulario llamara a la API, MSW haría fallar el test.

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });
    await pickCustomer(user, customer);
    await user.selectOptions(await screen.findByLabelText("Producto (ítem 1)"), product.id);
    await user.clear(screen.getByLabelText("Precio unitario (ítem 1)"));
    await user.type(screen.getByLabelText("Precio unitario (ítem 1)"), "mucho");

    await user.click(screen.getByRole("button", { name: "Agregar ítem" }));
    await user.selectOptions(screen.getByLabelText("Producto (ítem 2)"), product.id);
    await user.clear(screen.getByLabelText("Precio unitario (ítem 2)"));
    await user.type(screen.getByLabelText("Precio unitario (ítem 2)"), "también-mucho");

    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));
    expect(await screen.findByText(/Ítem 1: El precio unitario/)).toBeInTheDocument();
    expect(screen.getByText(/Ítem 2: El precio unitario/)).toBeInTheDocument();

    // Corrige solo el ítem 1, sin volver a enviar.
    await user.clear(screen.getByLabelText("Precio unitario (ítem 1)"));
    await user.type(screen.getByLabelText("Precio unitario (ítem 1)"), "9.99");

    expect(screen.queryByText(/Ítem 1: El precio unitario/)).not.toBeInTheDocument();
    expect(screen.getByText(/Ítem 2: El precio unitario/)).toBeInTheDocument();
  });

  it("no permite quitar la última línea", async () => {
    stubProducts([buildProduct()]);
    stubCustomerSearch([]);

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });

    expect(await screen.findByRole("button", { name: "Quitar ítem 1" })).toBeDisabled();
  });

  it("un precio unitario inválido bloquea el envío", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    stubEffectivePrices(customer.id, listPriced([product]));
    // Sin handler de POST: si el formulario llamara a la API, MSW haría fallar el test.

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });
    await pickCustomer(user, customer);

    await user.selectOptions(await screen.findByLabelText("Producto (ítem 1)"), product.id);
    await user.clear(screen.getByLabelText("Precio unitario (ítem 1)"));
    await user.type(screen.getByLabelText("Precio unitario (ítem 1)"), "mucho");

    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));

    expect(
      await screen.findByText(/Ítem 1: El precio unitario debe ser un monto/),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nuevo pedido" })).toBeInTheDocument();
  });

  it("muestra el 400 de la API sin perder lo ya escrito", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    stubEffectivePrices(customer.id, listPriced([product]));
    stubCreate(400, { message: 'Ya no están a la venta los productos: "Recarga 20L"' });

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });
    await pickCustomer(user, customer);
    await user.selectOptions(await screen.findByLabelText("Producto (ítem 1)"), product.id);

    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya no están a la venta los productos:",
    );
    // Sigue en el formulario, con lo ya elegido intacto.
    expect(screen.getByText(customer.name)).toBeInTheDocument();
    expect(screen.getByLabelText("Producto (ítem 1)")).toHaveValue(product.id);
  });

  it("un doble clic en enviar dispara un solo POST", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);
    const customer = buildCustomer();
    stubCustomerSearch([customer]);
    stubEffectivePrices(customer.id, listPriced([product]));
    let postCount = 0;
    server.use(
      http.post(`${API_BASE_URL}/orders`, async () => {
        postCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({ id: "new-order" }, { status: 201 });
      }),
    );

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo pedido" });
    await pickCustomer(user, customer);
    await user.selectOptions(await screen.findByLabelText("Producto (ítem 1)"), product.id);

    const submit = screen.getByRole("button", { name: "Registrar pedido" });
    await user.click(submit);
    await user.click(submit);

    await screen.findByRole("heading", { name: "Pedidos" });
    expect(postCount).toBe(1);
  });
});
