import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { ContainerReconciliationDiscrepancy } from "../api/container-reconciliation";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { ContainerReconciliationPage } from "./container-reconciliation-page";

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";
const CONTAINER_TYPE_ID = "22222222-2222-4222-8222-222222222222";

function discrepancy(
  overrides: Partial<ContainerReconciliationDiscrepancy> = {},
): ContainerReconciliationDiscrepancy {
  const ledgerQuantity = overrides.ledgerQuantity ?? 8;
  const materializedQuantity = overrides.materializedQuantity ?? 5;
  return {
    locationId: LOCATION_ID,
    locationName: "Bodega Los Jazmines",
    containerTypeId: CONTAINER_TYPE_ID,
    containerTypeName: "Bidón 20L",
    ledgerQuantity,
    materializedQuantity,
    difference: ledgerQuantity - materializedQuantity,
    ...overrides,
  };
}

function stubCheck(discrepancies: ContainerReconciliationDiscrepancy[]): { calls: number } {
  const counter = { calls: 0 };
  server.use(
    http.get(`${API_BASE_URL}/container-reconciliation`, () => {
      counter.calls += 1;
      return HttpResponse.json({
        checkedAt: "2026-08-28T15:30:00.000Z",
        discrepancyCount: discrepancies.length,
        discrepancies,
      });
    }),
  );
  return counter;
}

