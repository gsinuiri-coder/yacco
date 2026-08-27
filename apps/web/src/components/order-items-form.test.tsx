import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { EffectivePrice } from "../api/customer-prices";
import type { Product } from "../api/products";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import {
  OrderItemsForm,
  emptyOrderItem,
  orderItemsTotal,
  validateOrderItem,
} from "./order-items-form";
import type { OrderItemDraft } from "./order-items-form";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

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

function stubProducts(products: Product[]): void {
  server.use(http.get(`${API_BASE_URL}/products`, () => HttpResponse.json(products)));
}

function stubEffectivePrices(items: EffectivePrice[]): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/effective-prices`, () =>
      HttpResponse.json(items),
    ),
  );
}

function Harness({
  initial,
  customerId = null,
}: {
  initial: OrderItemDraft[];
  customerId?: string | null;
}) {
  const [items, setItems] = useState<OrderItemDraft[]>(initial);
  return (
    <OrderItemsForm
      items={items}
      errors={[]}
      disabled={false}
      onChange={setItems}
      customerId={customerId}
    />
  );
}

describe("validateOrderItem", () => {
  const valid: OrderItemDraft = {
    key: 0,
    productId: "p1",
    quantity: "3",
    unitPrice: "12.50",
    priceOrigin: "LIST",
  };

  it("requiere un producto", () => {
    expect(validateOrderItem({ ...valid, productId: "" })).toBe("Elige un producto");
  });

  it("requiere una cantidad entera mayor que 0", () => {
    expect(validateOrderItem({ ...valid, quantity: "0" })).toMatch(/entero mayor que 0/);
    expect(validateOrderItem({ ...valid, quantity: "1.5" })).toMatch(/entero mayor que 0/);
    expect(validateOrderItem({ ...valid, quantity: "mucho" })).toMatch(/entero mayor que 0/);
  });

  it("topa la cantidad en MAX_ITEM_QUANTITY", () => {
    expect(validateOrderItem({ ...valid, quantity: "100001" })).toBe(
      "La cantidad no puede superar 100000",
    );
  });

  it("requiere un precio unitario válido", () => {
    expect(validateOrderItem({ ...valid, unitPrice: "mucho" })).toMatch(/precio unitario/);
    expect(validateOrderItem({ ...valid, unitPrice: "" })).toMatch(/precio unitario/);
  });

  it("acepta una línea completa", () => {
    expect(validateOrderItem(valid)).toBeUndefined();
  });
});

describe("orderItemsTotal", () => {
  it("suma solo las líneas que cotizan limpio", () => {
    const items: OrderItemDraft[] = [
      { key: 0, productId: "p1", quantity: "3", unitPrice: "10.00", priceOrigin: "LIST" },
      { key: 1, productId: "", quantity: "1", unitPrice: "", priceOrigin: null },
    ];
    expect(orderItemsTotal(items)).toBe("30.00");
  });

  it("es cero sin líneas cotizables", () => {
    expect(orderItemsTotal([emptyOrderItem(0)])).toBe("0.00");
  });
});

describe("OrderItemsForm", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("sin cliente elegido, el producto queda deshabilitado", async () => {
    stubProducts([buildProduct()]);

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} customerId={null} />);

    expect(await screen.findByText("Elige un cliente para ver sus precios.")).toBeInTheDocument();
    expect(screen.getByLabelText("Producto 1")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Agregar producto" })).toBeDisabled();
  });

  it("elegir producto prellena con el precio PACTADO, no el de lista", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);
    stubEffectivePrices([
      { product: { id: product.id, name: product.name }, price: "9.90", source: "CUSTOMER" },
    ]);

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} customerId={CUSTOMER_ID} />);
    await user.selectOptions(await screen.findByLabelText("Producto 1"), product.id);

    expect(screen.getByLabelText("Precio unitario del producto 1")).toHaveValue("9.90");
    expect(screen.getByText("Pactado")).toBeInTheDocument();
  });

  it("un producto sin precio pactado prellena con el de lista, sin marca de pactado", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);
    stubEffectivePrices([
      { product: { id: product.id, name: product.name }, price: product.listPrice, source: "LIST" },
    ]);

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} customerId={CUSTOMER_ID} />);
    await user.selectOptions(await screen.findByLabelText("Producto 1"), product.id);

    expect(screen.getByLabelText("Precio unitario del producto 1")).toHaveValue(product.listPrice);
    expect(screen.queryByText("Pactado")).not.toBeInTheDocument();
  });

  it("el precio prellenado queda editable", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);
    stubEffectivePrices([
      { product: { id: product.id, name: product.name }, price: product.listPrice, source: "LIST" },
    ]);

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} customerId={CUSTOMER_ID} />);
    await user.selectOptions(await screen.findByLabelText("Producto 1"), product.id);
    await user.clear(screen.getByLabelText("Precio unitario del producto 1"));
    await user.type(screen.getByLabelText("Precio unitario del producto 1"), "9.99");

    expect(screen.getByLabelText("Precio unitario del producto 1")).toHaveValue("9.99");
  });

  it("cambiar de cliente repreciar las líneas prellenadas, pero no pisa una editada a mano", async () => {
    const user = userEvent.setup();
    const productA = buildProduct();
    const productB = buildProduct({
      id: "44444444-4444-4444-8444-444444444444",
      name: "Bidón 20L (venta)",
      listPrice: "35.00",
    });
    stubProducts([productA, productB]);
    stubEffectivePrices([
      { product: { id: productA.id, name: productA.name }, price: "9.90", source: "CUSTOMER" },
      {
        product: { id: productB.id, name: productB.name },
        price: productB.listPrice,
        source: "LIST",
      },
    ]);

    function ChangingHarness() {
      const [customerId, setCustomerId] = useState<string | null>(CUSTOMER_ID);
      const [items, setItems] = useState<OrderItemDraft[]>([emptyOrderItem(0), emptyOrderItem(1)]);
      return (
        <>
          <button onClick={() => setCustomerId("55555555-5555-4555-8555-555555555555")}>
            Cambiar cliente
          </button>
          <OrderItemsForm
            items={items}
            errors={[]}
            disabled={false}
            onChange={setItems}
            customerId={customerId}
          />
        </>
      );
    }

    renderWithProviders(<ChangingHarness />);
    await user.selectOptions(await screen.findByLabelText("Producto 1"), productA.id);
    expect(screen.getByLabelText("Precio unitario del producto 1")).toHaveValue("9.90");

    // Producto 2: precio de lista prellenado, luego editado a mano.
    await user.selectOptions(screen.getByLabelText("Producto 2"), productB.id);
    await user.clear(screen.getByLabelText("Precio unitario del producto 2"));
    await user.type(screen.getByLabelText("Precio unitario del producto 2"), "20.00");

    server.use(
      http.get(
        `${API_BASE_URL}/customers/55555555-5555-4555-8555-555555555555/effective-prices`,
        () =>
          HttpResponse.json([
            {
              product: { id: productA.id, name: productA.name },
              price: "7.00",
              source: "CUSTOMER",
            },
            {
              product: { id: productB.id, name: productB.name },
              price: productB.listPrice,
              source: "LIST",
            },
          ]),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Cambiar cliente" }));

    // Producto 1 (prellenado) se repreció con el nuevo cliente...
    expect(await screen.findByDisplayValue("7.00")).toBeInTheDocument();
    // ...pero el producto 2, editado a mano, conserva lo que el vendedor escribió.
    expect(screen.getByLabelText("Precio unitario del producto 2")).toHaveValue("20.00");
  });

  it("si falla la carga de precios pactados, el formulario sigue usable con precios de lista y avisa", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);
    server.use(
      http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/effective-prices`, () =>
        HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 }),
      ),
    );

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} customerId={CUSTOMER_ID} />);
    expect(await screen.findByRole("status")).toHaveTextContent("Base de datos no disponible");

    await user.selectOptions(screen.getByLabelText("Producto 1"), product.id);
    expect(screen.getByLabelText("Precio unitario del producto 1")).toHaveValue(product.listPrice);
  });

  it("agrega y quita líneas, pero nunca deja la lista vacía", async () => {
    const user = userEvent.setup();
    stubProducts([buildProduct()]);
    stubEffectivePrices([]);

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} customerId={CUSTOMER_ID} />);
    await screen.findByLabelText("Producto 1");

    expect(screen.getByRole("button", { name: "Quitar producto 1" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Agregar producto" }));
    expect(screen.getByLabelText("Producto 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar producto 1" })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Quitar producto 2" }));
    expect(screen.queryByLabelText("Producto 2")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar producto 1" })).toBeDisabled();
  });

  it("muestra un error de catálogo con reintento", async () => {
    const user = userEvent.setup();
    stubEffectivePrices([]);
    server.use(
      http.get(`${API_BASE_URL}/products`, () =>
        HttpResponse.json({ message: "fallo" }, { status: 500 }),
      ),
    );

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} customerId={CUSTOMER_ID} />);
    expect(await screen.findByText("fallo")).toBeInTheDocument();

    stubProducts([buildProduct()]);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByLabelText("Producto 1")).toBeInTheDocument();
  });
});
