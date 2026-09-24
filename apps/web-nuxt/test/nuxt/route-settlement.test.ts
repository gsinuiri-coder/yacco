import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type {
  RouteSettlement,
  RouteSettlementExpected,
  RouteSettlementView,
  RouteStatus,
} from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildRoute } from "../support/fixtures";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const SETTLEMENT_PATH = "/api/v1/routes/r-1/settlement";

/** fullOut 20, entregados 10, vendidos 4 → deberían volver 6; vacíos 11 + 3. */
const EXPECTED: RouteSettlementExpected = {
  fullOut: 20,
  fullDelivered: 10,
  fullSold: 4,
  emptiesPickedUp: 14,
  emptiesPickedUpByType: [
    { containerTypeId: "ct-cano", containerTypeName: "Con caño", quantity: 11 },
    { containerTypeId: "ct-sin", containerTypeName: "Sin caño", quantity: 3 },
  ],
  totalSold: "320.00",
  totalCollected: "280.00",
  totalCashCollected: "150.00",
  totalPendingConfirmation: "130.00",
  totalOnCredit: "40.30",
};

function settled(overrides: Partial<RouteSettlement> = {}): RouteSettlement {
  return {
    routeId: "r-1",
    fullOut: 20,
    fullDelivered: 10,
    fullSold: 4,
    fullReturned: 6,
    emptiesCollected: 14,
    emptiesCollectedByType: [
      { containerTypeId: "ct-cano", containerTypeName: "Con caño", quantity: 11 },
      { containerTypeId: "ct-sin", containerTypeName: "Sin caño", quantity: 3 },
    ],
    totalSold: "320.00",
    totalCollected: "280.00",
    totalCashCollected: "150.00",
    totalPendingConfirmation: "130.00",
    totalOnCredit: "40.30",
    notes: null,
    settledById: "u-admin",
    settledAt: "2026-08-28T23:10:00.000Z",
    ...overrides,
  };
}

/** Cada lectura puede devolver otra versión: la segunda trae la fila tras liquidar. */
function stubView(status: RouteStatus[], views: Array<Partial<RouteSettlementView>>) {
  let routeCalls = 0;
  let viewCalls = 0;
  cleanups.push(
    registerEndpoint("/api/v1/routes/r-1", {
      method: "GET",
      handler: () => buildRoute({ status: status[Math.min(routeCalls++, status.length - 1)]! }),
    }),
    registerEndpoint(SETTLEMENT_PATH, {
      method: "GET",
      handler: () => ({
        expected: EXPECTED,
        settlement: null,
        unresolvedStops: 0,
        settlementOutdated: false,
        ...views[Math.min(viewCalls++, views.length - 1)],
      }),
    }),
    registerEndpoint("/api/v1/container-types", () => [
      { id: "ct-cano", name: "Con caño", active: true },
      { id: "ct-sin", name: "Sin caño", active: true },
    ]),
  );
}

async function renderSettlement() {
  await renderSuspended(App, { route: "/routes/r-1/settlement" });
  await screen.findByRole("heading", { name: "Liquidación de la ruta del 28/08/2026", level: 1 });
}

const user = () => userEvent.setup();
const fullReturnedInput = () => screen.getByLabelText("Llenos que volvieron sin entregar");
const emptiesInput = (type: string) => screen.getByLabelText(`Vacíos contados de ${type}`);
const settleButton = () =>
  screen.getByRole("button", { name: "Liquidar la ruta" }) as HTMLButtonElement;

