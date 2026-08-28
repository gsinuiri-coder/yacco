import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { User } from "../api/users";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { UsersPage } from "./users-page";

/** El mismo `sub` que pone `buildToken` en test/tokens.ts. */
const SELF_ID = "11111111-1111-4111-8111-111111111111";
const DRIVER_ID = "22222222-2222-4222-8222-222222222222";

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
  id: "33333333-3333-4333-8333-333333333333",
  name: "Ana Retirada",
  username: "ana",
  active: false,
  roles: ["SELLER", "DRIVER"],
};

/** El endpoint separa el catálogo por `active`, igual que zonas. */
function stubList(users: User[]): { url: string } {
  const captured = { url: "" };
  server.use(
    http.get(`${API_BASE_URL}/users`, ({ request }) => {
      captured.url = request.url;
      const params = new URL(request.url).searchParams;
      const active = params.get("active") !== "false";
      const role = params.get("role");
      return HttpResponse.json(
        users.filter(
          (candidate) =>
            candidate.active === active &&
            (role === null || candidate.roles.includes(role as never)),
        ),
      );
    }),
  );
  return captured;
}

function stubCreate(status: number, payload: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post(`${API_BASE_URL}/users`, async ({ request }) => {
      captured.body = await request.json();
      return HttpResponse.json(payload, { status });
    }),
  );
  return captured;
}

function stubUpdate(id: string, status: number, payload: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.patch(`${API_BASE_URL}/users/${id}`, async ({ request }) => {
      captured.body = await request.json();
      return HttpResponse.json(payload, { status });
    }),
  );
  return captured;
}

/**
 * Busca DENTRO de la tabla: "Administrador" es también la etiqueta de un rol
 * en el filtro y en las casillas del alta, así que un `getByText` suelto
 * engancha el `<option>` antes que la fila.
 */
