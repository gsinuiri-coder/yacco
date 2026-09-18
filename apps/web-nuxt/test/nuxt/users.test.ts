import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery } from "h3";
import type { H3Event } from "h3";
import type { User } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { pageOf } from "../support/fixtures";
import { failWith, stubWrite } from "../support/route-detail";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
/** El mismo sub que pone `buildToken` en test/support/session.ts. */
const SELF_ID = "11111111-1111-4111-8111-111111111111";
const DRIVER_ID = "dr-1";

const SELF: User = {
  id: SELF_ID,
  name: "Administrador",
  username: "admin",
  active: true,
  roles: ["ADMIN"],
};
const DRIVER: User = {
  id: DRIVER_ID,
  name: "Luis Quispe",
  username: "luis",
  active: true,
  roles: ["DRIVER"],
};
const RETIRED: User = {
  id: "ret-1",
  name: "Ana Retirada",
  username: "ana",
  active: false,
  roles: ["SELLER", "DRIVER"],
};

function stubList(users: User[]) {
  const seen: string[] = [];
  cleanups.push(
    registerEndpoint("/api/v1/users", {
      method: "GET",
      handler: (event: H3Event) => {
        const query = getQuery(event);
        seen.push(JSON.stringify(query));
        const active = query.active !== "false";
        const role = query.role as string | undefined;
        return users.filter(
          (candidate) =>
            candidate.active === active &&
            (role === undefined || candidate.roles.includes(role as never)),
        );
      },
    }),
  );
  return seen;
}

function stubRoutesByStatus(totals: Partial<Record<string, number>>) {
  const seen: string[] = [];
  cleanups.push(
    registerEndpoint("/api/v1/routes", {
      method: "GET",
      handler: (event: H3Event) => {
        const query = getQuery(event);
        const status = String(query.status ?? "");
        seen.push(`${query.driverId ?? ""}:${status}`);
        return pageOf([], { total: totals[status] ?? 0, limit: 1 });
      },
    }),
  );
  return seen;
}

async function renderPage(roles: ("ADMIN" | "SELLER")[] = ["ADMIN"]) {
  cleanups.push(signIn(roles, "admin"));
  await renderSuspended(App, { route: "/users" });
  await screen.findByRole("heading", { name: "Usuarios", level: 1 });
}

async function rowOf(text: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table");
  return within(table).getByText(text).closest("tr") as HTMLElement;
}

async function openReset(rowText: string, name = rowText): Promise<HTMLElement> {
  const row = await rowOf(rowText);
  await userEvent.setup().click(within(row).getByRole("button", { name: "Cambiar contraseña" }));
  return screen.getByRole("form", { name: `Cambiar la contraseña de ${name}` });
}

function saveNewPassword(): HTMLElement {
  return screen.getByRole("button", { name: "Guardar contraseña nueva" });
}

async function openRoles(rowText: string, name = rowText): Promise<HTMLElement> {
  const row = await rowOf(rowText);
  await userEvent.setup().click(within(row).getByRole("button", { name: "Roles" }));
  return screen.getByRole("form", { name: `Corregir los roles de ${name}` });
}

