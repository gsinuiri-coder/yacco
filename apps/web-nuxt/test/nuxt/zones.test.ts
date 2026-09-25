import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery } from "h3";
import type { H3Event } from "h3";
import type { Zone } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const NORTE: Zone = {
  id: "norte-id",
  name: "Norte",
  deliveryDays: ["MONDAY", "WEDNESDAY"],
  active: true,
};
const SUR: Zone = { id: "sur-id", name: "Sur", deliveryDays: [], active: true };
const OLD: Zone = { id: "old-id", name: "Zona antigua", deliveryDays: [], active: false };

function stubList(zones: Zone[]) {
  // El conteo de clientes por zona se pide aparte; por defecto, sin clientes.
  // Un test que lo necesita registra el suyo después y ese es el que responde.
  cleanups.push(
    registerEndpoint("/api/v1/customers/zone-counts", () => ({ zones: [], withoutZone: 0 })),
  );
  cleanups.push(
    registerEndpoint("/api/v1/zones", {
      method: "GET",
      handler: (event: H3Event) => {
        const active = getQuery(event).active !== "false";
        return zones.filter((zone) => zone.active === active);
      },
    }),
  );
}

async function renderPage(roles: ("ADMIN" | "SELLER")[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/zones" });
  await screen.findByRole("heading", { name: "Zonas", level: 1 });
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

describe("Zonas", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista las zonas activas y retiradas, ordenadas por nombre, con sus días", async () => {
    stubList([NORTE, SUR, OLD]);

    await renderPage();

    expect(await screen.findByText("Norte")).toBeTruthy();
    const norte = rowOf("Norte");
    expect(within(norte).getByText("Lunes, Miércoles")).toBeTruthy();
    expect(within(norte).getByText("En uso")).toBeTruthy();

    const sur = rowOf("Sur");
    expect(within(sur).getByText("Sin días definidos")).toBeTruthy();

    const old = rowOf("Zona antigua");
    expect(within(old).getByText("Retirada")).toBeTruthy();
  });

  it("dice cuántos clientes activos tiene cada zona y, arriba, cuántos quedan sin zona", async () => {
    stubList([NORTE, SUR, OLD]);
    cleanups.push(
      registerEndpoint("/api/v1/customers/zone-counts", () => ({
        zones: [
          { zoneId: NORTE.id, activeCustomers: 476 },
          { zoneId: OLD.id, activeCustomers: 3 },
        ],
        withoutZone: 68,
      })),
    );

    await renderPage();

    await screen.findByText("Norte");
    expect(await screen.findByText("68 clientes activos sin zona")).toBeTruthy();
    expect(within(rowOf("Norte")).getByText("476")).toBeTruthy();
    // Una zona que no vino en el conteo no tiene clientes activos.
    expect(within(rowOf("Sur")).getByText("0")).toBeTruthy();
    expect(within(rowOf("Zona antigua")).getByText("3")).toBeTruthy();
  });

  it("si el conteo de clientes falla, las zonas se ven igual y el conteo dice que no se pudo", async () => {
    stubList([NORTE]);
    cleanups.push(registerEndpoint("/api/v1/customers/zone-counts", failWith(500, "Base caída")));

    await renderPage();

    expect(await screen.findByText("Norte")).toBeTruthy();
    expect(await screen.findByText("No se pudo contar los clientes por zona.")).toBeTruthy();
    expect(within(rowOf("Norte")).getByText("—")).toBeTruthy();
  });

  it("crea una zona sin días: el POST omite deliveryDays, no lo manda vacío", async () => {
    stubList([]);
    const bodies = stubWrite(cleanups, "/api/v1/zones", "POST", () => ({
      ...NORTE,
      deliveryDays: [],
    }));
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Nueva zona" }));
    await user.type(screen.getByLabelText("Nombre"), "Norte");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(bodies).toEqual([{ name: "Norte" }]);
    expect(await screen.findByText("Norte")).toBeTruthy();
  });

  it("crea una zona con días elegidos: el POST manda deliveryDays con esos días", async () => {
    stubList([]);
    const bodies = stubWrite(cleanups, "/api/v1/zones", "POST", () => NORTE);
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Nueva zona" }));
    await user.type(screen.getByLabelText("Nombre"), "Norte");
    await user.click(screen.getByLabelText("Lunes"));
    await user.click(screen.getByLabelText("Miércoles"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(bodies).toEqual([{ name: "Norte", deliveryDays: ["MONDAY", "WEDNESDAY"] }]);
  });

  it("un nombre repetido muestra el mensaje del backend, no uno genérico", async () => {
    stubList([]);
    stubWrite(
      cleanups,
      "/api/v1/zones",
      "POST",
      failWith(400, 'Ya existe una zona con el nombre "Norte"'),
    );
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Nueva zona" }));
    await user.type(screen.getByLabelText("Nombre"), "Norte");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      'Ya existe una zona con el nombre "Norte"',
    );
  });

  it("editar una zona con PATCH cambia nombre y días, y refleja la fila", async () => {
    stubList([SUR]);
    const bodies = stubWrite(cleanups, `/api/v1/zones/${SUR.id}`, "PATCH", () => ({
      ...SUR,
      name: "Sur Grande",
      deliveryDays: ["FRIDAY"],
    }));
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const nameInput = screen.getByLabelText(`Nuevo nombre de ${SUR.name}`);
    await user.clear(nameInput);
    await user.type(nameInput, "Sur Grande");
    await user.click(screen.getByLabelText("Viernes"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(bodies).toEqual([{ name: "Sur Grande", deliveryDays: ["FRIDAY"] }]);
    expect(await screen.findByText("Sur Grande")).toBeTruthy();
    expect(screen.getByText("Viernes")).toBeTruthy();
  });

  it("retirar exige confirmación con la explicación antes de mandar active:false", async () => {
    stubList([NORTE]);
    const bodies = stubWrite(cleanups, `/api/v1/zones/${NORTE.id}`, "PATCH", () => ({
      ...NORTE,
      active: false,
    }));
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Retirar" }));

    const confirm = screen.getByRole("group", { name: `Confirmar retiro de ${NORTE.name}` });
    expect(confirm.textContent).toContain("¿Retirar «Norte»?");
    expect(bodies).toHaveLength(0);

    await user.click(within(confirm).getByRole("button", { name: "Sí, retirar" }));

    expect(bodies).toEqual([{ active: false }]);
    expect(await screen.findByText("Retirada")).toBeTruthy();
  });

  it("muestra el error del backend al retirar", async () => {
    stubList([NORTE]);
    stubWrite(
      cleanups,
      `/api/v1/zones/${NORTE.id}`,
      "PATCH",
      failWith(500, "Base de datos no disponible"),
    );
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Retirar" }));
    const confirm = screen.getByRole("group", { name: `Confirmar retiro de ${NORTE.name}` });
    await user.click(within(confirm).getByRole("button", { name: "Sí, retirar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
  });

  it("«No» cierra la confirmación de retiro sin llamar a la API", async () => {
    stubList([NORTE]);
    const bodies = stubWrite(cleanups, `/api/v1/zones/${NORTE.id}`, "PATCH");
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Retirar" }));
    await user.click(screen.getByRole("button", { name: "No" }));

    expect(screen.queryByRole("group", { name: /Confirmar retiro/ })).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it("reactivar es un solo clic, sin paso de confirmación", async () => {
    stubList([OLD]);
    const bodies = stubWrite(cleanups, `/api/v1/zones/${OLD.id}`, "PATCH", () => ({
      ...OLD,
      active: true,
    }));

    await renderPage();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Reactivar" }));

    expect(bodies).toEqual([{ active: true }]);
    expect(await screen.findByText("En uso")).toBeTruthy();
  });

  it("muestra un estado vacío cuando no hay zonas", async () => {
    stubList([]);

    await renderPage();

    expect(await screen.findByText("Todavía no hay zonas")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("muestra el error de carga y permite reintentar", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/zones", {
        method: "GET",
        handler: (event: H3Event) => {
          attempt++;
          if (attempt <= 2) return failWith(500, "Base de datos no disponible")(event);
          return [];
        },
      }),
    );

    await renderPage();

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");

    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Todavía no hay zonas")).toBeTruthy();
  });

  it("un vendedor ve la lista con sus días, pero no los controles de gestión", async () => {
    stubList([NORTE, OLD]);

    await renderPage(["SELLER"]);

    expect(await screen.findByText("Norte")).toBeTruthy();
    expect(screen.getByText("Lunes, Miércoles")).toBeTruthy();
    expect(screen.getByText("Retirada")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nueva zona" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retirar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reactivar" })).toBeNull();
  });
});
