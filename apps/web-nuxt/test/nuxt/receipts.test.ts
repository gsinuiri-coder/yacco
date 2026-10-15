import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, readBody } from "h3";
import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { pageOf } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const RECEIPT_ID = "22222222-2222-4222-8222-222222222222";
const CREDIT_NOTE_ID = "99999999-9999-4999-8999-999999999999";
type Query = Record<string, string>;

const activeReceipt = {
  id: RECEIPT_ID,
  type: "SALES_RECEIPT",
  medium: "MANUAL",
  series: "B001",
  number: "000123",
  issuedOn: "2026-10-14",
  customerId: "33333333-3333-4333-8333-333333333333",
  issuerSettingsVersionId: "44444444-4444-4444-8444-444444444444",
  taxableAmount: "100.00",
  taxAmount: "18.00",
  total: "118.00",
  affectedReceiptId: null,
  reason: null,
  createdById: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-14T15:30:00.000Z",
  voidedAt: null,
  voidedById: null,
  voidReason: null,
  status: "ACTIVE",
  customer: { id: "33333333-3333-4333-8333-333333333333", name: "Bodega Santa Rosa" },
  createdBy: { id: "11111111-1111-4111-8111-111111111111", username: "vendedor1" },
};

const voidedReceipt = {
  ...activeReceipt,
  id: "55555555-5555-4555-8555-555555555555",
  type: "INVOICE",
  medium: "EXTERNAL_ELECTRONIC",
  series: "F001",
  number: "000045",
  total: "236.00",
  status: "VOIDED",
  voidedAt: "2026-10-15T13:00:00.000Z",
  voidedById: "11111111-1111-4111-8111-111111111111",
  voidReason: "Se registró la serie equivocada",
};

function receiptDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...activeReceipt,
    issuerSettingsVersion: {
      id: "44444444-4444-4444-8444-444444444444",
      taxId: "20123456789",
      legalName: "Agua Clara S.A.C.",
      fiscalAddress: "Av. Los Manantiales 145, Lima",
      taxRate: "18.00",
      receiptDocumentThreshold: "700.00",
    },
    sales: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        soldAt: "2026-10-13T16:00:00.000Z",
        total: "118.00",
        location: { id: "loc-1", name: "Local Centro" },
        releasedAt: null,
      },
    ],
    files: [],
    creditNotes: [],
    voidedBy: null,
    ...overrides,
  };
}

function creditNoteDetail(overrides: Record<string, unknown> = {}) {
  return receiptDetail({
    id: CREDIT_NOTE_ID,
    type: "CREDIT_NOTE",
    series: "BC01",
    number: "000007",
    affectedReceiptId: RECEIPT_ID,
    reason: "Devolución total del pedido",
    sales: [],
    ...overrides,
  });
}

const voidedFields = {
  status: "VOIDED",
  voidedAt: "2026-10-15T13:00:00.000Z",
  voidedById: "11111111-1111-4111-8111-111111111111",
  voidReason: "La nota no se llegó a entregar",
  voidedBy: { id: "11111111-1111-4111-8111-111111111111", username: "administrador" },
};

async function renderDetail(id: string, detail: unknown): Promise<void> {
  cleanups.push(
    signIn(["ADMIN"]),
    registerEndpoint(`/api/v1/receipts/${id}`, { method: "GET", handler: () => detail }),
  );
  await renderSuspended(App, { route: `/receipts/${id}` });
  await screen.findByRole("heading", { level: 1, name: /B001-000123|BC01-000007/ });
}

const RESTORE_LINK = "Volver a registrar el original";

function stubReceipts(rows = [activeReceipt, voidedReceipt]): Query[] {
  const seen: Query[] = [];
  cleanups.push(
    registerEndpoint("/api/v1/receipts", {
      method: "GET",
      handler: (event: H3Event) => {
        seen.push(getQuery(event) as Query);
        return pageOf(rows);
      },
    }),
  );
  return seen;
}

async function renderList(): Promise<void> {
  cleanups.push(signIn(["ADMIN"]));
  await renderSuspended(App, { route: "/receipts" });
  await screen.findByRole("heading", { name: "Comprobantes", level: 1 });
}

