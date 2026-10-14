import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import type { UserRole } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];

const currentSettings = {
  id: "22222222-2222-4222-8222-222222222222",
  taxId: "20123456789",
  legalName: "Agua Clara S.A.C.",
  fiscalAddress: "Av. Los Manantiales 145, Lima",
  taxRate: "18.00",
  receiptDocumentThreshold: "700.00",
  createdById: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-14T03:30:00.000Z",
  createdBy: { id: "11111111-1111-4111-8111-111111111111", username: "Giancarlo" },
};

function stubCurrent(value: typeof currentSettings | null = currentSettings): { calls: number } {
  const counter = { calls: 0 };
  cleanups.push(
    registerEndpoint("/api/v1/issuer-settings/current", {
      method: "GET",
      handler: () => {
        counter.calls++;
        return value;
      },
    }),
  );
  return counter;
}

async function renderPage(roles: UserRole[] = ["ADMIN"]): Promise<void> {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/issuer-settings" });
  await screen.findByRole("heading", { name: "Datos de facturación", level: 1 });
}

describe("Datos de facturación", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("el administrador encuentra la pantalla en la navegación y ve la versión vigente", async () => {
    stubCurrent();

    await renderPage();
    await screen.findByText("Agua Clara S.A.C.");

    const navigation = screen.getByRole("navigation", { name: "Principal" });
    expect(within(navigation).getByRole("link", { name: "Datos de facturación" })).toBeTruthy();
    const current = screen.getByRole("region", { name: "Versión vigente" });
    expect(within(current).getByText("Agua Clara S.A.C.")).toBeTruthy();
    expect(within(current).getByText("RUC 20123456789")).toBeTruthy();
    expect(within(current).getByText("18.00 %")).toBeTruthy();
    expect(within(current).getByText("S/ 700.00")).toBeTruthy();
    expect(within(current).getByText(/Giancarlo · 13\/10\/2026 22:30/)).toBeTruthy();
  });

  it("el vendedor no ve el enlace, recibe una explicación y no consulta la configuración", async () => {
    const current = stubCurrent();

    await renderPage(["SELLER"]);

    const navigation = screen.getByRole("navigation", { name: "Principal" });
    expect(within(navigation).queryByRole("link", { name: "Datos de facturación" })).toBeNull();
    expect(screen.getByText("Esta configuración es solo para administradores")).toBeTruthy();
    expect(current.calls).toBe(0);
    expect(screen.queryByRole("button", { name: "Guardar nueva versión" })).toBeNull();
  });

  it("si todavía no hay datos propone los valores fiscales acordados sin inventar la empresa", async () => {
    stubCurrent(null);

    await renderPage();

    expect(await screen.findByText("Todavía no hay datos de facturación")).toBeTruthy();
    expect(screen.getByLabelText("RUC del emisor")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Razón social")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Tasa de IGV")).toHaveProperty("value", "18.00");
    expect(screen.getByLabelText("Boleta exige documento desde")).toHaveProperty("value", "700.00");
  });

  it("guarda una versión nueva con dinero y tasa como textos de dos decimales", async () => {
    stubCurrent();
    const created = {
      ...currentSettings,
      id: "33333333-3333-4333-8333-333333333333",
      taxRate: "17.50",
      receiptDocumentThreshold: "850.00",
    };
    const bodies = stubWrite(cleanups, "/api/v1/issuer-settings", "POST", () => created);

    await renderPage();
    await screen.findByText("Agua Clara S.A.C.");
    const user = userEvent.setup();
    const taxRate = screen.getByLabelText("Tasa de IGV");
    const threshold = screen.getByLabelText("Boleta exige documento desde");
    await user.clear(taxRate);
    await user.type(taxRate, "17.5");
    await user.clear(threshold);
    await user.type(threshold, "850");
    await user.click(screen.getByRole("button", { name: "Guardar nueva versión" }));

    expect(
      await screen.findByText("Se guardó una nueva versión de los datos de facturación."),
    ).toBeTruthy();
    expect(bodies).toEqual([
      {
        taxId: "20123456789",
        legalName: "Agua Clara S.A.C.",
        fiscalAddress: "Av. Los Manantiales 145, Lima",
        taxRate: "17.50",
        receiptDocumentThreshold: "850.00",
      },
    ]);
    const current = screen.getByRole("region", { name: "Versión vigente" });
    expect(within(current).getByText("17.50 %")).toBeTruthy();
    expect(within(current).getByText("S/ 850.00")).toBeTruthy();
  });

  it("no envía RUC, tasa ni umbral mal escritos y explica cómo corregirlos", async () => {
    stubCurrent(null);
    const bodies = stubWrite(cleanups, "/api/v1/issuer-settings", "POST");

    await renderPage();
    await screen.findByText("Todavía no hay datos de facturación");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("RUC del emisor"), "123");
    await user.type(screen.getByLabelText("Razón social"), "Agua Clara");
    await user.type(screen.getByLabelText("Dirección fiscal"), "Av. Planta 123");
    await user.clear(screen.getByLabelText("Tasa de IGV"));
    await user.type(screen.getByLabelText("Tasa de IGV"), "18,00");
    await user.clear(screen.getByLabelText("Boleta exige documento desde"));
    await user.type(screen.getByLabelText("Boleta exige documento desde"), "700,00");
    await user.click(screen.getByRole("button", { name: "Guardar nueva versión" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("El RUC debe tener 11 dígitos");
    expect(alert.textContent).toContain("La tasa y el monto se escriben con punto y dos decimales");
    expect(bodies).toHaveLength(0);
  });
});
