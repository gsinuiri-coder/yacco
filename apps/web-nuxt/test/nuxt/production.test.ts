import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery } from "h3";
import type { H3Event } from "h3";
import type { ProductionBatch, UserRole } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { pageOf } from "../support/fixtures";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const CON_CANO = { id: "ct-cano", name: "Con caño", active: true };
const SIN_CANO = { id: "ct-sin", name: "Sin caño", active: true };

function batch(overrides: Partial<ProductionBatch> = {}): ProductionBatch {
  return {
    id: "b-1",
    code: "LOTE-2026-08-22-01",
    date: "2026-08-22",
    filledById: "u-1",
    filledBy: { id: "u-1", name: "Rosa Mamani" },
    notes: null,
    items: [
      {
        id: "i-1",
        containerTypeId: "ct-cano",
        containerType: { id: "ct-cano", name: "Con caño" },
        producedQty: 200,
        availableQty: 80,
      },
    ],
    ...overrides,
  };
}

function stubPage(batches: ProductionBatch[] = [batch()]) {
  const queries: Array<Record<string, unknown>> = [];
  cleanups.push(
    registerEndpoint("/api/v1/container-types", () => [CON_CANO, SIN_CANO]),
    registerEndpoint("/api/v1/production-batches", {
      method: "GET",
      handler: (event: H3Event) => {
        queries.push(getQuery(event));
        return pageOf(batches);
      },
    }),
  );
  return queries;
}

async function renderProduction(roles: UserRole[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/production" });
  await screen.findByRole("heading", { name: "Producción", level: 1 });
}

async function chooseType(line: number, name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText(`Tipo de envase ${line}`));
  await user.click(await screen.findByRole("option", { name }));
}