async function choose(label: string, option: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("Comprobantes", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("aparece en la navegación de oficina y lista comprobantes activos y anulados", async () => {
    const seen = stubReceipts();

    await renderList();

    const navigation = screen.getByRole("navigation", { name: "Principal" });
    expect(within(navigation).getByRole("link", { name: "Comprobantes" })).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Comprobantes registrados" });
    const active = within(table).getByText("B001-000123").closest("tr") as HTMLElement;
    expect(within(active).getByText("Boleta")).toBeTruthy();
    expect(within(active).getByText("Manual")).toBeTruthy();
    expect(within(active).getByText("14/10/2026")).toBeTruthy();
    expect(within(active).getByText("S/ 118.00")).toBeTruthy();
    expect(within(active).getByText("Vigente")).toBeTruthy();
    const voided = within(table).getByText("F001-000045").closest("tr") as HTMLElement;
    expect(within(voided).getByText("Factura")).toBeTruthy();
    expect(within(voided).getByText("Electrónico")).toBeTruthy();
    expect(within(voided).getByText("Anulado")).toBeTruthy();
    expect(seen[0]).toEqual({ page: "1", limit: "20" });
  });

  it("envía tipo, medio, estado y días de emisión como filtros de negocio", async () => {
    const seen = stubReceipts([activeReceipt]);

    await renderList();
    await screen.findByText("B001-000123");
    await choose("Tipo", "Factura");
    await choose("Medio", "Electrónico");
    await choose("Estado", "Anulado");
    await fireEvent.update(screen.getByLabelText("Emitido desde"), "2026-10-01");
    await fireEvent.update(screen.getByLabelText("Emitido hasta"), "2026-10-31");

    await waitFor(() =>
      expect(seen.at(-1)).toEqual({
        type: "INVOICE",
        medium: "EXTERNAL_ELECTRONIC",
        status: "VOIDED",
        issuedFrom: "2026-10-01",
        issuedTo: "2026-10-31",
        page: "1",
        limit: "20",
      }),
    );
  });

  it("cuando no hay comprobantes ofrece registrar el primero", async () => {
    stubReceipts([]);

    await renderList();

    expect(await screen.findByText("Todavía no hay comprobantes registrados")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Registrar comprobante" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: expect.stringContaining("/receipts/new") }),
      ]),
    );
  });

  it("el detalle reúne ventas, archivos, datos fiscales y auditoría sin esconder la anulación", async () => {
    cleanups.push(signIn(["ADMIN"]));
    cleanups.push(
      registerEndpoint(`/api/v1/receipts/${RECEIPT_ID}`, {
        method: "GET",
        handler: () => ({
          ...activeReceipt,
          status: "VOIDED",
          voidedAt: "2026-10-15T13:00:00.000Z",
          voidedById: "66666666-6666-4666-8666-666666666666",
          voidReason: "El número no correspondía al talonario",
          issuerSettingsVersion: {
            id: "44444444-4444-4444-8444-444444444444",
            taxId: "20123456789",
            legalName: "Agua Clara S.A.C.",
            fiscalAddress: "Av. Los Manantiales 145, Lima",
            taxRate: "18.00",
            receiptDocumentThreshold: "700.00",
          },
          sales: [
            {
              id: "77777777-7777-4777-8777-777777777777",
              soldAt: "2026-10-13T16:00:00.000Z",
              total: "70.00",
              location: { id: "loc-1", name: "Local Centro" },
              releasedAt: "2026-10-15T13:00:00.000Z",
            },
            {
              id: "88888888-8888-4888-8888-888888888888",
              soldAt: "2026-10-14T16:00:00.000Z",
              total: "48.00",
              location: { id: "loc-2", name: "Sucursal Norte" },
              releasedAt: "2026-10-15T13:00:00.000Z",
            },
          ],
          files: [
            { fileName: "boleta.pdf", contentType: "application/pdf" },
            { fileName: "boleta.jpg", contentType: "image/jpeg" },
          ],
          creditNotes: [],
          voidedBy: { id: "66666666-6666-4666-8666-666666666666", username: "Giancarlo" },
        }),
      }),
    );

    await renderSuspended(App, { route: `/receipts/${RECEIPT_ID}` });

    expect(await screen.findByRole("heading", { name: "Boleta B001-000123" })).toBeTruthy();
    expect(screen.getByText("Anulado")).toBeTruthy();
    expect(screen.getByText("El número no correspondía al talonario")).toBeTruthy();
    const totals = screen.getByRole("region", { name: "Montos del comprobante" });
    expect(within(totals).getByText("S/ 100.00")).toBeTruthy();
    expect(within(totals).getByText("S/ 18.00")).toBeTruthy();
    expect(within(totals).getByText("S/ 118.00")).toBeTruthy();
    const sales = screen.getByRole("table", { name: "Ventas del comprobante" });
    expect(within(sales).getByText("Local Centro")).toBeTruthy();
    expect(within(sales).getByText("13/10/2026 11:00")).toBeTruthy();
    expect(within(sales).getByText("S/ 70.00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abrir boleta.pdf" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abrir boleta.jpg" })).toBeTruthy();
    expect(screen.getByText("Agua Clara S.A.C.")).toBeTruthy();
    expect(screen.getByText(/Registrado por vendedor1 el 14\/10\/2026 10:30/)).toBeTruthy();
    expect(screen.getByText(/Anulado por Giancarlo el 15\/10\/2026 08:00/)).toBeTruthy();
  });

  it("ADMIN anula con motivo, libera las ventas y conserva el comprobante visible", async () => {
    cleanups.push(signIn(["ADMIN"]));
    let detail = receiptDetail();
    let submitted: unknown;
    cleanups.push(
      registerEndpoint(`/api/v1/receipts/${RECEIPT_ID}`, {
        method: "GET",
        handler: () => detail,
      }),
      registerEndpoint(`/api/v1/receipts/${RECEIPT_ID}/void`, {
        method: "PATCH",
        handler: async (event: H3Event) => {
          submitted = await readBody(event);
          detail = receiptDetail({
            status: "VOIDED",
            voidedAt: "2026-10-14T17:00:00.000Z",
            voidedById: "11111111-1111-4111-8111-111111111111",
            voidReason: "El número no correspondía al talonario",
            voidedBy: {
              id: "11111111-1111-4111-8111-111111111111",
              username: "administrador",
            },
          });
          return { id: RECEIPT_ID, releasedSales: 1 };
        },
      }),
    );

    await renderSuspended(App, { route: `/receipts/${RECEIPT_ID}` });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Anular comprobante" }));
    await fireEvent.update(
      screen.getByLabelText("Motivo de anulación"),
      "El número no correspondía al talonario",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Confirmar anulación" }));

    await waitFor(() =>
      expect(submitted).toEqual({ reason: "El número no correspondía al talonario" }),
    );
    expect(await screen.findByText("Anulado")).toBeTruthy();
    expect(screen.getByText("El número no correspondía al talonario")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Boleta B001-000123" })).toBeTruthy();
  });

  it("SELLER registra una nota de crédito y no puede anular directamente", async () => {
    cleanups.push(signIn(["SELLER"]));
    let submitted: unknown;
    cleanups.push(
      registerEndpoint(`/api/v1/receipts/${RECEIPT_ID}`, {
        method: "GET",
        handler: () => receiptDetail(),
      }),
      registerEndpoint(`/api/v1/receipts/${RECEIPT_ID}/credit-notes`, {
        method: "POST",
        handler: async (event: H3Event) => {
          submitted = await readBody(event);
          return {
            ...activeReceipt,
            id: CREDIT_NOTE_ID,
            type: "CREDIT_NOTE",
            medium: "EXTERNAL_ELECTRONIC",
            series: "BC01",
            number: "000007",
            affectedReceiptId: RECEIPT_ID,
            reason: "Devolución total del pedido",
          };
        },
      }),
      registerEndpoint(`/api/v1/receipts/${CREDIT_NOTE_ID}`, {
        method: "GET",
        handler: () =>
          receiptDetail({
            id: CREDIT_NOTE_ID,
            type: "CREDIT_NOTE",
            medium: "EXTERNAL_ELECTRONIC",
            series: "BC01",
            number: "000007",
            affectedReceiptId: RECEIPT_ID,
            reason: "Devolución total del pedido",
          }),
      }),
    );

    await renderSuspended(App, { route: `/receipts/${RECEIPT_ID}` });
    expect(await screen.findByRole("heading", { name: "Boleta B001-000123" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Anular comprobante" })).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Registrar nota de crédito" }));
    await choose("Medio de la nota", "Electrónico");
    await fireEvent.update(screen.getByLabelText("Serie de la nota"), "BC01");
    await fireEvent.update(screen.getByLabelText("Número de la nota"), "000007");
    await fireEvent.update(screen.getByLabelText("Fecha de emisión"), "2026-10-14");
    await fireEvent.update(
      screen.getByLabelText("Motivo de la nota"),
      "Devolución total del pedido",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Guardar nota de crédito" }));

    await waitFor(() =>
      expect(submitted).toEqual({
        medium: "EXTERNAL_ELECTRONIC",
        series: "BC01",
        number: "000007",
        issuedOn: "2026-10-14",
        reason: "Devolución total del pedido",
      }),
    );
    await waitFor(() =>
      expect(useRouter().currentRoute.value.path).toBe(`/receipts/${CREDIT_NOTE_ID}`),
    );
  });

  it("una nota de crédito manual vigente ofrece anular al ADMIN sin prometer liberar ventas", async () => {
    await renderDetail(CREDIT_NOTE_ID, creditNoteDetail());
    await userEvent.setup().click(screen.getByRole("button", { name: "Anular comprobante" }));

    expect(
      screen.getByText(
        "La nota seguirá visible como anulada. El comprobante original sigue anulado: para restaurarlo, vuelve a registrarlo.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/sus ventas volverán a quedar disponibles/)).toBeNull();
  });

  it("una nota de crédito electrónica vigente no ofrece anular", async () => {
    await renderDetail(CREDIT_NOTE_ID, creditNoteDetail({ medium: "EXTERNAL_ELECTRONIC" }));
    expect(screen.queryByRole("button", { name: "Anular comprobante" })).toBeNull();
  });

  it("la nota de crédito anulada ofrece volver a registrar el original y enlaza a él", async () => {
    await renderDetail(CREDIT_NOTE_ID, creditNoteDetail(voidedFields));

    expect(screen.getByRole("link", { name: RESTORE_LINK }).getAttribute("href")).toBe(
      `/receipts/new?from=${RECEIPT_ID}`,
    );
    expect(screen.queryByRole("button", { name: "Anular comprobante" })).toBeNull();
  });

  it("el original anulado lista sus notas y solo ofrece volver a registrarlo sin nota vigente", async () => {
    const creditNote = {
      id: CREDIT_NOTE_ID,
      series: "BC01",
      number: "000007",
      medium: "MANUAL",
      status: "VOIDED",
    };
    await renderDetail(RECEIPT_ID, receiptDetail({ ...voidedFields, creditNotes: [creditNote] }));

    expect(screen.getByRole("link", { name: RESTORE_LINK }).getAttribute("href")).toBe(
      `/receipts/new?from=${RECEIPT_ID}`,
    );
    expect(
      screen
        .getByRole("link", { name: "Nota de crédito BC01-000007 (anulada)" })
        .getAttribute("href"),
    ).toBe(`/receipts/${CREDIT_NOTE_ID}`);
  });

  it("el original anulado por una nota de crédito vigente no ofrece volver a registrarlo", async () => {
    await renderDetail(
      RECEIPT_ID,
      receiptDetail({
        ...voidedFields,
        creditNotes: [
          {
            id: CREDIT_NOTE_ID,
            series: "BC01",
            number: "000007",
            medium: "EXTERNAL_ELECTRONIC",
            status: "ACTIVE",
          },
        ],
      }),
    );

    expect(
      screen.getByRole("link", { name: "Nota de crédito BC01-000007 (vigente)" }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: RESTORE_LINK })).toBeNull();
  });
});
