import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
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

function Harness({ initial }: { initial: OrderItemDraft[] }) {
  const [items, setItems] = useState<OrderItemDraft[]>(initial);
  return <OrderItemsForm items={items} errors={[]} disabled={false} onChange={setItems} />;
}

describe("validateOrderItem", () => {
  const valid: OrderItemDraft = { key: 0, productId: "p1", quantity: "3", unitPrice: "12.50" };

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
      { key: 0, productId: "p1", quantity: "3", unitPrice: "10.00" },
      { key: 1, productId: "", quantity: "1", unitPrice: "" },
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

  it("carga el catálogo y prellena el precio de lista al elegir producto", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} />);

    await user.selectOptions(await screen.findByLabelText("Producto (ítem 1)"), product.id);

    expect(screen.getByLabelText("Precio unitario (ítem 1)")).toHaveValue(product.listPrice);

    await user.selectOptions(screen.getByLabelText("Producto (ítem 1)"), "");
    expect(screen.getByLabelText("Precio unitario (ítem 1)")).toHaveValue("");
  });

  it("el precio prellenado queda editable", async () => {
    const user = userEvent.setup();
    const product = buildProduct();
    stubProducts([product]);

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} />);
    await user.selectOptions(await screen.findByLabelText("Producto (ítem 1)"), product.id);
    await user.clear(screen.getByLabelText("Precio unitario (ítem 1)"));
    await user.type(screen.getByLabelText("Precio unitario (ítem 1)"), "9.99");

    expect(screen.getByLabelText("Precio unitario (ítem 1)")).toHaveValue("9.99");
  });

  it("agrega y quita líneas, pero nunca deja la lista vacía", async () => {
    const user = userEvent.setup();
    stubProducts([buildProduct()]);

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} />);
    await screen.findByLabelText("Producto (ítem 1)");

    expect(screen.getByRole("button", { name: "Quitar ítem 1" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Agregar ítem" }));
    expect(screen.getByLabelText("Producto (ítem 2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar ítem 1" })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Quitar ítem 2" }));
    expect(screen.queryByLabelText("Producto (ítem 2)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar ítem 1" })).toBeDisabled();
  });

  it("muestra un error de catálogo con reintento", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_BASE_URL}/products`, () =>
        HttpResponse.json({ message: "fallo" }, { status: 500 }),
      ),
    );

    renderWithProviders(<Harness initial={[emptyOrderItem(0)]} />);
    expect(await screen.findByText("fallo")).toBeInTheDocument();

    stubProducts([buildProduct()]);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByLabelText("Producto (ítem 1)")).toBeInTheDocument();
  });
});
