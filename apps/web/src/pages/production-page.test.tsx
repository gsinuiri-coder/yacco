import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { ContainerType } from "../api/container-types";
import type {
  CreateProductionBatchResponse,
  PaginatedProductionBatches,
  ProductionBatch,
} from "../api/production-batches";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { ProductionPage } from "./production-page";

const CON_CANIO: ContainerType = { id: "con-canio", name: "Con caño", active: true };
const SIN_CANIO: ContainerType = { id: "sin-canio", name: "Sin caño", active: true };
const ADMIN_ID = "77777777-7777-4777-8777-777777777777";

function buildBatch(overrides: Partial<ProductionBatch> = {}): ProductionBatch {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    code: "LOTE-2026-08-22-01",
    date: "2026-08-22",
    filledById: ADMIN_ID,
    filledBy: { id: ADMIN_ID, name: "Administrador" },
    notes: null,
    items: [
      {
        id: "item-1",
        containerTypeId: CON_CANIO.id,
        containerType: CON_CANIO,
        producedQty: 200,
        availableQty: 200,
      },
    ],
    ...overrides,
  };
}

function buildPage(
  overrides: Partial<PaginatedProductionBatches> = {},
): PaginatedProductionBatches {
  const data = overrides.data ?? [buildBatch()];
  return { data, total: data.length, page: 1, limit: 20, totalPages: 1, ...overrides };
}

function stubContainerTypes(containerTypes: ContainerType[] = [CON_CANIO, SIN_CANIO]): void {
  server.use(http.get(`${API_BASE_URL}/container-types`, () => HttpResponse.json(containerTypes)));
}

function stubBatches(respond: (url: URL) => PaginatedProductionBatches): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(`${API_BASE_URL}/production-batches`, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      return HttpResponse.json(respond(url));
    }),
  );
  return seen;
}

/** Captures the JSON body of the POST so the test can assert the contract. */
function stubCreate(status = 201, payload?: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post(`${API_BASE_URL}/production-batches`, async ({ request }) => {
      captured.body = await request.json();
      if (status >= 400) {
        return HttpResponse.json(payload, { status });
      }
      return HttpResponse.json(payload ?? buildBatch(), { status });
    }),
  );
  return captured;
}

function renderProduction() {
  return renderWithProviders(
    <Routes>
      <Route path="/production" element={<ProductionPage />} />
      <Route path="/inventory" element={<h1>Inventario</h1>} />
    </Routes>,
    "/production",
  );
}