describe("Liquidación de la ruta", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("muestra el libro, cuántos llenos deberían volver y el dinero sin perder céntimos", async () => {
    stubView(["FINISHED"], [{}]);

    await renderSettlement();

    const libro = screen.getByRole("heading", { name: "Lo que dice el libro" }).closest("section")!;
    expect(within(libro).getByText("Deberían volver").nextElementSibling?.textContent).toBe("6");
    expect(within(libro).getByText("S/ 320.00")).toBeTruthy();
    expect(within(libro).getByText("S/ 40.30")).toBeTruthy();
    expect(screen.getByText("Según el libro deberían volver 6.")).toBeTruthy();
  });

  it("la hoja de vacíos va por tipo, con el libro al lado y la diferencia mientras se escribe", async () => {
    stubView(["FINISHED"], [{}]);

    await renderSettlement();
    const sheet = screen.getByRole("table", { name: /Vacíos contados al descargar/ });
    const cano = within(sheet).getByText("Con caño").closest("tr") as HTMLElement;
    expect(within(cano).getByText("11")).toBeTruthy();
    // Vacío vale cero: la diferencia se ve desde el arranque en la tabla, con
    // la palabra al lado del signo: «+11» solo se lee al revés («once de más»).
    expect(within(cano).getByText("+11: faltan 11")).toBeTruthy();
    // ...pero el aviso agregado espera a que alguien escriba.
    expect(screen.queryByText(/Con estos números/)).toBeNull();

    await user().type(emptiesInput("Con caño"), "12");
    await waitFor(() => expect(within(cano).getByText("-1: sobra 1")).toBeTruthy());
    await user().clear(emptiesInput("Con caño"));
    await user().type(emptiesInput("Con caño"), "11");
    await waitFor(() => expect(within(cano).getByText("Cuadra")).toBeTruthy());
  });

  it("con los conteos que cuadran lo dice antes de liquidar", async () => {
    stubView(["FINISHED"], [{}]);

    await renderSettlement();
    await user().type(fullReturnedInput(), "6");
    await user().type(emptiesInput("Con caño"), "11");
    await user().type(emptiesInput("Sin caño"), "3");

    expect(await screen.findByText("Con estos números la ruta cuadra.")).toBeTruthy();
  });

  it("anuncia la diferencia antes de liquidar, con su signo, y NO bloquea el botón", async () => {
    stubView(["FINISHED"], [{}]);

    await renderSettlement();
    await user().type(fullReturnedInput(), "4");
    await user().type(emptiesInput("Con caño"), "13");
    await user().type(emptiesInput("Sin caño"), "5");

    expect(
      await screen.findByText("Con estos números va a quedar registrada una diferencia:"),
    ).toBeTruthy();
    expect(screen.getByText("Llenos: +2 (faltan 2 respecto del libro).")).toBeTruthy();
    expect(screen.getByText("Vacíos: -4 (sobran 4 respecto del libro).")).toBeTruthy();
    expect(settleButton().disabled).toBe(false);
  });

  it("liquida con una diferencia: manda sólo lo contado (sin líneas en cero ni nota vacía) y la muestra", async () => {
    stubView(
      ["FINISHED", "SETTLED"],
      [
        {},
        {
          settlement: settled({
            fullReturned: 4,
            emptiesCollected: 11,
            emptiesCollectedByType: [
              { containerTypeId: "ct-cano", containerTypeName: "Con caño", quantity: 11 },
            ],
          }),
        },
      ],
    );
    const bodies = stubWrite(cleanups, SETTLEMENT_PATH, "POST", () => ({
      settlement: settled(),
      differences: {
        containers: 2,
        empties: 3,
        emptiesByType: [
          { containerTypeId: "ct-cano", containerTypeName: "Con caño", difference: 0 },
          { containerTypeId: "ct-sin", containerTypeName: "Sin caño", difference: 3 },
        ],
      },
    }));

    await renderSettlement();
    await user().type(fullReturnedInput(), "4");
    await user().type(emptiesInput("Con caño"), "11");
    await user().click(settleButton());

    const liquidada = (await screen.findByRole("heading", { name: "Liquidada" })).closest(
      "section",
    )!;
    expect(
      within(liquidada).getByText("Diferencia de llenos").nextElementSibling?.textContent,
    ).toBe("+2");
    expect(
      within(liquidada).getByText("Diferencia de vacíos").nextElementSibling?.textContent,
    ).toBe("+3");
    expect(screen.queryByRole("form", { name: "Liquidar la ruta" })).toBeNull();
    expect(bodies).toEqual([
      { fullReturned: 4, emptiesCollected: [{ containerTypeId: "ct-cano", quantity: 11 }] },
    ]);
  });

  it("la nota viaja recortada cuando se escribe", async () => {
    stubView(["FINISHED"], [{}]);
    const bodies = stubWrite(cleanups, SETTLEMENT_PATH, "POST", failWith(409, "stop"));

    await renderSettlement();
    await user().type(fullReturnedInput(), "6");
    await user().type(screen.getByLabelText("Nota (opcional)"), "  Se rompió un bidón  ");
    await user().click(settleButton());

    await waitFor(() =>
      expect(bodies).toEqual([
        { fullReturned: 6, emptiesCollected: [], notes: "Se rompió un bidón" },
      ]),
    );
  });

  it("sin contar los llenos, o con un vacío mal escrito, no llama a la API y nombra el tipo", async () => {
    stubView(["FINISHED"], [{}]);
    const bodies = stubWrite(cleanups, SETTLEMENT_PATH, "POST");

    await renderSettlement();
    await user().click(settleButton());
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Los llenos que volvieron deben ser un número entero, 0 o más",
    );

    await user().type(fullReturnedInput(), "6");
    await user().type(emptiesInput("Sin caño"), "1.5");
    await user().click(settleButton());
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Los vacíos contados de Sin caño deben ser un número entero, 0 o más",
      ),
    );
    expect(bodies).toHaveLength(0);
  });

  it("un 403 se explica en el vocabulario de la planta; un 409 se muestra tal cual", async () => {
    stubView(["FINISHED"], [{}]);
    let attempt = 0;
    stubWrite(cleanups, SETTLEMENT_PATH, "POST", (event) => {
      attempt++;
      return attempt === 1
        ? failWith(403, "Forbidden resource")(event)
        : failWith(409, "La ruta ya no está terminada")(event);
    });

    await renderSettlement();
    await user().type(fullReturnedInput(), "6");
    await user().click(settleButton());
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Sólo un administrador puede liquidar la ruta.",
    );

    await user().click(settleButton());
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("La ruta ya no está terminada"),
    );
  });

  it("una ruta en curso o planificada no deja liquidar y lo explica", async () => {
    stubView(["IN_PROGRESS"], [{}]);

    await renderSettlement();

    expect(
      screen.getByText("La ruta todavía está en curso. Se puede liquidar cuando esté terminada."),
    ).toBeTruthy();
    expect(settleButton().disabled).toBe(true);
    expect(screen.getByText("Sólo se liquida una ruta terminada.")).toBeTruthy();
  });

  it("avisa las paradas sin resolver, en singular y en plural", async () => {
    stubView(["FINISHED"], [{ unresolvedStops: 1 }]);

    await renderSettlement();

    expect(
      screen.getByText(
        "Queda 1 parada sin resolver: lo que haya pasado ahí no está en estos números.",
      ),
    ).toBeTruthy();
  });

  describe("ya liquidada", () => {
    it("muestra el resultado sin formulario y recalcula las dos diferencias", async () => {
      stubView(
        ["SETTLED"],
        [{ settlement: settled({ fullReturned: 5, emptiesCollected: 12, notes: "Faltó uno" }) }],
      );

      await renderSettlement();

      const liquidada = screen.getByRole("heading", { name: "Liquidada" }).closest("section")!;
      expect(within(liquidada).getByText("Cerrada el 28/08/2026 18:10.")).toBeTruthy();
      expect(
        within(liquidada).getByText("Diferencia de llenos").nextElementSibling?.textContent,
      ).toBe("+1");
      expect(
        within(liquidada).getByText("Diferencia de vacíos").nextElementSibling?.textContent,
      ).toBe("+2");
      expect(within(liquidada).getByText("Faltó uno")).toBeTruthy();
      expect(screen.queryByRole("form", { name: "Liquidar la ruta" })).toBeNull();
      // El dinero de referencia es el de la fila: no se repite arriba.
      expect(screen.getAllByText("S/ 320.00")).toHaveLength(1);
    });

    it("sin corrección posterior y con el dinero igual al libro, ningún aviso", async () => {
      stubView(["SETTLED"], [{ settlement: settled() }]);

      await renderSettlement();

      expect(screen.queryByText(/Se corrigió una parada/)).toBeNull();
      expect(screen.queryByText(/Estos son los montos del momento/)).toBeNull();
      expect(screen.queryByText(/libro de hoy/)).toBeNull();
    });

    it("sin corrección posterior, la deriva de dinero se atribuye al pago resuelto", async () => {
      stubView(
        ["SETTLED"],
        [
          {
            settlement: settled(),
            expected: { ...EXPECTED, totalCollected: "150.00", totalPendingConfirmation: "0.00" },
          },
        ],
      );

      await renderSettlement();

      expect(
        screen.getByText(
          "Estos son los montos del momento en que se liquidó. Desde entonces se resolvió algún pago que estaba por confirmar, así que el libro hoy dice S/ 150.00 cobrado.",
        ),
      ).toBeTruthy();
    });

    it("con una corrección posterior lo avisa, aclara la diferencia de vacíos y el aviso de dinero NO nombra los pagos", async () => {
      stubView(
        ["SETTLED"],
        [
          {
            settlement: settled(),
            settlementOutdated: true,
            expected: { ...EXPECTED, totalCollected: "300.00" },
          },
        ],
      );

      await renderSettlement();

      expect(
        screen.getByText("Se corrigió una parada después de cerrar esta liquidación."),
      ).toBeTruthy();
      expect(
        screen.getByText("Comparado contra el libro de hoy, que ya incluye la corrección."),
      ).toBeTruthy();
      expect(
        screen.getByText(
          "Estos son los montos del momento en que se liquidó. El libro hoy dice S/ 300.00 cobrado.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/se resolvió algún pago/)).toBeNull();
    });
  });

  it("una ruta que no existe ofrece volver; un error de carga se reintenta", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/routes/r-1", {
        method: "GET",
        handler: (event) => {
          attempt++;
          return failWith(
            attempt === 1 ? 500 : 404,
            attempt === 1 ? "Base de datos no disponible" : "no existe",
          )(event);
        },
      }),
      registerEndpoint(SETTLEMENT_PATH, { method: "GET", handler: () => ({}) }),
      registerEndpoint("/api/v1/container-types", () => []),
    );

    await renderSuspended(App, { route: "/routes/r-1/settlement" });
    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    await user().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Esa ruta no existe")).toBeTruthy();
  });
});
