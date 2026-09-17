import type { EffectivePrice } from "@yacco/shared";
import { describe, expect, it } from "vitest";
import { buildMarkBody, isPriceOverride, saleTotal } from "../../app/utils/stop-mark";
import type { StopMarkDraft } from "../../app/utils/stop-mark";

const RECARGA = "p-recarga";
const BIDON_NUEVO = "p-bidon";
const PRICES: EffectivePrice[] = [
  { product: { id: RECARGA, name: "Recarga 20L" }, price: "12.50", source: "CUSTOMER" },
];

function draft(overrides: Partial<StopMarkDraft> = {}): StopMarkDraft {
  return {
    outcome: "DELIVERED",
    failureReason: "",
    items: [{ key: 0, productId: RECARGA, quantity: "1", unitPrice: "" }],
    returns: [],
    paymentMethodId: "",
    amount: "",
    authorizerId: "",
    ...overrides,
  };
}

describe("buildMarkBody — los escenarios de HU-12", () => {
  it("canje 1:1: recargas entregadas y los mismos vacíos devueltos", () => {
    expect(
      buildMarkBody(
        draft({
          items: [{ key: 0, productId: RECARGA, quantity: "3", unitPrice: "" }],
          returns: [{ key: 1, containerTypeId: "ct-bidon", quantity: "3" }],
        }),
        PRICES,
      ),
    ).toEqual({
      status: "DELIVERED",
      items: [{ productId: RECARGA, quantity: 3 }],
      containersReturned: [{ containerTypeId: "ct-bidon", quantity: 3 }],
    });
  });

  it("venta completa: una recarga más dos envases vendidos y un vacío", () => {
    expect(
      buildMarkBody(
        draft({
          items: [
            { key: 0, productId: RECARGA, quantity: "1", unitPrice: "" },
            { key: 1, productId: BIDON_NUEVO, quantity: "2", unitPrice: "" },
          ],
          returns: [{ key: 2, containerTypeId: "ct-bidon", quantity: "1" }],
        }),
        PRICES,
      ),
    ).toMatchObject({
      items: [
        { productId: RECARGA, quantity: 1 },
        { productId: BIDON_NUEVO, quantity: 2 },
      ],
      containersReturned: [{ containerTypeId: "ct-bidon", quantity: 1 }],
    });
  });

  it("sin método de pago va al fiado: el cuerpo no lleva payment; un cobro parcial sí", () => {
    expect(buildMarkBody(draft(), PRICES)).not.toHaveProperty("payment");
    expect(
      buildMarkBody(draft({ paymentMethodId: "m-cash", amount: "5.00" }), PRICES),
    ).toMatchObject({ payment: { paymentMethodId: "m-cash", amount: "5.00" } });
  });

  it("una parada fallida manda sólo el motivo, y sin motivo no se envía", () => {
    expect(buildMarkBody(draft({ outcome: "FAILED", failureReason: " Cerrado " }), PRICES)).toEqual(
      { status: "FAILED", failureReason: "Cerrado" },
    );
    expect(buildMarkBody(draft({ outcome: "FAILED" }), PRICES)).toBe(
      "Escribe por qué no se pudo entregar",
    );
  });
});

describe("buildMarkBody — lo que no se puede enviar, nombrando la línea", () => {
  it.each([
    [
      draft({ items: [{ key: 0, productId: "", quantity: "1", unitPrice: "" }] }),
      "Elige el producto de la línea 1",
    ],
    [
      draft({ items: [{ key: 0, productId: RECARGA, quantity: "0", unitPrice: "" }] }),
      "La cantidad de la línea 1 debe ser un número entero mayor que 0",
    ],
    [
      draft({ items: [{ key: 0, productId: RECARGA, quantity: "1", unitPrice: "12,50" }] }),
      'El precio de la línea 1 debe ser un monto como "12.50"',
    ],
    [draft({ items: [] }), "Una entrega tiene que decir qué se entregó"],
    [
      draft({ returns: [{ key: 1, containerTypeId: "", quantity: "1" }] }),
      "Elige el tipo de envase devuelto de la línea 1",
    ],
    [
      draft({ returns: [{ key: 1, containerTypeId: "ct", quantity: "x" }] }),
      "Los envases devueltos de la línea 1 deben ser un número entero mayor que 0",
    ],
    [
      draft({ paymentMethodId: "m-cash" }),
      "Escribe cuánto se cobró, o quita el método de pago para dejarlo al fiado",
    ],
    [draft({ amount: "25.00" }), "Elige con qué método se cobró"],
    [
      draft({ paymentMethodId: "m-cash", amount: "25" + ".005" }),
      'El monto cobrado debe ser un monto como "25.00"',
    ],
  ])("%#", (input, message) => {
    expect(buildMarkBody(input, PRICES)).toBe(message);
  });
});

describe("precio distinto del pactado", () => {
  const typed = (unitPrice: string) => ({ key: 0, productId: RECARGA, quantity: "1", unitPrice });

  it("pide quién lo autorizó, y con autorizador lo manda", () => {
    expect(buildMarkBody(draft({ items: [typed("10.00")] }), PRICES)).toBe(
      "Un precio distinto del pactado necesita quién lo autorizó",
    );
    expect(
      buildMarkBody(draft({ items: [typed("10.00")], authorizerId: "u-admin" }), PRICES),
    ).toMatchObject({
      items: [{ productId: RECARGA, quantity: 1, unitPrice: "10.00" }],
      priceOverrideAuthorizedById: "u-admin",
    });
  });

  it("escribir el mismo pactado con otra forma (12.5) no es un precio distinto", () => {
    expect(isPriceOverride(typed("12.5"), PRICES)).toBe(false);
    expect(buildMarkBody(draft({ items: [typed("12.5")] }), PRICES)).toMatchObject({
      items: [{ unitPrice: "12.5" }],
    });
  });

  it("sin pactado a la vista no hay con qué comparar: decide la API", () => {
    expect(isPriceOverride(typed("9.00"), [])).toBe(false);
    expect(buildMarkBody(draft({ items: [typed("9.00")] }), [])).toMatchObject({
      items: [{ unitPrice: "9.00" }],
    });
  });
});

describe("saleTotal", () => {
  it("usa el precio escrito o, si está vacío, el pactado; ignora lo que no se puede calcular", () => {
    expect(
      saleTotal(
        [
          { key: 0, productId: RECARGA, quantity: "4", unitPrice: "" },
          { key: 1, productId: BIDON_NUEVO, quantity: "2", unitPrice: "35.00" },
          { key: 2, productId: BIDON_NUEVO, quantity: "2", unitPrice: "" },
        ],
        PRICES,
      ),
    ).toBe("120.00");
  });
});
