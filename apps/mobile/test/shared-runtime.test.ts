import { buildMarkBody } from "@yacco/shared";

/**
 * @yacco/shared importa con extensión `.js` (es ESM para la API y la web); sin
 * el `moduleNameMapper` de package.json, jest no encuentra esos archivos y la
 * app no puede usar las reglas que comparte con la web.
 */
it("las reglas de @yacco/shared corren en el celular", () => {
  expect(
    buildMarkBody(
      {
        outcome: "FAILED",
        failureReason: " ",
        items: [],
        returns: [],
        paymentMethodId: "",
        amount: "",
        authorizerId: "",
      },
      [],
    ),
  ).toBe("Escribe por qué no se pudo entregar");
});
