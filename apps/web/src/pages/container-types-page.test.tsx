import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { ContainerType } from "../api/container-types";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { ContainerTypesPage } from "./container-types-page";

const BLUE_ID = "11111111-1111-4111-8111-111111111111";
const RED_ID = "22222222-2222-4222-8222-222222222222";
const OLD_ID = "33333333-3333-4333-8333-333333333333";

const BLUE: ContainerType = { id: BLUE_ID, name: "Bidón 20L (V)", active: true };
const RED: ContainerType = { id: RED_ID, name: "Bidón 20L (R)", active: true };
const OLD: ContainerType = { id: OLD_ID, name: "Bidón antiguo", active: false };

/** The API splits the catalog by `active`; the page asks for both halves. */
function stubList(types: ContainerType[]): void {
  server.use(
    http.get(`${API_BASE_URL}/container-types`, ({ request }) => {
      const active = new URL(request.url).searchParams.get("active") !== "false";
      return HttpResponse.json(types.filter((type) => type.active === active));
    }),
  );
}

function stubCreate(status: number, payload: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post(`${API_BASE_URL}/container-types`, async ({ request }) => {
      captured.body = await request.json();
      return HttpResponse.json(payload, { status });
    }),
  );
  return captured;
}

function stubUpdate(id: string, status: number, payload: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.patch(`${API_BASE_URL}/container-types/${id}`, async ({ request }) => {
      captured.body = await request.json();
      return HttpResponse.json(payload, { status });
    }),
  );
  return captured;
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function renderPage() {
  return renderWithProviders(<ContainerTypesPage />, "/container-types");
}