describe("Usuarios", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista los usuarios en uso con sus roles en el vocabulario de la planta", async () => {
    stubList([SELF, DRIVER, RETIRED]);

    await renderPage();

    const row = await rowOf("Luis Quispe");
    expect(within(row).getByText("luis")).toBeTruthy();
    expect(within(row).getByText("Chofer")).toBeTruthy();
    expect(within(row).getByText("En uso")).toBeTruthy();
    expect(screen.queryByText("Ana Retirada")).toBeNull();
  });

  it("varios roles se muestran juntos, en orden fijo", async () => {
    stubList([RETIRED]);

    await renderPage();
    await userEvent.setup().click(await screen.findByLabelText("Estado"));
    await userEvent.setup().click(await screen.findByRole("option", { name: "Desactivados" }));

    const row = await rowOf("Ana Retirada");
    expect(within(row).getByText("Vendedor, Chofer")).toBeTruthy();
    expect(within(row).getByText("Desactivado")).toBeTruthy();
  });

  it("filtrar por rol manda role en la consulta", async () => {
    const seen = stubList([SELF, DRIVER]);

    await renderPage();
    await screen.findByText("Luis Quispe");
    await userEvent.setup().click(screen.getByLabelText("Rol"));
    await userEvent.setup().click(await screen.findByRole("option", { name: "Chofer" }));

    await waitFor(() => expect(JSON.parse(seen.at(-1)!).role).toBe("DRIVER"));
  });

  it("filtrar por desactivados manda active=false", async () => {
    const seen = stubList([SELF, RETIRED]);

    await renderPage();
    // Por el usuario y no por el nombre: "Administrador" es también el rol de SELF.
    await screen.findByText("admin");
    await userEvent.setup().click(screen.getByLabelText("Estado"));
    await userEvent.setup().click(await screen.findByRole("option", { name: "Desactivados" }));

    await waitFor(() => expect(JSON.parse(seen.at(-1)!).active).toBe("false"));
    expect(await screen.findByText("Ana Retirada")).toBeTruthy();
  });

  it("da de alta un usuario con sus roles", async () => {
    stubList([SELF]);
    const bodies = stubWrite(cleanups, "/api/v1/users", "POST", () => DRIVER);
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
    await user.type(screen.getByLabelText("Nombre"), "Luis Quispe");
    await user.type(screen.getByLabelText("Usuario"), "luis");
    await user.type(screen.getByLabelText("Contraseña"), "clave-de-prueba");
    await user.click(screen.getByLabelText("Chofer"));
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() =>
      expect(bodies).toEqual([
        { name: "Luis Quispe", username: "luis", password: "clave-de-prueba", roles: ["DRIVER"] },
      ]),
    );
  });

  it("una contraseña corta no se envía y lo dice", async () => {
    stubList([SELF]);
    const bodies = stubWrite(cleanups, "/api/v1/users", "POST", () => DRIVER);
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
    await user.type(screen.getByLabelText("Nombre"), "Luis Quispe");
    await user.type(screen.getByLabelText("Usuario"), "luis");
    await user.type(screen.getByLabelText("Contraseña"), "corta");
    await user.click(screen.getByLabelText("Chofer"));
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "La contraseña debe tener al menos 8 caracteres",
    );
    expect(bodies).toHaveLength(0);
  });

  it("sin rol elegido tampoco se envía", async () => {
    stubList([SELF]);
    const bodies = stubWrite(cleanups, "/api/v1/users", "POST", () => DRIVER);
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
    await user.type(screen.getByLabelText("Nombre"), "Luis Quispe");
    await user.type(screen.getByLabelText("Usuario"), "luis");
    await user.type(screen.getByLabelText("Contraseña"), "clave-de-prueba");
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Elige al menos un rol");
    expect(bodies).toHaveLength(0);
  });

  it("muestra tal cual el error del backend cuando el usuario ya existe", async () => {
    stubList([SELF]);
    stubWrite(
      cleanups,
      "/api/v1/users",
      "POST",
      failWith(409, 'Ya existe un usuario con el nombre de usuario "luis"'),
    );
    const user = userEvent.setup();

    await renderPage();
    await user.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
    await user.type(screen.getByLabelText("Nombre"), "Luis Quispe");
    await user.type(screen.getByLabelText("Usuario"), "luis");
    await user.type(screen.getByLabelText("Contraseña"), "clave-de-prueba");
    await user.click(screen.getByLabelText("Chofer"));
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      'Ya existe un usuario con el nombre de usuario "luis"',
    );
  });

  it("renombrar manda solo el nombre y refleja la fila", async () => {
    stubList([SELF, DRIVER]);
    const bodies = stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => ({
      ...DRIVER,
      name: "Luis A. Quispe",
    }));
    const user = userEvent.setup();

    await renderPage();
    const row = await rowOf("Luis Quispe");
    await user.click(within(row).getByRole("button", { name: "Editar" }));
    const input = screen.getByLabelText("Nuevo nombre de Luis Quispe");
    await user.clear(input);
    await user.type(input, "Luis A. Quispe");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(bodies).toEqual([{ name: "Luis A. Quispe" }]));
    expect(await screen.findByText("Luis A. Quispe")).toBeTruthy();
  });

  it("un nombre vacío no llega a la API", async () => {
    stubList([SELF, DRIVER]);
    const bodies = stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => DRIVER);
    const user = userEvent.setup();

    await renderPage();
    const row = await rowOf("Luis Quispe");
    await user.click(within(row).getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByLabelText("Nuevo nombre de Luis Quispe"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Escribe el nombre de la persona",
    );
    expect(bodies).toHaveLength(0);
  });

  it("desactivar exige confirmación con la consecuencia escrita", async () => {
    stubList([SELF, DRIVER]);
    const bodies = stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => ({
      ...DRIVER,
      active: false,
    }));
    const user = userEvent.setup();

    await renderPage();
    const row = await rowOf("Luis Quispe");
    await user.click(within(row).getByRole("button", { name: "Desactivar" }));

    const confirm = screen.getByRole("group", { name: "Confirmar desactivar a Luis Quispe" });
    expect(confirm.textContent).toContain("¿Desactivar? No podrá entrar.");
    expect(bodies).toHaveLength(0);

    await user.click(within(confirm).getByRole("button", { name: "Sí, desactivar" }));

    await waitFor(() => expect(bodies).toEqual([{ active: false }]));
  });

  it("reactivar es un solo clic, sin confirmación", async () => {
    stubList([RETIRED]);
    const bodies = stubWrite(cleanups, `/api/v1/users/${RETIRED.id}`, "PATCH", () => ({
      ...RETIRED,
      active: true,
    }));

    await renderPage();
    await userEvent.setup().click(await screen.findByLabelText("Estado"));
    await userEvent.setup().click(await screen.findByRole("option", { name: "Desactivados" }));
    const row = await rowOf("Ana Retirada");
    await userEvent.setup().click(within(row).getByRole("button", { name: "Reactivar" }));

    await waitFor(() => expect(bodies).toEqual([{ active: true }]));
  });

  it("no ofrece desactivar el propio usuario", async () => {
    stubList([SELF, DRIVER]);

    await renderPage();

    const own = await rowOf("admin");
    expect(within(own).queryByRole("button", { name: "Desactivar" })).toBeNull();
    expect(within(own).getByText("Tu propio usuario")).toBeTruthy();

    const other = await rowOf("Luis Quispe");
    expect(within(other).getByRole("button", { name: "Desactivar" })).toBeTruthy();
  });

  it("muestra el error del backend al desactivar", async () => {
    stubList([SELF, DRIVER]);
    stubWrite(
      cleanups,
      `/api/v1/users/${DRIVER_ID}`,
      "PATCH",
      failWith(500, "Base de datos no disponible"),
    );
    const user = userEvent.setup();

    await renderPage();
    const row = await rowOf("Luis Quispe");
    await user.click(within(row).getByRole("button", { name: "Desactivar" }));
    await user.click(screen.getByRole("button", { name: "Sí, desactivar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
  });

  it("cambiar la contraseña manda solo password", async () => {
    stubList([SELF, DRIVER]);
    const bodies = stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => DRIVER);

    await renderPage();
    await openReset("Luis Quispe");
    await userEvent.setup().type(screen.getByLabelText("Contraseña nueva"), "clave-nueva-de-luis");
    await userEvent.setup().click(saveNewPassword());

    await waitFor(() => expect(bodies).toEqual([{ password: "clave-nueva-de-luis" }]));
    expect(await screen.findByText(/Contraseña cambiada\. Díctasela a Luis Quispe/)).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Cambiar la contraseña de Luis Quispe" })).toBeNull();
  });

  it("el bloque dice que cambiarla no cierra la sesión abierta y qué hacer para eso", async () => {
    stubList([SELF, DRIVER]);

    await renderPage();
    const form = await openReset("Luis Quispe");

    expect(form.textContent).toContain(
      "Cambiar la contraseña no cierra la sesión abierta de esa persona",
    );
    expect(form.textContent).toContain("Para que alguien deje de entrar, desactívalo");
  });

  it("una contraseña nueva de menos de 8 caracteres no se envía y lo dice", async () => {
    stubList([SELF, DRIVER]);
    const bodies = stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => DRIVER);

    await renderPage();
    await openReset("Luis Quispe");
    await userEvent.setup().type(screen.getByLabelText("Contraseña nueva"), "corta");
    await userEvent.setup().click(saveNewPassword());

    expect((await screen.findByRole("alert")).textContent).toContain(
      "La contraseña debe tener al menos 8 caracteres",
    );
    expect(bodies).toHaveLength(0);
  });

  it("muestra el error del backend al cambiar la contraseña", async () => {
    stubList([SELF, DRIVER]);
    stubWrite(
      cleanups,
      `/api/v1/users/${DRIVER_ID}`,
      "PATCH",
      failWith(500, "Base de datos no disponible"),
    );

    await renderPage();
    await openReset("Luis Quispe");
    await userEvent.setup().type(screen.getByLabelText("Contraseña nueva"), "clave-nueva-de-luis");
    await userEvent.setup().click(saveNewPassword());

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
  });

  it("el administrador puede cambiarse la contraseña a sí mismo", async () => {
    stubList([SELF, DRIVER]);
    const bodies = stubWrite(cleanups, `/api/v1/users/${SELF_ID}`, "PATCH", () => SELF);

    await renderPage();
    await openReset("admin", "Administrador");
    await userEvent.setup().type(screen.getByLabelText("Contraseña nueva"), "clave-rotada");
    await userEvent.setup().click(saveNewPassword());

    await waitFor(() => expect(bodies).toEqual([{ password: "clave-rotada" }]));
  });

  it("cambiar de persona vacía la contraseña tipeada para la anterior", async () => {
    stubList([SELF, DRIVER]);

    await renderPage();
    await openReset("Luis Quispe");
    await userEvent.setup().type(screen.getByLabelText("Contraseña nueva"), "clave-de-luis");
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancelar" }));

    await openReset("admin", "Administrador");
    expect((screen.getByLabelText("Contraseña nueva") as HTMLInputElement).value).toBe("");
  });

  it("abrir otra operación cierra el bloque de cambiar contraseña", async () => {
    stubList([SELF, DRIVER]);

    await renderPage();
    await openReset("Luis Quispe");
    await userEvent.setup().click(screen.getByRole("button", { name: "Nuevo usuario" }));
    expect(screen.queryByRole("form", { name: "Cambiar la contraseña de Luis Quispe" })).toBeNull();

    await openReset("Luis Quispe");
    const row = await rowOf("Luis Quispe");
    await userEvent.setup().click(within(row).getByRole("button", { name: "Editar" }));
    expect(screen.queryByRole("form", { name: "Cambiar la contraseña de Luis Quispe" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Cancelar" })).toHaveLength(1);
  });

  it("el aviso de contraseña cambiada no sobrevive a un cambio de filtro", async () => {
    stubList([SELF, DRIVER, RETIRED]);
    stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => DRIVER);

    await renderPage();
    await openReset("Luis Quispe");
    await userEvent.setup().type(screen.getByLabelText("Contraseña nueva"), "clave-nueva-de-luis");
    await userEvent.setup().click(saveNewPassword());
    await screen.findByText(/Contraseña cambiada\. Díctasela a Luis Quispe/);

    await userEvent.setup().click(screen.getByLabelText("Estado"));
    await userEvent.setup().click(await screen.findByRole("option", { name: "Desactivados" }));

    await screen.findByText("Ana Retirada");
    expect(screen.queryByText(/Contraseña cambiada/)).toBeNull();
  });

  it("corregir roles manda la lista completa y refleja la fila", async () => {
    stubList([SELF, DRIVER]);
    const bodies = stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => ({
      ...DRIVER,
      roles: ["SELLER", "DRIVER"],
    }));

    await renderPage();
    const form = await openRoles("Luis Quispe");
    await userEvent.setup().click(within(form).getByRole("checkbox", { name: /Vendedor/ }));
    await userEvent.setup().click(within(form).getByRole("button", { name: "Guardar roles" }));

    await waitFor(() => expect(bodies).toEqual([{ roles: ["DRIVER", "SELLER"] }]));
    const row = await rowOf("Luis Quispe");
    expect(within(row).getByText("Vendedor, Chofer")).toBeTruthy();
  });

  it("cada rol dice qué habilita, incluido que vendedor ve todas las rutas", async () => {
    stubList([SELF, DRIVER]);

    await renderPage();
    const form = await openRoles("Luis Quispe");

    expect(form.textContent).toContain("Ve y opera las rutas de todos los choferes");
    expect(form.textContent).toContain("Ve y opera solo las rutas que tiene a su nombre");
  });

  it("quitar Chofer cuenta sus rutas sin cerrar y pide confirmación con el número", async () => {
    stubList([SELF, DRIVER]);
    const routes = stubRoutesByStatus({ PLANNED: 2, IN_PROGRESS: 1 });
    const bodies = stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => ({
      ...DRIVER,
      roles: ["SELLER"],
    }));

    await renderPage();
    const form = await openRoles("Luis Quispe");
    await userEvent.setup().click(within(form).getByRole("checkbox", { name: /Vendedor/ }));
    await userEvent.setup().click(within(form).getByRole("checkbox", { name: /Chofer/ }));
    await userEvent.setup().click(within(form).getByRole("button", { name: "Guardar roles" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Luis Quispe tiene 3 rutas sin cerrar",
    );
    expect(routes).toEqual([`${DRIVER_ID}:PLANNED`, `${DRIVER_ID}:IN_PROGRESS`]);
    expect(bodies).toHaveLength(0);

    await userEvent
      .setup()
      .click(within(form).getByRole("button", { name: "Sí, guardar los roles" }));

    await waitFor(() => expect(bodies).toEqual([{ roles: ["SELLER"] }]));
  });

  it("si no se pueden consultar las rutas, se confirma igual diciendo que no se pudo", async () => {
    stubList([SELF, DRIVER]);
    cleanups.push(registerEndpoint("/api/v1/routes", failWith(500, "Base de datos no disponible")));
    const bodies = stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => ({
      ...DRIVER,
      roles: ["SELLER"],
    }));

    await renderPage();
    const form = await openRoles("Luis Quispe");
    await userEvent.setup().click(within(form).getByRole("checkbox", { name: /Vendedor/ }));
    await userEvent.setup().click(within(form).getByRole("checkbox", { name: /Chofer/ }));
    await userEvent.setup().click(within(form).getByRole("button", { name: "Guardar roles" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No se pudo consultar las rutas de Luis Quispe",
    );
    expect(bodies).toHaveLength(0);

    await userEvent
      .setup()
      .click(within(form).getByRole("button", { name: "Sí, guardar los roles" }));

    await waitFor(() => expect(bodies).toEqual([{ roles: ["SELLER"] }]));
  });

  it("agregar un rol no consulta rutas ni pide confirmación", async () => {
    stubList([SELF, DRIVER]);
    const routes = stubRoutesByStatus({});
    const bodies = stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => ({
      ...DRIVER,
      roles: ["SELLER", "DRIVER"],
    }));

    await renderPage();
    const form = await openRoles("Luis Quispe");
    await userEvent.setup().click(within(form).getByRole("checkbox", { name: /Vendedor/ }));
    await userEvent.setup().click(within(form).getByRole("button", { name: "Guardar roles" }));

    await waitFor(() => expect(bodies).toEqual([{ roles: ["DRIVER", "SELLER"] }]));
    expect(routes).toEqual([]);
  });

  it("sin ningún rol marcado no se envía", async () => {
    stubList([SELF, DRIVER]);
    const bodies = stubWrite(cleanups, `/api/v1/users/${DRIVER_ID}`, "PATCH", () => DRIVER);

    await renderPage();
    const form = await openRoles("Luis Quispe");
    await userEvent.setup().click(within(form).getByRole("checkbox", { name: /Chofer/ }));
    await userEvent.setup().click(within(form).getByRole("button", { name: "Guardar roles" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Elige al menos un rol");
    expect(bodies).toHaveLength(0);
  });

  it("no deja al administrador quitarse a sí mismo la administración", async () => {
    stubList([SELF, DRIVER]);

    await renderPage();
    const own = await openRoles("admin", "Administrador");

    const adminBox = within(own).getByRole("checkbox", { name: /Administrador/ });
    expect(adminBox.getAttribute("aria-checked")).toBe("true");
    expect((adminBox as HTMLButtonElement).disabled).toBe(true);
    expect(own.textContent).toContain("No puedes quitarte a ti mismo la administración");

    await userEvent.setup().click(within(own).getByRole("button", { name: "Cancelar" }));
    const other = await openRoles("Luis Quispe");
    expect(
      (within(other).getByRole("checkbox", { name: /Administrador/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("abrir roles cierra los otros tres modos, y cualquiera de ellos cierra roles", async () => {
    stubList([SELF, DRIVER]);

    await renderPage();

    await openReset("Luis Quispe");
    await openRoles("Luis Quispe");
    expect(screen.queryByRole("form", { name: "Cambiar la contraseña de Luis Quispe" })).toBeNull();

    await userEvent.setup().click(screen.getByRole("button", { name: "Nuevo usuario" }));
    expect(screen.queryByRole("form", { name: "Corregir los roles de Luis Quispe" })).toBeNull();

    await openRoles("Luis Quispe");
    const row = await rowOf("Luis Quispe");
    await userEvent.setup().click(within(row).getByRole("button", { name: "Editar" }));
    expect(screen.queryByRole("form", { name: "Corregir los roles de Luis Quispe" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Cancelar" })).toHaveLength(1);
  });

  it("muestra el error del backend al corregir roles", async () => {
    stubList([SELF, DRIVER]);
    stubWrite(
      cleanups,
      `/api/v1/users/${DRIVER_ID}`,
      "PATCH",
      failWith(400, "No puedes quitarte a ti mismo la administración"),
    );

    await renderPage();
    const form = await openRoles("Luis Quispe");
    await userEvent.setup().click(within(form).getByRole("checkbox", { name: /Vendedor/ }));
    await userEvent.setup().click(within(form).getByRole("button", { name: "Guardar roles" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No puedes quitarte a ti mismo la administración",
    );
  });

  it("sin usuarios con ese filtro lo dice", async () => {
    stubList([]);

    await renderPage();

    expect(await screen.findByText("No hay usuarios con ese rol")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("muestra el error de carga y permite reintentar", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/users", {
        method: "GET",
        handler: (event: H3Event) => {
          attempt++;
          if (attempt === 1) return failWith(500, "Base de datos no disponible")(event);
          return [DRIVER];
        },
      }),
    );

    await renderPage();

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");

    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Luis Quispe")).toBeTruthy();
  });

  it("un vendedor ve la lista pero ningún control de gestión", async () => {
    stubList([SELF, DRIVER]);

    await renderPage(["SELLER"]);

    expect(await screen.findByText("Luis Quispe")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nuevo usuario" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cambiar contraseña" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desactivar" })).toBeNull();
  });
});
