import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type { EffectivePrice, Product, RouteStop } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildOrder, buildRoute, buildStop } from "../support/fixtures";
import { failWith, stubRouteDetail, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const STOP_PATH = "/api/v1/routes/r-1/stops/stop-1";
const RECARGA: Product = {
  id: "p-recarga",
  name: "Recarga 20L",
  type: "REFILL",
  containerType: { id: "ct-bidon", name: "Bidón 20L" },
  listPrice: "12.50",
  active: true,
};
const AGREED: EffectivePrice[] = [
  { product: { id: "p-recarga", name: "Recarga 20L" }, price: "12.50", source: "CUSTOMER" },
];

function stubMarkCatalogs(effective: EffectivePrice[] = AGREED) {
  cleanups.push(
    registerEndpoint("/api/v1/products", () => [RECARGA]),
    registerEndpoint("/api/v1/payment-methods", () => [
      { id: "m-cash", name: "Efectivo", active: true, requiresConfirmation: false },
    ]),
    registerEndpoint("/api/v1/users", () => [
      { id: "u-admin", name: "Administrador", username: "admin", active: true, roles: ["ADMIN"] },
    ]),
    registerEndpoint("/api/v1/customers/c-central/effective-prices", () => effective),
  );
}

function delivered(overrides: Partial<RouteStop> = {}): RouteStop {
  return buildStop({ status: "DELIVERED", ...overrides });
}

/** La ruta en curso con una parada pendiente, y la misma ya resuelta tras la recarga. */
function stubInProgress(stop = buildStop(), after: RouteStop = delivered()) {
  stubRouteDetail(cleanups, [
    buildRoute({ status: "IN_PROGRESS", stops: [stop] }),
    buildRoute({ status: "IN_PROGRESS", stops: [after] }),
  ]);
}

async function openMarkForm() {
  await renderSuspended(App, { route: "/routes/r-1" });
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Registrar la parada de Bodega Central" }));
  return screen.findByRole("form", { name: "Registrar la parada de Bodega Central" });
}

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

const submitMark = () =>
  userEvent.setup().click(screen.getByRole("button", { name: "Registrar la parada" }));

describe("Registrar lo que pasó en la parada", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("registra un canje con vacíos devueltos y resume venta, cobro y envases del cliente", async () => {
    stubInProgress();
    stubMarkCatalogs();
    cleanups.push(
      registerEndpoint("/api/v1/container-types", () => [
        { id: "ct-bidon", name: "Bidón 20L", active: true },
      ]),
    );
    const bodies = stubWrite(cleanups, STOP_PATH, "PATCH", () =>
      delivered({
        sale: { id: "s-1", total: "37.50", creditLimitExceeded: false },
        payment: { id: "pay-1", status: "CONFIRMED", amount: "20.00" },
        containerBalances: [
          {
            containerTypeId: "ct-bidon",
            containerType: { id: "ct-bidon", name: "Bidón 20L" },
            quantity: 2,
          },
        ],
      }),
    );
    const user = userEvent.setup();

    await openMarkForm();
    await choose("Producto 1", "Recarga 20L");
    await user.clear(screen.getByLabelText("Cantidad del producto 1"));
    await user.type(screen.getByLabelText("Cantidad del producto 1"), "3");
    expect(screen.getByText("Pactado: S/ 12.50")).toBeTruthy();
    expect(screen.getByText("Total de la venta").parentElement?.textContent).toContain("S/ 37.50");
    await user.click(screen.getByRole("button", { name: "Agregar envases devueltos" }));
    await choose("Tipo de envase 1", "Bidón 20L");
    await user.clear(screen.getByLabelText("Vacíos devueltos 1"));
    await user.type(screen.getByLabelText("Vacíos devueltos 1"), "3");
    await choose("Método de pago", "Efectivo");
    await user.type(screen.getByLabelText("Monto cobrado"), "20.00");
    await submitMark();

    const notice = await screen.findByText(/Entrega de Bodega Central registrada/);
    expect(notice.textContent).toContain("por S/ 37.50");
    expect(notice.textContent).toContain("Cobro de S/ 20.00 (confirmado)");
    expect(notice.textContent).toContain("Envases en poder del cliente: 2 × Bidón 20L");
    expect(bodies).toEqual([
      {
        status: "DELIVERED",
        items: [{ productId: "p-recarga", quantity: 3 }],
        containersReturned: [{ containerTypeId: "ct-bidon", quantity: 3 }],
        payment: { paymentMethodId: "m-cash", amount: "20.00" },
      },
    ]);
    // El formulario se cierra y la ruta recargada ya muestra la parada resuelta.
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: /Registrar la parada/ })).toBeNull(),
    );
  });

  it("el aviso de límite de crédito aparece sin haber bloqueado nada, y sin cobro queda al fiado", async () => {
    stubInProgress();
    stubMarkCatalogs();
    const bodies = stubWrite(cleanups, STOP_PATH, "PATCH", () =>
      delivered({
        sale: { id: "s-1", total: "500.00", creditLimitExceeded: true },
        payment: null,
        containerBalances: [],
      }),
    );

    await openMarkForm();
    await choose("Producto 1", "Recarga 20L");
    await submitMark();

    expect(
      await screen.findByText(
        "Esta venta superó el límite de crédito de Bodega Central. Quedó registrada igual.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Entrega de Bodega Central registrada/).textContent).toContain(
      "No se cobró nada: queda al fiado",
    );
    expect(bodies[0]).not.toHaveProperty("payment");
  });

  it("una parada fallida manda sólo el motivo y se resume con él", async () => {
    stubInProgress(buildStop(), buildStop({ status: "FAILED", failureReason: "Estaba cerrado" }));
    stubMarkCatalogs();
    const bodies = stubWrite(cleanups, STOP_PATH, "PATCH", () =>
      buildStop({ status: "FAILED", failureReason: "Estaba cerrado" }),
    );
    const user = userEvent.setup();

    const form = await openMarkForm();
    await user.click(within(form).getByRole("button", { name: "No se pudo entregar" }));
    await user.type(screen.getByLabelText("¿Por qué no se pudo entregar?"), "Estaba cerrado");
    await submitMark();

    expect(
      await screen.findByText(
        "La parada de Bodega Central quedó registrada como no entregada: Estaba cerrado.",
      ),
    ).toBeTruthy();
    expect(bodies).toEqual([{ status: "FAILED", failureReason: "Estaba cerrado" }]);
  });

  it("un precio distinto del pactado se marca, pide quién lo autorizó y lo manda", async () => {
    stubInProgress();
    stubMarkCatalogs();
    const bodies = stubWrite(cleanups, STOP_PATH, "PATCH", () => delivered());
    const user = userEvent.setup();

    await openMarkForm();
    await choose("Producto 1", "Recarga 20L");
    await user.type(screen.getByLabelText("Precio cobrado del producto 1"), "10.00");
    expect(await screen.findByText("Distinto del pactado")).toBeTruthy();
    await submitMark();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Un precio distinto del pactado necesita quién lo autorizó",
    );
    expect(bodies).toHaveLength(0);

    await choose("¿Quién autorizó el precio distinto?", "Administrador");
    await submitMark();

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          status: "DELIVERED",
          items: [{ productId: "p-recarga", quantity: 1, unitPrice: "10.00" }],
          priceOverrideAuthorizedById: "u-admin",
        },
      ]),
    );
  });

  it("una parada que viene de un pedido precarga lo pedido, con su total", async () => {
    const fromOrder = buildStop({ orderId: "o-5" });
    stubInProgress(fromOrder);
    stubMarkCatalogs();
    cleanups.push(
      registerEndpoint("/api/v1/orders/o-5", () =>
        buildOrder({
          id: "o-5",
          items: [
            {
              id: "i",
              productId: "p-recarga",
              product: { id: "p-recarga", name: "Recarga 20L" },
              quantity: 5,
              unitPrice: "12.50",
            },
          ],
        }),
      ),
    );

    await openMarkForm();

    await waitFor(() =>
      expect((screen.getByLabelText("Cantidad del producto 1") as HTMLInputElement).value).toBe(
        "5",
      ),
    );
    expect(screen.getByText("Total de la venta").parentElement?.textContent).toContain("S/ 62.50");
  });

  it("muestra tal cual el error de la API (stock del camión) y no cierra el formulario", async () => {
    stubInProgress();
    stubMarkCatalogs();
    stubWrite(
      cleanups,
      STOP_PATH,
      "PATCH",
      failWith(400, 'Stock insuficiente de "Bidón 20L" en el camión: hay 2, se pidió 3'),
    );

    await openMarkForm();
    await choose("Producto 1", "Recarga 20L");
    await submitMark();

    expect((await screen.findByRole("alert")).textContent).toContain("Stock insuficiente");
    expect(
      screen.getByRole("form", { name: "Registrar la parada de Bodega Central" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Entrega de Bodega Central registrada/)).toBeNull();
  });

  it("una validación del formulario lo dice sin llamar a la API; «Cancelar» cierra sin registrar", async () => {
    stubInProgress();
    stubMarkCatalogs();
    const bodies = stubWrite(cleanups, STOP_PATH, "PATCH", () => delivered());

    await openMarkForm();
    await submitMark();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Elige el producto de la línea 1",
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("form", { name: /Registrar la parada/ })).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it("el botón se deshabilita mientras la parada se registra", async () => {
    stubInProgress();
    stubMarkCatalogs();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bodies = stubWrite(cleanups, STOP_PATH, "PATCH", async () => {
      await gate;
      return delivered();
    });

    await openMarkForm();
    await choose("Producto 1", "Recarga 20L");
    await submitMark();

    const pending = await screen.findByRole("button", { name: "Registrando…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    release?.();
    await screen.findByText(/Entrega de Bodega Central registrada/);
    expect(bodies).toHaveLength(1);
  });
});
