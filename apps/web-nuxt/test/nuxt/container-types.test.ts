import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery } from "h3";
import type { H3Event } from "h3";
import type { ContainerType } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const BLUE: ContainerType = { id: "blue-id", name: "Bidón 20L (V)", active: true };
const RED: ContainerType = { id: "red-id", name: "Bidón 20L (R)", active: true };
const OLD: ContainerType = { id: "old-id", name: "Bidón antiguo", active: false };

/** La API separa el catálogo por `active`; la pantalla pide las dos mitades. */
function stubList(types: ContainerType[]) {
  cleanups.push(
    registerEndpoint("/api/v1/container-types", {
      method: "GET",
      handler: (event: H3Event) => {
        const active = getQuery(event).active !== "false";
        return types.filter((type) => type.active === active);
      },
    }),
  );
}

async function renderPage(roles: ("ADMIN" | "SELLER")[] = ["ADMIN"]) {
  cleanups.push(signIn(roles));
  await renderSuspended(App, { route: "/container-types" });
  await screen.findByRole("heading", { name: "Tipos de envase", level: 1 });
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

describe("Tipos de envase", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista los tipos de envase ordenados por nombre y resume cuántos están en uso", async () => {
    stubList([BLUE, RED]);

    await renderPage();

    expect(await screen.findByText("Bidón 20L (R)")).toBeTruthy();
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0]?.textContent);
    expect(names).toEqual(["Bidón 20L (R)", "Bidón 20L (V)"]);
    expect(screen.getByText("2 en uso")).toBeTruthy();
  });

  it("muestra los retirados marcados, sin esconderlos, con la opción de reactivar", async () => {
    stubList([BLUE, OLD]);

    await renderPage();

    const row = await waitForRow("Bidón antiguo");
    expect(within(row).getByText("Retirado")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Reactivar" })).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Retirar" })).toBeNull();
    expect(within(rowOf("Bidón 20L (V)")).getByText("En uso")).toBeTruthy();
    expect(screen.getByText("1 en uso, 1 retirado")).toBeTruthy();
  });

  it("nunca ofrece eliminar: la baja es lógica", async () => {
    stubList([BLUE]);

    await renderPage();
    await screen.findByText("Bidón 20L (V)");

    expect(screen.queryByRole("button", { name: /eliminar/i })).toBeNull();
  });

  it("crea un tipo de envase, lo agrega ordenado y cierra el formulario", async () => {
    stubList([BLUE]);
    const bodies = stubWrite(cleanups, "/api/v1/container-types", "POST", () => RED);
    const user = userEvent.setup();

    await renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Nuevo tipo de envase" }));
    await user.type(screen.getByLabelText("Nombre"), "  Bidón 20L (R)  ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Bidón 20L (R)")).toBeTruthy();
    expect(bodies).toEqual([{ name: "Bidón 20L (R)" }]);
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(screen.getByText("2 en uso")).toBeTruthy();
  });

  it("no envía un nombre vacío", async () => {
    stubList([BLUE]);
    const bodies = stubWrite(cleanups, "/api/v1/container-types", "POST");
    const user = userEvent.setup();

    await renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Nuevo tipo de envase" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Escribe el nombre del tipo de envase",
    );
    expect(bodies).toHaveLength(0);
  });

  it("con un nombre duplicado muestra el mensaje del backend, y el formulario sigue abierto", async () => {
    stubList([BLUE]);
    stubWrite(
      cleanups,
      "/api/v1/container-types",
      "POST",
      failWith(400, 'Ya existe un tipo de envase con el nombre "Bidón 20L (V)"'),
    );
    const user = userEvent.setup();

    await renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Nuevo tipo de envase" }));
    await user.type(screen.getByLabelText("Nombre"), "Bidón 20L (V)");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      'Ya existe un tipo de envase con el nombre "Bidón 20L (V)"',
    );
    expect(screen.getByLabelText("Nombre")).toBeTruthy();
  });

  it("renombra un tipo de envase con PATCH y muestra el nuevo nombre", async () => {
    stubList([BLUE]);
    const bodies = stubWrite(cleanups, `/api/v1/container-types/${BLUE.id}`, "PATCH", () => ({
      ...BLUE,
      name: "Bidón 20L verde",
    }));
    const user = userEvent.setup();

    await renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Renombrar" }));
    const input = screen.getByLabelText("Nuevo nombre de Bidón 20L (V)");
    await user.clear(input);
    await user.type(input, "Bidón 20L verde");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Bidón 20L verde")).toBeTruthy();
    expect(bodies).toEqual([{ name: "Bidón 20L verde" }]);
    expect(screen.queryByText("Bidón 20L (V)")).toBeNull();
  });

  it("retirar pide confirmación explicando qué significa, y recién entonces manda active=false", async () => {
    stubList([BLUE]);
    const bodies = stubWrite(cleanups, `/api/v1/container-types/${BLUE.id}`, "PATCH", () => ({
      ...BLUE,
      active: false,
    }));
    const user = userEvent.setup();

    await renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Retirar" }));

    const confirmation = screen.getByRole("group", { name: "Confirmar retiro de Bidón 20L (V)" });
    expect(confirmation.textContent).toContain(
      "Ya no se podrán entregar envases nuevos de este tipo",
    );
    expect(confirmation.textContent).toContain(
      "Los que ya están en poder de los clientes siguen contando",
    );
    expect(bodies).toHaveLength(0);

    await user.click(within(confirmation).getByRole("button", { name: "Sí, retirar" }));

    const row = await waitForRow("Bidón 20L (V)");
    expect(within(row).getByText("Retirado")).toBeTruthy();
    expect(bodies).toEqual([{ active: false }]);
    expect(within(row).getByRole("button", { name: "Reactivar" })).toBeTruthy();
  });

  it("«No» en la confirmación de retiro no toca la API", async () => {
    stubList([BLUE]);
    const bodies = stubWrite(cleanups, `/api/v1/container-types/${BLUE.id}`, "PATCH");
    const user = userEvent.setup();

    await renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Retirar" }));
    await user.click(screen.getByRole("button", { name: "No" }));

    expect(screen.queryByRole("group")).toBeNull();
    expect(bodies).toHaveLength(0);
    expect(within(rowOf("Bidón 20L (V)")).getByText("En uso")).toBeTruthy();
  });

  it("reactiva un tipo retirado con active=true", async () => {
    stubList([OLD]);
    const bodies = stubWrite(cleanups, `/api/v1/container-types/${OLD.id}`, "PATCH", () => ({
      ...OLD,
      active: true,
    }));
    const user = userEvent.setup();

    await renderPage();
    await screen.findByText("Bidón antiguo");

    await user.click(screen.getByRole("button", { name: "Reactivar" }));

    const row = await waitForRow("Bidón antiguo");
    expect(within(row).getByText("En uso")).toBeTruthy();
    expect(bodies).toEqual([{ active: true }]);
    expect(within(row).getByRole("button", { name: "Retirar" })).toBeTruthy();
  });

  it("el error de una acción se muestra dentro de la tabla, junto a su fila", async () => {
    stubList([BLUE, RED]);
    stubWrite(
      cleanups,
      `/api/v1/container-types/${BLUE.id}`,
      "PATCH",
      failWith(500, "Base de datos no disponible"),
    );
    const user = userEvent.setup();

    await renderPage();
    const row = await waitForRow("Bidón 20L (V)");

    await user.click(within(row).getByRole("button", { name: "Retirar" }));
    await user.click(screen.getByRole("button", { name: "Sí, retirar" }));

    const alert = await screen.findByRole("alert");
    expect(within(screen.getByRole("table")).getByRole("alert")).toBe(alert);
    expect(rowOf("Bidón 20L (V)").nextElementSibling?.contains(alert)).toBe(true);
    expect(within(rowOf("Bidón 20L (V)")).getByText("En uso")).toBeTruthy();
  });

  it("muestra el error de carga y permite reintentar", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/container-types", {
        method: "GET",
        handler: (event: H3Event) => {
          attempt++;
          if (attempt <= 2) return failWith(500, "Base de datos no disponible")(event);
          return getQuery(event).active !== "false" ? [BLUE] : [];
        },
      }),
    );

    await renderPage();

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");

    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Bidón 20L (V)")).toBeTruthy();
  });

  it("muestra un estado vacío cuando no hay tipos de envase", async () => {
    stubList([]);

    await renderPage();

    expect(await screen.findByText("Todavía no hay tipos de envase")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("un vendedor ve la lista pero no los controles de gestión", async () => {
    stubList([BLUE, OLD]);

    await renderPage(["SELLER"]);

    expect(await screen.findByText("Bidón 20L (V)")).toBeTruthy();
    expect(screen.getByText("Retirado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nuevo tipo de envase" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Renombrar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reactivar" })).toBeNull();
  });
});

async function waitForRow(name: string): Promise<HTMLElement> {
  await screen.findByText(name);
  return rowOf(name);
}
