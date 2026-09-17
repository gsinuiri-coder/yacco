import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { Customer, EffectivePrice, Product } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer, pageOf } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const RECARGA: Product = {
  id: "p-recarga",
  name: "Recarga 20L",
  type: "REFILL",
  containerType: { id: "ct", name: "Bidón" },
  listPrice: "12.50",
  active: true,
};
const BIDON: Product = { ...RECARGA, id: "p-bidon", name: "Bidón 20L (venta)", listPrice: "35.00" };
const AURORA = buildCustomer({ id: "c-aurora", name: "Panadería Aurora" });
const NORTE = buildCustomer({ id: "c-norte", name: "Bodega Norte" });

function endpoint(...args: Parameters<typeof registerEndpoint>) {
  cleanups.push(registerEndpoint(...args));
}

function stubCatalog(effectiveByCustomer: Record<string, EffectivePrice[] | "falla">) {
  endpoint("/api/v1/products", () => [RECARGA, BIDON]);
  endpoint("/api/v1/customers", (event: H3Event) => {
    const search = String(getQuery(event).search ?? "").toLowerCase();
    return pageOf(
      [AURORA, NORTE].filter((customer) => customer.name.toLowerCase().includes(search)),
    );
  });
  for (const [customerId, prices] of Object.entries(effectiveByCustomer)) {
    endpoint(`/api/v1/customers/${customerId}/effective-prices`, (event: H3Event) => {
      if (prices === "falla") {
        setResponseStatus(event, 500);
        return { message: "Base de datos no disponible" };
      }
      return prices;
    });
  }
  endpoint("/api/v1/orders", { method: "GET", handler: () => pageOf([]) });
}

function stubCreate(respond: (event: H3Event) => unknown = () => ({ id: "o-new" })) {
  const bodies: unknown[] = [];
  endpoint("/api/v1/orders", {
    method: "POST",
    handler: async (event: H3Event) => {
      bodies.push(await readBody(event));
      return respond(event);
    },
  });
  return bodies;
}

const agreed = (product: Product, price: string): EffectivePrice => ({
  product: { id: product.id, name: product.name },
  price,
  source: "CUSTOMER",
});

async function pickCustomer(user: ReturnType<typeof userEvent.setup>, customer: Customer) {
  const input = await screen.findByLabelText("Cliente");
  await user.clear(input);
  await user.type(input, customer.name.split(" ")[1]!);
  await user.click(await screen.findByRole("option", { name: new RegExp(customer.name) }));
}

async function pickProduct(user: ReturnType<typeof userEvent.setup>, line: number, name: string) {
  await waitFor(() =>
    expect((screen.getByLabelText(`Producto ${line}`) as HTMLButtonElement).disabled).toBe(false),
  );
  await user.click(screen.getByLabelText(`Producto ${line}`));
  await user.click(await screen.findByRole("option", { name }));
}

const priceOf = (line: number) =>
  (screen.getByLabelText(`Precio unitario del producto ${line}`) as HTMLInputElement).value;

async function renderCreate() {
  await renderSuspended(App, { route: "/orders/new" });
  await screen.findByRole("heading", { name: "Nuevo pedido", level: 1 });
}

