import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, readBody } from "h3";
import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { pageOf } from "../support/fixtures";
import { stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const SALE_ONE = "77777777-7777-4777-8777-777777777777";
const SALE_TWO = "88888888-8888-4888-8888-888888888888";
const RECEIPT_ID = "22222222-2222-4222-8222-222222222222";

const customer = {
  id: CUSTOMER_ID,
  name: "Bodega Santa Rosa",
  phone: "999111222",
  address: "Av. Grau 120",
  addressReference: "",
  contactName: null,
  latitude: null,
  longitude: null,
  zoneId: null,
  zone: null,
  creditLimit: null,
  debtBalance: "118.00",
  active: true,
  createdAt: "2026-10-01T13:00:00.000Z",
  documentType: "DNI",
  documentNumber: "12345678",
  legalName: null,
  fiscalAddress: null,
};

const sales = [
  {
    id: SALE_ONE,
    soldAt: "2026-10-13T16:00:00.000Z",
    total: "70.00",
    location: { id: "loc-1", name: "Local Centro" },
    status: "AVAILABLE",
    receipt: null,
    exemption: null,
  },
  {
    id: SALE_TWO,
    soldAt: "2026-10-14T16:00:00.000Z",
    total: "48.00",
    location: { id: "loc-2", name: "Sucursal Norte" },
    status: "AVAILABLE",
    receipt: null,
    exemption: null,
  },
];

function stubPrerequisites(): Array<Record<string, string>> {
  const queries: Array<Record<string, string>> = [];
  cleanups.push(
    registerEndpoint(`/api/v1/customers/${CUSTOMER_ID}`, {
      method: "GET",
      handler: () => customer,
    }),
    registerEndpoint("/api/v1/receipts/sales", {
      method: "GET",
      handler: (event: H3Event) => {
        queries.push(getQuery(event) as Record<string, string>);
        return pageOf(sales);
      },
    }),
  );
  return queries;
}

async function renderPage(saleId?: string): Promise<void> {
  cleanups.push(signIn(["SELLER"]));
  const saleQuery = saleId === undefined ? "" : `&saleId=${saleId}`;
  await renderSuspended(App, { route: `/receipts/new?customerId=${CUSTOMER_ID}${saleQuery}` });
  await screen.findByRole("heading", { name: "Registrar comprobante", level: 1 });
}

async function choose(label: string, option: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

async function selectSales(): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox", { name: /13\/10\/2026.*Local Centro/ }));
  await user.click(screen.getByRole("checkbox", { name: /14\/10\/2026.*Sucursal Norte/ }));
}

describe("Registrar comprobante", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("parte del cliente indicado y ofrece solo sus ventas disponibles", async () => {
    const queries = stubPrerequisites();

    await renderPage();

    expect(await screen.findByText("Bodega Santa Rosa")).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Ventas sin comprobante" });
    expect(within(table).getByText("Local Centro")).toBeTruthy();
    expect(within(table).getByText("Sucursal Norte")).toBeTruthy();
    expect(within(table).getByText("S/ 70.00")).toBeTruthy();
    expect(queries[0]).toEqual({
      customerId: CUSTOMER_ID,
      status: "AVAILABLE",
      page: "1",
      limit: "100",
    });
  });

  it("parte con la venta indicada ya elegida", async () => {
    stubPrerequisites();

    await renderPage(SALE_ONE);

    expect(
      (await screen.findByRole("checkbox", { name: /13\/10\/2026.*Local Centro/ })).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(
      screen
        .getByRole("checkbox", { name: /14\/10\/2026.*Sucursal Norte/ })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("pide a la API la vista previa y muestra base, IGV y total antes de guardar", async () => {
    stubPrerequisites();
    const previewBodies: unknown[] = [];
    cleanups.push(
      registerEndpoint("/api/v1/receipts/preview", {
        method: "POST",
        handler: async (event: H3Event) => {
          previewBodies.push(await readBody(event));
          return {
            customerId: CUSTOMER_ID,
            saleIds: [SALE_ONE, SALE_TWO],
            issuerSettingsVersionId: "44444444-4444-4444-8444-444444444444",
            taxRate: "18.00",
            taxableAmount: "100.00",
            taxAmount: "18.00",
            total: "118.00",
          };
        },
      }),
    );

    await renderPage();
    await selectSales();
    await userEvent.setup().click(screen.getByRole("button", { name: "Calcular montos" }));

    expect(previewBodies).toEqual([
      { type: "SALES_RECEIPT", customerId: CUSTOMER_ID, saleIds: [SALE_ONE, SALE_TWO] },
    ]);
    const preview = await screen.findByRole("region", { name: "Vista previa de montos" });
    expect(within(preview).getByText("S/ 100.00")).toBeTruthy();
    expect(within(preview).getByText("S/ 18.00")).toBeTruthy();
    expect(within(preview).getByText("S/ 118.00")).toBeTruthy();
    expect(within(preview).getByText("IGV 18.00 %")).toBeTruthy();
  });

  it("avisa una serie inusual pero permite registrar con los textos exactos", async () => {
    stubPrerequisites();
    cleanups.push(
      registerEndpoint("/api/v1/receipts/preview", {
        method: "POST",
        handler: () => ({
          customerId: CUSTOMER_ID,
          saleIds: [SALE_ONE, SALE_TWO],
          issuerSettingsVersionId: "44444444-4444-4444-8444-444444444444",
          taxRate: "18.00",
          taxableAmount: "100.00",
          taxAmount: "18.00",
          total: "118.00",
        }),
      }),
    );
    const bodies = stubWrite(cleanups, "/api/v1/receipts", "POST", () => ({
      id: RECEIPT_ID,
    }));

    await renderPage();
    const user = userEvent.setup();
    await selectSales();
    await user.click(screen.getByRole("button", { name: "Calcular montos" }));
    await screen.findByRole("region", { name: "Vista previa de montos" });
    await choose("Medio", "Electrónico");
    await user.type(screen.getByLabelText("Serie"), "SERIE-LARGA");
    await user.type(screen.getByLabelText("Número"), "000009");
    await user.click(screen.getByRole("button", { name: "Registrar comprobante" }));

    expect(await screen.findByText(/La serie no tiene el formato habitual/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Registrar de todas formas" }));
    await waitFor(() =>
      expect(useRouter().currentRoute.value.path).toBe(`/receipts/${RECEIPT_ID}`),
    );
    expect(bodies).toEqual([
      {
        type: "SALES_RECEIPT",
        medium: "ELECTRONIC",
        series: "SERIE-LARGA",
        number: "000009",
        issuedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        customerId: CUSTOMER_ID,
        saleIds: [SALE_ONE, SALE_TWO],
      },
    ]);
  });

  it("explica los adjuntos permitidos según el medio", async () => {
    stubPrerequisites();

    await renderPage();

    expect(screen.getByText("Puedes adjuntar una foto o un PDF.")).toBeTruthy();
    await choose("Medio", "Electrónico");
    expect(screen.getByText("Puedes adjuntar un PDF y un XML.")).toBeTruthy();
    expect(screen.getByLabelText("Archivos del comprobante")).toBeTruthy();
  });
});