/** Espera a que la fila exista: la tabla llega después del fetch. */
async function rowOf(text: string): Promise<HTMLElement> {
  const row = (await screen.findByText(text)).closest("tr");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function renderPage() {
  return renderWithProviders(<ContainerReconciliationPage />, "/container-reconciliation");
}

describe("ContainerReconciliationPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
  });

  // Lo que la pantalla existe para dejar claro: qué se compara contra qué.
  it("explica que son dos cuentas independientes y que informa sin corregir", async () => {
    stubCheck([]);

    renderPage();

    expect(await screen.findByRole("heading", { name: "Qué se compara" })).toBeInTheDocument();
    expect(screen.getByText("Lo que pasó")).toBeInTheDocument();
    expect(screen.getByText("Lo que el sistema muestra")).toBeInTheDocument();
    expect(screen.getByText(/informa y no corrige/)).toBeInTheDocument();
  });

  // El resultado esperado es la lista vacía: tiene que leerse como una buena
  // noticia, no como una pantalla rota.
  it("sin descuadres lo dice como buena noticia, no como lista vacía", async () => {
    stubCheck([]);

    renderPage();

    expect(await screen.findByText("Las dos cuentas coinciden")).toBeInTheDocument();
    expect(
      screen.getByText(/El saldo que muestran las pantallas es confiable/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("muestra la fecha en que se corrió el cuadre", async () => {
    stubCheck([]);

    renderPage();

    // `checkedAt` es un instante, no un día de negocio: va con hora, en Lima.
    expect(await screen.findByText("Revisado el 28/08/2026 10:30.")).toBeInTheDocument();
  });

  it("lista un descuadre con las dos cuentas y el sentido de la diferencia", async () => {
    stubCheck([discrepancy({ ledgerQuantity: 8, materializedQuantity: 5 })]);

    renderPage();

    expect(
      await screen.findByText("Hay 1 saldo que no coincide con sus movimientos.", { exact: false }),
    ).toBeInTheDocument();
    const row = await rowOf("Bodega Los Jazmines");
    expect(within(row).getByText("Bidón 20L")).toBeInTheDocument();
    expect(within(row).getByText("8")).toBeInTheDocument();
    expect(within(row).getByText("5")).toBeInTheDocument();
    expect(within(row).getByText("+3")).toBeInTheDocument();
    expect(within(row).getByText("Al saldo le faltan 3 envases")).toBeInTheDocument();
  });

  // El signo es la información: un faltante y un sobrante son hallazgos
  // distintos y nunca se muestran en valor absoluto.
  it("un saldo con envases de más se describe al revés, no en valor absoluto", async () => {
    stubCheck([discrepancy({ ledgerQuantity: 2, materializedQuantity: 4 })]);

    renderPage();

    const row = await rowOf("Bodega Los Jazmines");
    expect(within(row).getByText("-2")).toBeInTheDocument();
    expect(within(row).getByText("El saldo tiene 2 envases de más")).toBeInTheDocument();
  });

  it("con un solo envase de diferencia habla en singular", async () => {
    stubCheck([discrepancy({ ledgerQuantity: 4, materializedQuantity: 3 })]);

    renderPage();

    expect(await screen.findByText("Al saldo le falta 1 envase")).toBeInTheDocument();
  });

  it("varios descuadres se cuentan en plural", async () => {
    stubCheck([
      discrepancy(),
      discrepancy({
        locationId: "33333333-3333-4333-8333-333333333333",
        locationName: "Farmacia San Judas",
      }),
    ]);

    renderPage();

    expect(
      await screen.findByText("Hay 2 saldos que no coinciden con sus movimientos.", {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  // Un nombre nulo no es un hueco de formato: es el hallazgo. La consulta usa
  // LEFT JOIN para que la fila huérfana aparezca en vez de desaparecer.
  it("una ubicación que no resuelve se nombra como tal, con su id a la vista", async () => {
    stubCheck([discrepancy({ locationName: null })]);

    renderPage();

    const row = await rowOf("Ubicación desconocida");
    expect(within(row).getByText(LOCATION_ID)).toBeInTheDocument();
  });

  it("un movimiento sin ubicación lo dice en vez de mostrar una celda vacía", async () => {
    stubCheck([discrepancy({ locationId: null, locationName: null })]);

    renderPage();

    expect(await screen.findByText("Ubicación desconocida")).toBeInTheDocument();
    expect(screen.getByText("el movimiento no indica ubicación")).toBeInTheDocument();
  });

  it("un tipo de envase que no resuelve también se nombra", async () => {
    stubCheck([discrepancy({ containerTypeName: null })]);

    renderPage();

    const row = await rowOf("Tipo de envase desconocido");
    expect(within(row).getByText(CONTAINER_TYPE_ID)).toBeInTheDocument();
  });

  it("«Volver a revisar» vuelve a correr el cuadre", async () => {
    const user = userEvent.setup();
    const counter = stubCheck([]);

    renderPage();
    await screen.findByText("Las dos cuentas coinciden");
    expect(counter.calls).toBe(1);

    await user.click(screen.getByRole("button", { name: "Volver a revisar" }));

    expect(await screen.findByText("Las dos cuentas coinciden")).toBeInTheDocument();
    expect(counter.calls).toBe(2);
  });

  it("muestra el error y permite reintentar", async () => {
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/container-reconciliation`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json({
          checkedAt: "2026-08-28T15:30:00.000Z",
          discrepancyCount: 0,
          discrepancies: [],
        });
      }),
    );
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Las dos cuentas coinciden")).toBeInTheDocument();
  });

  // El 403 de Nest es genérico; este se traduce al vocabulario de la planta.
  it("traduce el 403 del backend", async () => {
    server.use(
      http.get(`${API_BASE_URL}/container-reconciliation`, () =>
        HttpResponse.json({ message: "Forbidden resource" }, { status: 403 }),
      ),
    );

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo un administrador puede correr el cuadre de envases",
    );
  });

  it("un vendedor ve por qué no puede correrlo, y no se llama a la API", async () => {
    localStorage.clear();
    signIn(["SELLER"]);
    const counter = stubCheck([]);

    renderPage();

    expect(await screen.findByText("Este cuadre es solo para administradores")).toBeInTheDocument();
    expect(counter.calls).toBe(0);
    expect(screen.queryByRole("button", { name: "Volver a revisar" })).not.toBeInTheDocument();
  });
});