describe("Nuevo pedido", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("arma un pedido de varias líneas y manda precio como string y cantidad entera", async () => {
    stubCatalog({ "c-aurora": [agreed(RECARGA, "9.90")] });
    const bodies = stubCreate();
    const user = userEvent.setup();

    await renderCreate();
    await pickCustomer(user, AURORA);
    await pickProduct(user, 1, "Recarga 20L");
    await user.clear(screen.getByLabelText("Cantidad del producto 1"));
    await user.type(screen.getByLabelText("Cantidad del producto 1"), "3");
    await user.click(screen.getByRole("button", { name: "Agregar producto" }));
    await pickProduct(user, 2, "Bidón 20L (venta)");
    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));

    await waitFor(() => expect(useRouter().currentRoute.value.path).toBe("/orders"));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      customerId: "c-aurora",
      items: [
        { productId: "p-recarga", quantity: 3, unitPrice: "9.90" },
        { productId: "p-bidon", quantity: 1, unitPrice: "35.00" },
      ],
    });
    expect((bodies[0] as { deliveryDate: string }).deliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sin cliente no se elige producto; con cliente prellena el PACTADO, marcado", async () => {
    stubCatalog({ "c-aurora": [agreed(RECARGA, "9.90")] });
    const user = userEvent.setup();

    await renderCreate();
    expect(screen.getByText("Elige un cliente para ver sus precios.")).toBeTruthy();
    expect((screen.getByLabelText("Producto 1") as HTMLButtonElement).disabled).toBe(true);

    await pickCustomer(user, AURORA);
    await pickProduct(user, 1, "Recarga 20L");

    expect(priceOf(1)).toBe("9.90");
    expect(screen.getByText("Pactado")).toBeTruthy();
  });

  it("el total se actualiza en vivo, en céntimos exactos", async () => {
    stubCatalog({ "c-aurora": [] });
    const user = userEvent.setup();

    await renderCreate();
    await pickCustomer(user, AURORA);
    await pickProduct(user, 1, "Recarga 20L");
    expect(screen.getByText("S/ 12.50", { selector: "span" })).toBeTruthy();

    await user.clear(screen.getByLabelText("Cantidad del producto 1"));
    await user.type(screen.getByLabelText("Cantidad del producto 1"), "3");

    await waitFor(() => expect(screen.getAllByText("S/ 37.50").length).toBeGreaterThan(0));
  });

  it("cambiar de cliente reprecia lo prellenado pero no pisa un precio escrito a mano", async () => {
    stubCatalog({
      "c-aurora": [agreed(RECARGA, "9.90")],
      "c-norte": [agreed(RECARGA, "7.00")],
    });
    const user = userEvent.setup();

    await renderCreate();
    await pickCustomer(user, AURORA);
    await pickProduct(user, 1, "Recarga 20L");
    await user.click(screen.getByRole("button", { name: "Agregar producto" }));
    await pickProduct(user, 2, "Bidón 20L (venta)");
    await user.clear(screen.getByLabelText("Precio unitario del producto 2"));
    await user.type(screen.getByLabelText("Precio unitario del producto 2"), "20.00");

    await pickCustomer(user, NORTE);

    await waitFor(() => expect(priceOf(1)).toBe("7.00"));
    expect(priceOf(2)).toBe("20.00");
  });

  it("si fallan los precios pactados, avisa y sigue con el de lista", async () => {
    stubCatalog({ "c-aurora": "falla" });
    const user = userEvent.setup();

    await renderCreate();
    await pickCustomer(user, AURORA);

    expect(
      await screen.findByText(
        /No se pudieron cargar los precios pactados: se usa el precio de lista/,
      ),
    ).toBeTruthy();
    await pickProduct(user, 1, "Recarga 20L");
    expect(priceOf(1)).toBe("12.50");
  });

  it("exige cliente, y elegirlo borra ese error sin volver a enviar", async () => {
    stubCatalog({ "c-aurora": [] });
    const bodies = stubCreate();
    const user = userEvent.setup();

    await renderCreate();
    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));

    expect(await screen.findByText("Elige un cliente")).toBeTruthy();
    expect(screen.getByText("Producto 1: Elige un producto")).toBeTruthy();
    expect(bodies).toHaveLength(0);

    await pickCustomer(user, AURORA);
    await waitFor(() => expect(screen.queryByText("Elige un cliente")).toBeNull());
    expect(screen.getByText("Producto 1: Elige un producto")).toBeTruthy();
  });

  it("un precio inválido bloquea el envío, y corregir una línea no borra el error de otra", async () => {
    stubCatalog({ "c-aurora": [] });
    const bodies = stubCreate();
    const user = userEvent.setup();

    await renderCreate();
    await pickCustomer(user, AURORA);
    await pickProduct(user, 1, "Recarga 20L");
    await user.clear(screen.getByLabelText("Precio unitario del producto 1"));
    await user.type(screen.getByLabelText("Precio unitario del producto 1"), "12,50");
    await user.click(screen.getByRole("button", { name: "Agregar producto" }));
    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));

    expect(
      await screen.findByText('Producto 1: El precio unitario debe ser un monto como "12.50"'),
    ).toBeTruthy();
    expect(screen.getByText("Producto 2: Elige un producto")).toBeTruthy();
    expect(bodies).toHaveLength(0);

    await user.clear(screen.getByLabelText("Precio unitario del producto 1"));
    await user.type(screen.getByLabelText("Precio unitario del producto 1"), "12.50");

    await waitFor(() => expect(screen.queryByText(/Producto 1:/)).toBeNull());
    expect(screen.getByText("Producto 2: Elige un producto")).toBeTruthy();
  });

  it("no deja quitar la última línea", async () => {
    stubCatalog({});
    await renderCreate();

    expect(
      (screen.getByRole("button", { name: "Quitar producto 1" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("el 400 de la API se muestra sin perder lo ya elegido", async () => {
    stubCatalog({ "c-aurora": [] });
    stubCreate((event) => {
      setResponseStatus(event, 400);
      return { message: 'Ya no están a la venta los productos: "Recarga 20L"' };
    });
    const user = userEvent.setup();

    await renderCreate();
    await pickCustomer(user, AURORA);
    await pickProduct(user, 1, "Recarga 20L");
    await user.click(screen.getByRole("button", { name: "Registrar pedido" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Ya no están a la venta los productos:",
    );
    expect(useRouter().currentRoute.value.path).toBe("/orders/new");
    expect(screen.getByLabelText("Producto 1").textContent).toContain("Recarga 20L");
  });

  it("un doble clic en enviar manda un solo POST", async () => {
    stubCatalog({ "c-aurora": [] });
    let posts = 0;
    stubCreate(async () => {
      posts++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { id: "o-new" };
    });
    const user = userEvent.setup();

    await renderCreate();
    await pickCustomer(user, AURORA);
    await pickProduct(user, 1, "Recarga 20L");
    const submit = screen.getByRole("button", { name: "Registrar pedido" });
    await user.dblClick(submit);

    await waitFor(() => expect(useRouter().currentRoute.value.path).toBe("/orders"));
    expect(posts).toBe(1);
  });
});