describe("ProductionPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("registra un lote de dos tipos: el POST manda la fecha como string y cantidades enteras", async () => {
    signIn(["ADMIN"]);
    const user = userEvent.setup();
    stubContainerTypes();
    stubBatches(() => buildPage());
    const captured = stubCreate(201, {
      ...buildBatch(),
      warnings: [],
    } satisfies CreateProductionBatchResponse);

    renderProduction();
    await screen.findByRole("heading", { name: "Registrar lote" });

    await user.type(screen.getByLabelText("Código"), "LOTE-2026-08-22-02");
    await user.selectOptions(
      await screen.findByLabelText("Tipo de envase (línea 1)"),
      CON_CANIO.id,
    );
    await user.type(screen.getByLabelText("Cantidad producida (línea 1)"), "200");

    await user.click(screen.getByRole("button", { name: "Agregar línea" }));
    await user.selectOptions(screen.getByLabelText("Tipo de envase (línea 2)"), SIN_CANIO.id);
    await user.type(screen.getByLabelText("Cantidad producida (línea 2)"), "150");

    await user.click(screen.getByRole("button", { name: "Registrar lote" }));

    await screen.findByText(/registrado/);
    const body = captured.body as {
      code: string;
      date: string;
      items: { containerTypeId: string; producedQty: number }[];
    };
    expect(body.code).toBe("LOTE-2026-08-22-02");
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof body.date).toBe("string");
    expect(body.items).toEqual([
      { containerTypeId: CON_CANIO.id, producedQty: 200 },
      { containerTypeId: SIN_CANIO.id, producedQty: 150 },
    ]);
  });

  it("las advertencias de sobreproducción se muestran tras un alta exitosa, con sus números, sin leerse como error", async () => {
    signIn(["ADMIN"]);
    const user = userEvent.setup();
    stubContainerTypes();
    stubBatches(() => buildPage());
    stubCreate(201, {
      ...buildBatch(),
      warnings: [
        {
          containerTypeId: CON_CANIO.id,
          containerType: CON_CANIO,
          emptyAvailable: 50,
          produced: 80,
        },
      ],
    } satisfies CreateProductionBatchResponse);

    renderProduction();
    await screen.findByRole("heading", { name: "Registrar lote" });

    await user.type(screen.getByLabelText("Código"), "LOTE-2026-08-22-03");
    await user.selectOptions(
      await screen.findByLabelText("Tipo de envase (línea 1)"),
      CON_CANIO.id,
    );
    await user.type(screen.getByLabelText("Cantidad producida (línea 1)"), "80");
    await user.click(screen.getByRole("button", { name: "Registrar lote" }));

    // Éxito primero: el registro funcionó, esto no es una pantalla de error.
    const successNotice = await screen.findByText(/registrado/);
    expect(successNotice.closest(".notice--error")).toBeNull();

    const warningNotice = await screen.findByText(/faltan registrar entradas de envases/);
    expect(warningNotice).toBeInTheDocument();
    expect(
      screen.getByText(/Con caño: se produjeron 80, había 50 vacíos en planta/),
    ).toBeInTheDocument();
  });

  it("un tipo de envase ya elegido no se ofrece en otra línea", async () => {
    signIn(["ADMIN"]);
    const user = userEvent.setup();
    stubContainerTypes();
    stubBatches(() => buildPage());

    renderProduction();
    await screen.findByRole("heading", { name: "Registrar lote" });
    await user.selectOptions(
      await screen.findByLabelText("Tipo de envase (línea 1)"),
      CON_CANIO.id,
    );
    await user.click(screen.getByRole("button", { name: "Agregar línea" }));

    const secondSelect = screen.getByLabelText("Tipo de envase (línea 2)") as HTMLSelectElement;
    expect(Array.from(secondSelect.options).map((option) => option.textContent)).not.toContain(
      "Con caño",
    );
  });

  it("no se puede quitar la última línea", async () => {
    signIn(["ADMIN"]);
    stubContainerTypes();
    stubBatches(() => buildPage());

    renderProduction();
    expect(await screen.findByRole("button", { name: "Quitar línea 1" })).toBeDisabled();
  });

  it("código duplicado: se muestra el mensaje del backend", async () => {
    signIn(["ADMIN"]);
    const user = userEvent.setup();
    stubContainerTypes();
    stubBatches(() => buildPage());
    stubCreate(409, { message: 'Ya existe un lote con el código "LOTE-2026-08-22-01"' });

    renderProduction();
    await screen.findByRole("heading", { name: "Registrar lote" });
    await user.type(screen.getByLabelText("Código"), "LOTE-2026-08-22-01");
    await user.selectOptions(
      await screen.findByLabelText("Tipo de envase (línea 1)"),
      CON_CANIO.id,
    );
    await user.type(screen.getByLabelText("Cantidad producida (línea 1)"), "200");
    await user.click(screen.getByRole("button", { name: "Registrar lote" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Ya existe un lote con el código "LOTE-2026-08-22-01"',
    );
    // Sigue en el formulario, con lo ya escrito intacto.
    expect(screen.getByLabelText("Código")).toHaveValue("LOTE-2026-08-22-01");
  });

  it("un doble clic en registrar dispara un solo POST", async () => {
    signIn(["ADMIN"]);
    const user = userEvent.setup();
    stubContainerTypes();
    stubBatches(() => buildPage());
    let postCount = 0;
    server.use(
      http.post(`${API_BASE_URL}/production-batches`, async () => {
        postCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json(
          { ...buildBatch(), warnings: [] } satisfies CreateProductionBatchResponse,
          { status: 201 },
        );
      }),
    );

    renderProduction();
    await screen.findByRole("heading", { name: "Registrar lote" });
    await user.type(screen.getByLabelText("Código"), "LOTE-2026-08-22-04");
    await user.selectOptions(
      await screen.findByLabelText("Tipo de envase (línea 1)"),
      CON_CANIO.id,
    );
    await user.type(screen.getByLabelText("Cantidad producida (línea 1)"), "200");

    const submit = screen.getByRole("button", { name: "Registrar lote" });
    await user.click(submit);
    await user.click(submit);

    await screen.findByText(/registrado/);
    expect(postCount).toBe(1);
  });

  it("un usuario no ADMIN ve la lista pero no el formulario", async () => {
    signIn(["SELLER"]);
    stubBatches(() => buildPage({ data: [buildBatch({ code: "LOTE-VISIBLE" })] }));

    renderProduction();

    expect(await screen.findByText("LOTE-VISIBLE")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Registrar lote" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Código")).not.toBeInTheDocument();
  });

  it("lista lotes con código, fecha, responsable y lo producido", async () => {
    signIn(["ADMIN"]);
    stubContainerTypes();
    stubBatches(() =>
      buildPage({
        data: [
          buildBatch({
            code: "LOTE-TABLA",
            date: "2026-08-20",
            filledBy: { id: ADMIN_ID, name: "Administrador" },
            items: [
              {
                id: "item-1",
                containerTypeId: CON_CANIO.id,
                containerType: CON_CANIO,
                producedQty: 60,
                availableQty: 60,
              },
            ],
          }),
        ],
      }),
    );

    renderProduction();

    const table = await screen.findByRole("table", { name: /Lotes de producción/ });
    const row = within(table).getByText("LOTE-TABLA").closest("tr") as HTMLElement;
    expect(within(row).getByText("20/08/2026")).toBeInTheDocument();
    expect(within(row).getByText("Administrador")).toBeInTheDocument();
    expect(within(row).getByText("60× Con caño")).toBeInTheDocument();
  });

  it("vacío real: sin lotes registrados, sin filtro", async () => {
    signIn(["ADMIN"]);
    stubContainerTypes();
    stubBatches(() => buildPage({ data: [], total: 0, totalPages: 0 }));

    renderProduction();

    expect(await screen.findByText("Todavía no hay lotes registrados")).toBeInTheDocument();
  });

  it("el rango de fechas llega a la query de la lista", async () => {
    signIn(["ADMIN"]);
    stubContainerTypes();
    const seen = stubBatches(() => buildPage());
    const user = userEvent.setup();

    renderProduction();
    await screen.findByRole("table", { name: /Lotes de producción/ });

    await user.type(screen.getByLabelText("Desde"), "2026-08-01");
    await user.type(screen.getByLabelText("Hasta"), "2026-08-31");

    expect(seen.at(-1)?.searchParams.get("dateFrom")).toBe("2026-08-01");
    expect(seen.at(-1)?.searchParams.get("dateTo")).toBe("2026-08-31");
  });
});