describe("ContainerTypesPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
  });

  it("lista los tipos de envase leídos de la API, ordenados por nombre", async () => {
    stubList([BLUE, RED]);

    renderPage();

    expect(await screen.findByText("Bidón 20L (R)")).toBeInTheDocument();
    expect(screen.getByText("Bidón 20L (V)")).toBeInTheDocument();
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0]?.textContent);
    expect(names).toEqual(["Bidón 20L (R)", "Bidón 20L (V)"]);
    expect(screen.getByText("2 en uso")).toBeInTheDocument();
  });

  it("muestra los retirados marcados, sin esconderlos, con la opción de reactivar", async () => {
    stubList([BLUE, OLD]);

    renderPage();

    const old = await screen.findByText("Bidón antiguo");
    const row = rowOf("Bidón antiguo");
    expect(old).toBeInTheDocument();
    expect(within(row).getByText("Retirado")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Reactivar" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Retirar" })).not.toBeInTheDocument();
    expect(within(rowOf("Bidón 20L (V)")).getByText("En uso")).toBeInTheDocument();
    expect(screen.getByText("1 en uso, 1 retirado")).toBeInTheDocument();
  });

  it("nunca ofrece eliminar: la baja es lógica", async () => {
    stubList([BLUE]);

    renderPage();
    await screen.findByText("Bidón 20L (V)");

    expect(screen.queryByRole("button", { name: /eliminar/i })).not.toBeInTheDocument();
  });

  it("crea un tipo de envase y lo agrega a la lista", async () => {
    const user = userEvent.setup();
    stubList([BLUE]);
    const created: ContainerType = { id: RED_ID, name: "Bidón 20L (R)", active: true };
    const captured = stubCreate(201, created);

    renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Nuevo tipo de envase" }));
    await user.type(screen.getByLabelText("Nombre"), "  Bidón 20L (R)  ");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Bidón 20L (R)")).toBeInTheDocument();
    expect(captured.body).toEqual({ name: "Bidón 20L (R)" });
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
    expect(screen.getByText("2 en uso")).toBeInTheDocument();
  });

  it("no envía un nombre vacío", async () => {
    const user = userEvent.setup();
    stubList([BLUE]);

    renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Nuevo tipo de envase" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escribe el nombre del tipo de envase",
    );
  });

  it("con un nombre duplicado muestra el mensaje del backend, no uno genérico", async () => {
    const user = userEvent.setup();
    stubList([BLUE]);
    stubCreate(400, { message: 'Ya existe un tipo de envase con el nombre "Bidón 20L (V)"' });

    renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Nuevo tipo de envase" }));
    await user.type(screen.getByLabelText("Nombre"), "Bidón 20L (V)");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Ya existe un tipo de envase con el nombre "Bidón 20L (V)"',
    );
    // The form stays open so the owner can fix the name.
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
  });

  it("renombra un tipo de envase con PATCH y muestra el nuevo nombre", async () => {
    const user = userEvent.setup();
    stubList([BLUE]);
    const captured = stubUpdate(BLUE_ID, 200, { ...BLUE, name: "Bidón 20L verde" });

    renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Renombrar" }));
    const input = screen.getByLabelText("Nuevo nombre de Bidón 20L (V)");
    await user.clear(input);
    await user.type(input, "Bidón 20L verde");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Bidón 20L verde")).toBeInTheDocument();
    expect(captured.body).toEqual({ name: "Bidón 20L verde" });
    expect(screen.queryByText("Bidón 20L (V)")).not.toBeInTheDocument();
  });

  it("al renombrar sobre un nombre existente muestra el mensaje del backend", async () => {
    const user = userEvent.setup();
    stubList([BLUE, RED]);
    stubUpdate(BLUE_ID, 400, {
      message: 'Ya existe un tipo de envase con el nombre "Bidón 20L (R)"',
    });

    renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(within(rowOf("Bidón 20L (V)")).getByRole("button", { name: "Renombrar" }));
    const input = screen.getByLabelText("Nuevo nombre de Bidón 20L (V)");
    await user.clear(input);
    await user.type(input, "Bidón 20L (R)");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Ya existe un tipo de envase con el nombre "Bidón 20L (R)"',
    );
  });

  it("retirar pide confirmación explicando qué significa, y recién entonces envía active=false", async () => {
    const user = userEvent.setup();
    stubList([BLUE]);
    const captured = stubUpdate(BLUE_ID, 200, { ...BLUE, active: false });

    renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Retirar" }));

    const confirmation = screen.getByRole("group", { name: "Confirmar retiro de Bidón 20L (V)" });
    expect(confirmation).toHaveTextContent("Ya no se podrán entregar envases nuevos de este tipo");
    expect(confirmation).toHaveTextContent(
      "Los que ya están en poder de los clientes siguen contando y pueden devolverse",
    );
    expect(captured.body).toBeUndefined();

    await user.click(within(confirmation).getByRole("button", { name: "Sí, retirar" }));

    const row = rowOf("Bidón 20L (V)");
    expect(await within(row).findByText("Retirado")).toBeInTheDocument();
    expect(captured.body).toEqual({ active: false });
    expect(within(row).getByRole("button", { name: "Reactivar" })).toBeInTheDocument();
  });

  it("«No» en la confirmación de retiro no toca la API", async () => {
    const user = userEvent.setup();
    stubList([BLUE]);
    const captured = stubUpdate(BLUE_ID, 200, { ...BLUE, active: false });

    renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Retirar" }));
    await user.click(screen.getByRole("button", { name: "No" }));

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(captured.body).toBeUndefined();
    expect(within(rowOf("Bidón 20L (V)")).getByText("En uso")).toBeInTheDocument();
  });

  it("reactiva un tipo retirado con active=true", async () => {
    const user = userEvent.setup();
    stubList([OLD]);
    const captured = stubUpdate(OLD_ID, 200, { ...OLD, active: true });

    renderPage();
    await screen.findByText("Bidón antiguo");

    await user.click(screen.getByRole("button", { name: "Reactivar" }));

    const row = rowOf("Bidón antiguo");
    expect(await within(row).findByText("En uso")).toBeInTheDocument();
    expect(captured.body).toEqual({ active: true });
    expect(within(row).getByRole("button", { name: "Retirar" })).toBeInTheDocument();
  });

  it("muestra el error del backend al retirar", async () => {
    const user = userEvent.setup();
    stubList([BLUE]);
    stubUpdate(BLUE_ID, 500, { message: "Base de datos no disponible" });

    renderPage();
    await screen.findByText("Bidón 20L (V)");

    await user.click(screen.getByRole("button", { name: "Retirar" }));
    await user.click(screen.getByRole("button", { name: "Sí, retirar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");
    expect(within(rowOf("Bidón 20L (V)")).getByText("En uso")).toBeInTheDocument();
  });

  // El error va pegado a la fila que falló, no una sola vez arriba de la
  // card: con un catálogo largo, un mensaje arriba no dice cuál fue.
  it("el error de una acción se muestra dentro de la tabla, junto a su fila", async () => {
    const user = userEvent.setup();
    stubList([BLUE, RED]);
    stubUpdate(BLUE_ID, 500, { message: "Base de datos no disponible" });

    renderPage();
    await screen.findByText("Bidón 20L (V)");
    const row = rowOf("Bidón 20L (V)");

    await user.click(within(row).getByRole("button", { name: "Retirar" }));
    await user.click(screen.getByRole("button", { name: "Sí, retirar" }));

    const alert = await screen.findByRole("alert");
    expect(within(screen.getByRole("table")).getByRole("alert")).toBe(alert);
    // Y en la fila inmediatamente siguiente a la que falló.
    expect(rowOf("Bidón 20L (V)").nextElementSibling).toContainElement(alert);
  });

  it("muestra el error de carga y permite reintentar", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/container-types`, ({ request }) => {
        attempt += 1;
        // Both halves (active and withdrawn) fail on the first load.
        if (attempt <= 2) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        const wantsActive = new URL(request.url).searchParams.get("active") !== "false";
        return HttpResponse.json(wantsActive ? [BLUE] : []);
      }),
    );

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Bidón 20L (V)")).toBeInTheDocument();
  });

  it("muestra un estado vacío cuando no hay tipos de envase", async () => {
    stubList([]);

    renderPage();

    expect(await screen.findByText("Todavía no hay tipos de envase")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("un vendedor ve la lista pero no los controles de gestión", async () => {
    localStorage.clear();
    signIn(["SELLER"]);
    stubList([BLUE, OLD]);

    renderPage();

    expect(await screen.findByText("Bidón 20L (V)")).toBeInTheDocument();
    expect(screen.getByText("Retirado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo tipo de envase" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Renombrar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reactivar" })).not.toBeInTheDocument();
  });
});
