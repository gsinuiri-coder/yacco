import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { Zone } from "../api/zones";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { ZonesPage } from "./zones-page";

const NORTE_ID = "11111111-1111-4111-8111-111111111111";
const SUR_ID = "22222222-2222-4222-8222-222222222222";
const OLD_ID = "33333333-3333-4333-8333-333333333333";

const NORTE: Zone = {
  id: NORTE_ID,
  name: "Norte",
  deliveryDays: ["MONDAY", "WEDNESDAY"],
  active: true,
};
const SUR: Zone = { id: SUR_ID, name: "Sur", deliveryDays: [], active: true };
const OLD: Zone = { id: OLD_ID, name: "Zona antigua", deliveryDays: [], active: false };

/** The API splits the catalog by `active`; the page asks for both halves. */
function stubList(zones: Zone[]): void {
  server.use(
    http.get(`${API_BASE_URL}/zones`, ({ request }) => {
      const active = new URL(request.url).searchParams.get("active") !== "false";
      return HttpResponse.json(zones.filter((zone) => zone.active === active));
    }),
  );
}

function stubCreate(status: number, payload: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post(`${API_BASE_URL}/zones`, async ({ request }) => {
      captured.body = await request.json();
      return HttpResponse.json(payload, { status });
    }),
  );
  return captured;
}

function stubUpdate(id: string, status: number, payload: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.patch(`${API_BASE_URL}/zones/${id}`, async ({ request }) => {
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
  return renderWithProviders(<ZonesPage />, "/zones");
}

describe("ZonesPage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(["ADMIN"]);
  });

  it("lista las zonas activas y retiradas, ordenadas por nombre, con sus días", async () => {
    stubList([NORTE, SUR, OLD]);

    renderPage();

    expect(await screen.findByText("Norte")).toBeInTheDocument();
    const norte = rowOf("Norte");
    expect(within(norte).getByText("Lunes, Miércoles")).toBeInTheDocument();
    expect(within(norte).getByText("En uso")).toBeInTheDocument();

    const sur = rowOf("Sur");
    expect(within(sur).getByText("Sin días definidos")).toBeInTheDocument();

    const old = rowOf("Zona antigua");
    expect(within(old).getByText("Retirada")).toBeInTheDocument();
  });

  it("crea una zona sin días: el POST omite deliveryDays, no lo manda vacío", async () => {
    const user = userEvent.setup();
    stubList([]);
    const captured = stubCreate(201, { ...NORTE, deliveryDays: [] });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Nueva zona" }));
    await user.type(screen.getByLabelText("Nombre"), "Norte");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(captured.body).toEqual({ name: "Norte" });
    expect(await screen.findByText("Norte")).toBeInTheDocument();
  });

  it("crea una zona con días elegidos: el POST manda deliveryDays con esos días", async () => {
    const user = userEvent.setup();
    stubList([]);
    const captured = stubCreate(201, NORTE);

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Nueva zona" }));
    await user.type(screen.getByLabelText("Nombre"), "Norte");
    await user.click(screen.getByLabelText("Lunes"));
    await user.click(screen.getByLabelText("Miércoles"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(captured.body).toEqual({ name: "Norte", deliveryDays: ["MONDAY", "WEDNESDAY"] });
  });

  it("un nombre repetido muestra el mensaje del backend, no uno genérico", async () => {
    const user = userEvent.setup();
    stubList([]);
    stubCreate(400, { message: 'Ya existe una zona con el nombre "Norte"' });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Nueva zona" }));
    await user.type(screen.getByLabelText("Nombre"), "Norte");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Ya existe una zona con el nombre "Norte"',
    );
  });

  it("editar una zona con PATCH cambia nombre y días, y refleja la fila", async () => {
    const user = userEvent.setup();
    stubList([SUR]);
    const captured = stubUpdate(SUR_ID, 200, {
      ...SUR,
      name: "Sur Grande",
      deliveryDays: ["FRIDAY"],
    });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const nameInput = screen.getByLabelText(`Nuevo nombre de ${SUR.name}`);
    await user.clear(nameInput);
    await user.type(nameInput, "Sur Grande");
    await user.click(screen.getByLabelText("Viernes"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(captured.body).toEqual({ name: "Sur Grande", deliveryDays: ["FRIDAY"] });
    expect(await screen.findByText("Sur Grande")).toBeInTheDocument();
    expect(screen.getByText("Viernes")).toBeInTheDocument();
  });

  it("retirar exige confirmación con la explicación antes de mandar active:false", async () => {
    const user = userEvent.setup();
    stubList([NORTE]);
    const captured = stubUpdate(NORTE_ID, 200, { ...NORTE, active: false });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Retirar" }));

    const confirm = screen.getByRole("group", { name: `Confirmar retiro de ${NORTE.name}` });
    expect(confirm).toHaveTextContent("¿Retirar «Norte»?");
    expect(captured.body).toBeUndefined();

    await user.click(within(confirm).getByRole("button", { name: "Sí, retirar" }));

    expect(captured.body).toEqual({ active: false });
    expect(await screen.findByText("Retirada")).toBeInTheDocument();
  });

  it("muestra el error del backend al retirar", async () => {
    const user = userEvent.setup();
    stubList([NORTE]);

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Retirar" }));

    const confirm = screen.getByRole("group", { name: `Confirmar retiro de ${NORTE.name}` });
    server.use(
      http.patch(`${API_BASE_URL}/zones/${NORTE_ID}`, () =>
        HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 }),
      ),
    );
    await user.click(within(confirm).getByRole("button", { name: "Sí, retirar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");
  });

  it("«No» cierra la confirmación de retiro sin llamar a la API", async () => {
    const user = userEvent.setup();
    stubList([NORTE]);
    const captured = stubUpdate(NORTE_ID, 200, { ...NORTE, active: false });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Retirar" }));
    await user.click(screen.getByRole("button", { name: "No" }));

    expect(screen.queryByRole("group", { name: /Confirmar retiro/ })).not.toBeInTheDocument();
    expect(captured.body).toBeUndefined();
  });

  it("reactivar es un solo clic, sin paso de confirmación", async () => {
    const user = userEvent.setup();
    stubList([OLD]);
    const captured = stubUpdate(OLD_ID, 200, { ...OLD, active: true });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Reactivar" }));

    expect(captured.body).toEqual({ active: true });
    expect(await screen.findByText("En uso")).toBeInTheDocument();
  });

  it("muestra un estado vacío cuando no hay zonas", async () => {
    stubList([]);

    renderPage();

    expect(await screen.findByText("Todavía no hay zonas")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("muestra el error de carga y permite reintentar", async () => {
    let attempt = 0;
    server.use(
      http.get(`${API_BASE_URL}/zones`, () => {
        attempt += 1;
        if (attempt <= 2) {
          return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
        }
        return HttpResponse.json([]);
      }),
    );
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Todavía no hay zonas")).toBeInTheDocument();
  });

  it("un vendedor ve la lista con sus días, pero no los controles de gestión", async () => {
    localStorage.clear();
    signIn(["SELLER"]);
    stubList([NORTE, OLD]);

    renderPage();

    expect(await screen.findByText("Norte")).toBeInTheDocument();
    expect(screen.getByText("Lunes, Miércoles")).toBeInTheDocument();
    expect(screen.getByText("Retirada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nueva zona" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retirar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reactivar" })).not.toBeInTheDocument();
  });
});