async function rowOf(text: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table");
  const row = within(table).getByText(text).closest("tr");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function renderPage() {
  return renderWithProviders(<UsersPage />, "/users");
}

/**
 * Abre el bloque de cambiar contraseña desde la fila y devuelve el formulario.
 *
 * `rowText` es lo que identifica la fila; `name` es el nombre de la persona,
 * que es lo que el bloque pone en su título.
 */
async function openReset(
  user: ReturnType<typeof userEvent.setup>,
  rowText: string,
  name = rowText,
): Promise<HTMLElement> {
  const row = await rowOf(rowText);
  await user.click(within(row).getByRole("button", { name: "Cambiar contraseña" }));
  return screen.getByRole("form", { name: `Cambiar la contraseña de ${name}` });
}

/** El botón de enviar del bloque, que a propósito no se llama como el de la fila. */
function saveNewPassword(): HTMLElement {
  return screen.getByRole("button", { name: "Guardar contraseña nueva" });
}

describe("UsersPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
  });

  it("lista los usuarios en uso con sus roles en el vocabulario de la planta", async () => {
    stubList([SELF, DRIVER, RETIRED]);

    renderPage();

    const row = await rowOf("Luis Quispe");
    expect(within(row).getByText("luis")).toBeInTheDocument();
    expect(within(row).getByText("Chofer")).toBeInTheDocument();
    expect(within(row).getByText("En uso")).toBeInTheDocument();
    // "Ana Retirada" está desactivada: no entra en la lista por defecto.
    expect(screen.queryByText("Ana Retirada")).not.toBeInTheDocument();
  });

  it("varios roles se muestran juntos, en orden fijo", async () => {
    stubList([RETIRED]);
    const user = userEvent.setup();

    renderPage();
    await user.selectOptions(await screen.findByLabelText("Estado"), "inactive");

    const row = await rowOf("Ana Retirada");
    expect(within(row).getByText("Vendedor, Chofer")).toBeInTheDocument();
    expect(within(row).getByText("Desactivado")).toBeInTheDocument();
  });

  it("filtrar por rol manda role en la consulta", async () => {
    const captured = stubList([SELF, DRIVER]);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Luis Quispe");
    await user.selectOptions(screen.getByLabelText("Rol"), "DRIVER");

    await waitFor(() => expect(new URL(captured.url).searchParams.get("role")).toBe("DRIVER"));
    expect(await screen.findByText("Luis Quispe")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(screen.getByRole("table")).queryByText("admin")).not.toBeInTheDocument(),
    );
  });

  it("filtrar por desactivados manda active=false", async () => {
    const captured = stubList([SELF, RETIRED]);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Administrador");
    await user.selectOptions(screen.getByLabelText("Estado"), "inactive");

    await waitFor(() => expect(new URL(captured.url).searchParams.get("active")).toBe("false"));
    expect(await screen.findByText("Ana Retirada")).toBeInTheDocument();
  });

  it("da de alta un usuario con sus roles", async () => {
    const user = userEvent.setup();
    stubList([SELF]);
    const captured = stubCreate(201, { ...DRIVER });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
    await user.type(screen.getByLabelText("Nombre"), "Luis Quispe");
    await user.type(screen.getByLabelText("Usuario"), "luis");
    await user.type(screen.getByLabelText("Contraseña"), "clave-de-prueba");
    await user.click(screen.getByLabelText("Chofer"));
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() =>
      expect(captured.body).toEqual({
        name: "Luis Quispe",
        username: "luis",
        password: "clave-de-prueba",
        roles: ["DRIVER"],
      }),
    );
  });

  // Espeja `@MinLength(8)` de CreateUserDto: el formulario lo dice antes de
  // gastar una llamada.
  it("una contraseña corta no se envía y lo dice", async () => {
    const user = userEvent.setup();
    stubList([SELF]);
    const captured = stubCreate(201, { ...DRIVER });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
    await user.type(screen.getByLabelText("Nombre"), "Luis Quispe");
    await user.type(screen.getByLabelText("Usuario"), "luis");
    await user.type(screen.getByLabelText("Contraseña"), "corta");
    await user.click(screen.getByLabelText("Chofer"));
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La contraseña debe tener al menos 8 caracteres",
    );
    expect(captured.body).toBeUndefined();
  });

  it("sin rol elegido tampoco se envía", async () => {
    const user = userEvent.setup();
    stubList([SELF]);
    const captured = stubCreate(201, { ...DRIVER });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
    await user.type(screen.getByLabelText("Nombre"), "Luis Quispe");
    await user.type(screen.getByLabelText("Usuario"), "luis");
    await user.type(screen.getByLabelText("Contraseña"), "clave-de-prueba");
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Elige al menos un rol");
    expect(captured.body).toBeUndefined();
  });

  it("muestra tal cual el error del backend cuando el usuario ya existe", async () => {
    const user = userEvent.setup();
    stubList([SELF]);
    stubCreate(409, { message: 'Ya existe un usuario con el nombre de usuario "luis"' });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Nuevo usuario" }));
    await user.type(screen.getByLabelText("Nombre"), "Luis Quispe");
    await user.type(screen.getByLabelText("Usuario"), "luis");
    await user.type(screen.getByLabelText("Contraseña"), "clave-de-prueba");
    await user.click(screen.getByLabelText("Chofer"));
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Ya existe un usuario con el nombre de usuario "luis"',
    );
  });

  it("renombrar manda solo el nombre y refleja la fila", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);
    const captured = stubUpdate(DRIVER_ID, 200, { ...DRIVER, name: "Luis A. Quispe" });

    renderPage();
    const row = await rowOf("Luis Quispe");
    await user.click(within(row).getByRole("button", { name: "Editar" }));
    const input = screen.getByLabelText("Nuevo nombre de Luis Quispe");
    await user.clear(input);
    await user.type(input, "Luis A. Quispe");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(captured.body).toEqual({ name: "Luis A. Quispe" }));
    expect(await screen.findByText("Luis A. Quispe")).toBeInTheDocument();
  });

  it("un nombre vacío no llega a la API", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);
    const captured = stubUpdate(DRIVER_ID, 200, DRIVER);

    renderPage();
    const row = await rowOf("Luis Quispe");
    await user.click(within(row).getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByLabelText("Nuevo nombre de Luis Quispe"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe el nombre de la persona");
    expect(captured.body).toBeUndefined();
  });

  it("desactivar exige confirmación con la consecuencia escrita", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);
    const captured = stubUpdate(DRIVER_ID, 200, { ...DRIVER, active: false });

    renderPage();
    const row = await rowOf("Luis Quispe");
    await user.click(within(row).getByRole("button", { name: "Desactivar" }));

    // El nombre vive en el aria-label, no en el texto: en la columna de
    // acciones desbordaba y empujaba los botones fuera de la vista.
    const confirm = screen.getByRole("group", { name: "Confirmar desactivar a Luis Quispe" });
    expect(confirm).toHaveTextContent("¿Desactivar? No podrá entrar.");
    expect(captured.body).toBeUndefined();

    await user.click(within(confirm).getByRole("button", { name: "Sí, desactivar" }));

    await waitFor(() => expect(captured.body).toEqual({ active: false }));
  });

  it("reactivar es un solo clic, sin confirmación", async () => {
    const user = userEvent.setup();
    stubList([RETIRED]);
    const captured = stubUpdate(RETIRED.id, 200, { ...RETIRED, active: true });

    renderPage();
    await user.selectOptions(await screen.findByLabelText("Estado"), "inactive");
    const row = await rowOf("Ana Retirada");
    await user.click(within(row).getByRole("button", { name: "Reactivar" }));

    await waitFor(() => expect(captured.body).toEqual({ active: true }));
  });

  // Desactivarse a uno mismo es cerrarse la puerta desde adentro.
  it("no ofrece desactivar el propio usuario", async () => {
    stubList([SELF, DRIVER]);

    renderPage();

    // Por el usuario y no por el nombre: el admin se llama "Administrador" y
    // ese texto también es su rol, así que aparece dos veces en su fila.
    const own = await rowOf("admin");
    expect(within(own).queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
    expect(within(own).getByText("Tu propio usuario")).toBeInTheDocument();

    const other = await rowOf("Luis Quispe");
    expect(within(other).getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
  });

  it("muestra el error del backend al desactivar", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);
    stubUpdate(DRIVER_ID, 500, { message: "Base de datos no disponible" });

    renderPage();
    const row = await rowOf("Luis Quispe");
    await user.click(within(row).getByRole("button", { name: "Desactivar" }));
    await user.click(screen.getByRole("button", { name: "Sí, desactivar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");
  });

  it("cambiar la contraseña manda solo password", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);
    const captured = stubUpdate(DRIVER_ID, 200, DRIVER);

    renderPage();
    await openReset(user, "Luis Quispe");
    await user.type(screen.getByLabelText("Contraseña nueva"), "clave-nueva-de-luis");
    await user.click(saveNewPassword());

    await waitFor(() => expect(captured.body).toEqual({ password: "clave-nueva-de-luis" }));
    expect(
      await screen.findByText(/Contraseña cambiada\. Díctasela a Luis Quispe/),
    ).toBeInTheDocument();
    // El bloque se cierra: dejarlo abierto invita a repetir la reposición.
    expect(
      screen.queryByRole("form", { name: "Cambiar la contraseña de Luis Quispe" }),
    ).not.toBeInTheDocument();
  });

  // El bloque tiene que decir las dos cosas que la gente confunde: cambiarla no
  // cierra la sesión abierta, y lo que sí la corta es desactivar.
  it("el bloque dice que cambiarla no cierra la sesión abierta y qué hacer para eso", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);

    renderPage();
    const form = await openReset(user, "Luis Quispe");

    expect(form).toHaveTextContent(
      "Cambiar la contraseña no cierra la sesión abierta de esa persona",
    );
    expect(form).toHaveTextContent("Para que alguien deje de entrar, desactívalo");
  });

  // Mismo `@MinLength(8)` que el alta, y el mismo criterio: se dice antes de
  // gastar una llamada.
  it("una contraseña nueva de menos de 8 caracteres no se envía y lo dice", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);
    const captured = stubUpdate(DRIVER_ID, 200, DRIVER);

    renderPage();
    await openReset(user, "Luis Quispe");
    await user.type(screen.getByLabelText("Contraseña nueva"), "corta");
    await user.click(saveNewPassword());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La contraseña debe tener al menos 8 caracteres",
    );
    expect(captured.body).toBeUndefined();
  });

  it("muestra el error del backend al cambiar la contraseña", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);
    stubUpdate(DRIVER_ID, 500, { message: "Base de datos no disponible" });

    renderPage();
    await openReset(user, "Luis Quispe");
    await user.type(screen.getByLabelText("Contraseña nueva"), "clave-nueva-de-luis");
    await user.click(saveNewPassword());

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");
  });

  // Es la forma de rotar `admin123`: la guarda de `isSelf` de "Desactivar" no
  // aplica acá. Se abre por el usuario y no por el nombre: el admin se llama
  // "Administrador" y ese texto también es su rol.
  it("el administrador puede cambiarse la contraseña a sí mismo", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);
    const captured = stubUpdate(SELF_ID, 200, SELF);

    renderPage();
    await openReset(user, "admin", "Administrador");
    await user.type(screen.getByLabelText("Contraseña nueva"), "clave-rotada");
    await user.click(saveNewPassword());

    await waitFor(() => expect(captured.body).toEqual({ password: "clave-rotada" }));
  });

  // La importante de las tres: sin esto, lo tipeado para una persona quedaría
  // cargado y se enviaría como contraseña de la siguiente.
  it("cambiar de persona vacía la contraseña tipeada para la anterior", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);

    renderPage();
    await openReset(user, "Luis Quispe");
    await user.type(screen.getByLabelText("Contraseña nueva"), "clave-de-luis");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await openReset(user, "admin", "Administrador");
    expect(screen.getByLabelText("Contraseña nueva")).toHaveValue("");
  });

  // Los dos bloques son hermanos arriba de la tabla y los dos tienen un
  // "Cancelar"; la confirmación de desactivar es la tercera cosa que no puede
  // convivir con ellos.
  it("abrir otra operación cierra el bloque de cambiar contraseña", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER]);

    renderPage();
    await openReset(user, "Luis Quispe");
    await user.click(screen.getByRole("button", { name: "Nuevo usuario" }));
    expect(
      screen.queryByRole("form", { name: "Cambiar la contraseña de Luis Quispe" }),
    ).not.toBeInTheDocument();

    await openReset(user, "Luis Quispe");
    const row = await rowOf("Luis Quispe");
    await user.click(within(row).getByRole("button", { name: "Editar" }));
    expect(
      screen.queryByRole("form", { name: "Cambiar la contraseña de Luis Quispe" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancelar" })).toHaveLength(1);
  });

  // El aviso nombra a una persona y vive en la card de la tabla, no adentro
  // del bloque que lo produjo.
  it("el aviso de contraseña cambiada no sobrevive a un cambio de filtro", async () => {
    const user = userEvent.setup();
    stubList([SELF, DRIVER, RETIRED]);
    stubUpdate(DRIVER_ID, 200, DRIVER);

    renderPage();
    await openReset(user, "Luis Quispe");
    await user.type(screen.getByLabelText("Contraseña nueva"), "clave-nueva-de-luis");
    await user.click(saveNewPassword());
    await screen.findByText(/Contraseña cambiada\. Díctasela a Luis Quispe/);

    await user.selectOptions(screen.getByLabelText("Estado"), "inactive");

    await screen.findByText("Ana Retirada");
    expect(screen.queryByText(/Contraseña cambiada/)).not.toBeInTheDocument();
  });

  it("sin usuarios con ese filtro lo dice", async () => {
    stubList([]);

    renderPage();

    expect(await screen.findByText("No hay usuarios con ese rol")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("muestra el error de carga y permite reintentar", async () => {
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json([DRIVER]);
      }),
    );
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Luis Quispe")).toBeInTheDocument();
  });

  // Mismo reparto asimétrico que ContainerTypesPage y ZonesPage: leer es
  // ADMIN y SELLER, escribir es solo ADMIN.
  it("un vendedor ve la lista pero ningún control de gestión", async () => {
    localStorage.clear();
    signIn(["SELLER"]);
    stubList([SELF, DRIVER]);

    renderPage();

    expect(await screen.findByText("Luis Quispe")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo usuario" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cambiar contraseña" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });
});