describe("Producción", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("registra un lote de dos tipos: fecha como texto AAAA-MM-DD y cantidades enteras", async () => {
    const queries = stubPage();
    const bodies = stubWrite(cleanups, "/api/v1/production-batches", "POST", () => ({
      ...batch({ code: "LOTE-02" }),
      warnings: [],
    }));
    const user = userEvent.setup();

    await renderProduction();
    await user.type(screen.getByLabelText("Código"), " LOTE-02 ");
    await chooseType(1, "Con caño");
    await user.type(screen.getByLabelText("Cantidad producida 1"), "200");
    await user.click(screen.getByRole("button", { name: "Agregar tipo de envase" }));
    await chooseType(2, "Sin caño");
    await user.type(screen.getByLabelText("Cantidad producida 2"), "150");
    await user.click(screen.getByRole("button", { name: "Registrar lote" }));

    expect(await screen.findByText("Lote LOTE-02 registrado.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver inventario actualizado" })).toBeTruthy();
    expect(bodies).toEqual([
      {
        code: "LOTE-02",
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        items: [
          { containerTypeId: "ct-cano", producedQty: 200 },
          { containerTypeId: "ct-sin", producedQty: 150 },
        ],
      },
    ]);
    // El formulario se vacía y la lista se recarga.
    expect((screen.getByLabelText("Código") as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(queries.length).toBeGreaterThan(1));
  });

  it("la sobreproducción se avisa con sus números tras un alta exitosa, sin leerse como error", async () => {
    stubPage();
    stubWrite(cleanups, "/api/v1/production-batches", "POST", () => ({
      ...batch({ code: "LOTE-03" }),
      warnings: [
        {
          containerTypeId: "ct-cano",
          containerType: { id: "ct-cano", name: "Con caño" },
          emptyAvailable: 120,
          produced: 200,
        },
      ],
    }));
    const user = userEvent.setup();

    await renderProduction();
    await user.type(screen.getByLabelText("Código"), "LOTE-03");
    await chooseType(1, "Con caño");
    await user.type(screen.getByLabelText("Cantidad producida 1"), "200");
    await user.click(screen.getByRole("button", { name: "Registrar lote" }));

    expect(await screen.findByText("Lote LOTE-03 registrado.")).toBeTruthy();
    expect(screen.getByText(/El lote se guardó igual/)).toBeTruthy();
    expect(
      screen.getByText("Con caño: se produjeron 200, había 120 vacíos en planta."),
    ).toBeTruthy();
  });

  it("un tipo ya elegido no se ofrece en otra línea; la última línea no se quita", async () => {
    stubPage();
    const user = userEvent.setup();

    await renderProduction();
    expect(
      (screen.getByRole("button", { name: "Quitar tipo de envase 1" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await chooseType(1, "Con caño");
    await user.click(screen.getByRole("button", { name: "Agregar tipo de envase" }));
    await user.click(screen.getByLabelText("Tipo de envase 2"));

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual(["Sin caño"]);
  });

  it("valida código, tipo y cantidad antes de llamar, y corregir una línea borra sólo su error", async () => {
    stubPage();
    const bodies = stubWrite(cleanups, "/api/v1/production-batches", "POST");
    const user = userEvent.setup();

    await renderProduction();
    await user.click(screen.getByRole("button", { name: "Agregar tipo de envase" }));
    await user.click(screen.getByRole("button", { name: "Registrar lote" }));

    expect(await screen.findByText("El código no puede estar vacío")).toBeTruthy();
    expect(screen.getAllByText("Elige un tipo de envase", { selector: "p" })).toHaveLength(2);
    expect(bodies).toHaveLength(0);

    await chooseType(1, "Con caño");
    await waitFor(() =>
      expect(screen.getAllByText("Elige un tipo de envase", { selector: "p" })).toHaveLength(1),
    );
  });

  it("el código duplicado se muestra con el mensaje de la API; un doble clic manda un solo POST", async () => {
    stubPage();
    let posts = 0;
    stubWrite(cleanups, "/api/v1/production-batches", "POST", async (event) => {
      posts++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return failWith(400, 'Ya existe un lote con el código "LOTE-01"')(event);
    });
    const user = userEvent.setup();

    await renderProduction();
    await user.type(screen.getByLabelText("Código"), "LOTE-01");
    await chooseType(1, "Con caño");
    await user.type(screen.getByLabelText("Cantidad producida 1"), "10");
    await user.dblClick(screen.getByRole("button", { name: "Registrar lote" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      'Ya existe un lote con el código "LOTE-01"',
    );
    expect(posts).toBe(1);
  });

  it("un vendedor ve los lotes pero no el formulario", async () => {
    stubPage();

    await renderProduction(["SELLER"]);

    expect(await screen.findByText("LOTE-2026-08-22-01")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Registrar lote" })).toBeNull();
  });

  it("lista código, fecha, responsable, lo producido y lo que queda sin cargar (o «Todo cargado»)", async () => {
    stubPage([
      batch({
        items: [
          {
            id: "i-1",
            containerTypeId: "ct-cano",
            containerType: { id: "ct-cano", name: "Con caño" },
            producedQty: 200,
            availableQty: 80,
          },
          {
            id: "i-2",
            containerTypeId: "ct-sin",
            containerType: { id: "ct-sin", name: "Sin caño" },
            producedQty: 50,
            availableQty: 0,
          },
        ],
      }),
      batch({
        id: "b-2",
        code: "LOTE-VIEJO",
        items: [
          {
            id: "i-3",
            containerTypeId: "ct-cano",
            containerType: { id: "ct-cano", name: "Con caño" },
            producedQty: 100,
            availableQty: 0,
          },
        ],
      }),
    ]);

    await renderProduction(["SELLER"]);

    const row = (await screen.findByText("LOTE-2026-08-22-01")).closest("tr") as HTMLElement;
    expect(within(row).getByText("22/08/2026")).toBeTruthy();
    expect(within(row).getByText("Rosa Mamani")).toBeTruthy();
    expect(within(row).getByText("200× Con caño, 50× Sin caño")).toBeTruthy();
    // Sólo el tipo que todavía tiene unidades.
    expect(within(row).getByText("80× Con caño")).toBeTruthy();
    const old = screen.getByText("LOTE-VIEJO").closest("tr") as HTMLElement;
    expect(within(old).getByText("Todo cargado")).toBeTruthy();
  });

  it("el rango de fechas llega a la query; sin lotes lo dice", async () => {
    const queries = stubPage([]);

    await renderProduction(["SELLER"]);
    expect(await screen.findByText("Todavía no hay lotes registrados")).toBeTruthy();

    await fireEvent.update(screen.getByLabelText("Desde"), "2026-08-01");
    await fireEvent.update(screen.getByLabelText("Hasta"), "2026-08-31");

    await waitFor(() =>
      expect(queries.at(-1)).toEqual({
        dateFrom: "2026-08-01",
        dateTo: "2026-08-31",
        page: "1",
        limit: "20",
      }),
    );
    expect(await screen.findByText("Ningún lote coincide con el filtro")).toBeTruthy();
  });
});
