import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { Customer, Page } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer, pageOf } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
type Query = Record<string, string>;

function stubCustomers(respond: (query: Query) => Page<Customer>): Query[] {
  const seen: Query[] = [];
  cleanups.push(
    registerEndpoint("/api/v1/customers", (event: H3Event) => {
      const query = getQuery(event) as Query;
      seen.push(query);
      return respond(query);
    }),
  );
  return seen;
}

function stubTwoPages(): Query[] {
  return stubCustomers((query) =>
    pageOf([buildCustomer({ name: `Cliente de la ${query.page}` })], {
      total: 40,
      page: Number(query.page),
      totalPages: 2,
    }),
  );
}

const PAST_DEBOUNCE_MS = 450;
const waitPastDebounce = () => new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));

async function renderCustomers() {
  await renderSuspended(App, { route: "/customers" });
}

describe("Clientes", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista cada cliente con teléfono, zona, estado y deuda, y cuenta cuántos hay", async () => {
    stubCustomers(() =>
      pageOf([
        buildCustomer({ name: "Bodega Santa Rosa", debtBalance: "1234.50" }),
        buildCustomer({
          id: "c-2",
          name: "Panadería Aurora",
          phone: "912345678",
          zone: { id: "z-1", name: "Norte" },
          active: false,
        }),
      ]),
    );

    await renderCustomers();

    const table = await screen.findByRole("table", {
      name: "Clientes registrados con su zona y su deuda",
    });
    const santaRosa = within(table).getByText("Bodega Santa Rosa").closest("tr") as HTMLElement;
    expect(within(santaRosa).getByText("987654321")).toBeTruthy();
    expect(within(santaRosa).getByText("Sin zona")).toBeTruthy();
    expect(within(santaRosa).getByText("Activo")).toBeTruthy();
    expect(within(santaRosa).getByText("S/ 1,234.50")).toBeTruthy();

    const aurora = within(table).getByText("Panadería Aurora").closest("tr") as HTMLElement;
    expect(within(aurora).getByText("Desactivado")).toBeTruthy();
    expect(within(aurora).getByText("Norte")).toBeTruthy();

    expect(screen.getByText("2 clientes")).toBeTruthy();
  });

  it("muestra la deuda sin perder el cero de los céntimos", async () => {
    stubCustomers(() => pageOf([buildCustomer({ debtBalance: "0.30" })]));

    await renderCustomers();

    expect(await screen.findByText("S/ 0.30")).toBeTruthy();
    expect(screen.queryByText("S/ 0.3")).toBeNull();
  });

  it("pide la primera página con el límite de la API, no la lista entera", async () => {
    const seen = stubCustomers(() => pageOf([buildCustomer()]));

    await renderCustomers();
    await screen.findByText("Bodega Santa Rosa");

    expect(seen[0]).toEqual({ page: "1", limit: "20" });
  });

  it("«Siguiente» pide la página 2 y muestra sus filas", async () => {
    const seen = stubTwoPages();
    await renderCustomers();
    await screen.findByText("Cliente de la 1");
    expect(screen.getByText("Página 1 de 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Anterior" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Siguiente" }));

    expect(await screen.findByText("Cliente de la 2")).toBeTruthy();
    expect(seen.at(-1)?.page).toBe("2");
    expect(screen.queryByText("Cliente de la 1")).toBeNull();
  });

  it("paginar apenas carga no se pisa cuando vence la espera del buscador", async () => {
    const seen = stubTwoPages();
    await renderCustomers();
    await screen.findByText("Cliente de la 1");

    await userEvent.setup().click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Cliente de la 2");
    await waitPastDebounce();

    expect(seen.map((query) => query.page)).toEqual(["1", "2"]);
    expect(screen.getByText("Cliente de la 2")).toBeTruthy();
  });

  it("tipear en el buscador y borrarlo deja al usuario en la página que eligió", async () => {
    const user = userEvent.setup();
    const seen = stubTwoPages();
    await renderCustomers();
    await screen.findByText("Cliente de la 1");
    await waitPastDebounce();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Cliente de la 2");
    const searchBox = screen.getByLabelText("Buscar");
    await user.type(searchBox, "a");
    await user.clear(searchBox);
    await waitPastDebounce();

    expect(seen.map((query) => query.page)).toEqual(["1", "2"]);
    expect(screen.getByText("Cliente de la 2")).toBeTruthy();
  });

  it("cambiar el término de búsqueda sí vuelve a la primera página, con una sola petición", async () => {
    const user = userEvent.setup();
    const seen = stubCustomers((query) =>
      pageOf(
        [
          buildCustomer({
            name: query.search ? "Resultado buscado" : `Cliente de la ${query.page}`,
          }),
        ],
        { total: 40, page: Number(query.page), totalPages: 2 },
      ),
    );
    await renderCustomers();
    await screen.findByText("Cliente de la 1");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Cliente de la 2");

    await user.type(screen.getByLabelText("Buscar"), "rosa");

    expect(await screen.findByText("Resultado buscado")).toBeTruthy();
    expect(seen.slice(2)).toEqual([{ search: "rosa", page: "1", limit: "20" }]);
  });

  it("filtra por estado con un clic y vuelve a la primera página", async () => {
    const seen = stubCustomers((query) =>
      query.active === "false"
        ? pageOf([buildCustomer({ name: "Kiosko Cerrado", active: false })])
        : pageOf([buildCustomer()], { total: 40, page: Number(query.page), totalPages: 2 }),
    );
    const user = userEvent.setup();
    await renderCustomers();
    await screen.findByText("Bodega Santa Rosa");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(seen.at(-1)?.page).toBe("2"));

    const group = screen.getByRole("group", { name: "Estado" });
    await user.click(within(group).getByRole("button", { name: "Desactivados" }));

    expect(await screen.findByText("Kiosko Cerrado")).toBeTruthy();
    expect(seen.at(-1)).toEqual({ active: "false", page: "1", limit: "20" });
    expect(
      within(group).getByRole("button", { name: "Desactivados" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("1 cliente con este filtro")).toBeTruthy();
  });

  it("muestra el error de la API y permite reintentar", async () => {
    let attempt = 0;
    cleanups.push(
      registerEndpoint("/api/v1/customers", (event: H3Event) => {
        attempt++;
        if (attempt === 1) {
          setResponseStatus(event, 500);
          return { message: "Base de datos no disponible" };
        }
        return pageOf([buildCustomer()]);
      }),
    );

    await renderCustomers();

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Bodega Santa Rosa")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sin clientes invita a registrar el primero, sin tabla", async () => {
    stubCustomers(() => pageOf([], { totalPages: 0 }));

    await renderCustomers();

    expect(await screen.findByText("Todavía no hay clientes")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Nuevo cliente" })).toHaveLength(2);
  });

  it("distingue el vacío por filtro del vacío real", async () => {
    stubCustomers((query) =>
      query.search ? pageOf([], { totalPages: 0 }) : pageOf([buildCustomer()]),
    );

    await renderCustomers();
    await screen.findByText("Bodega Santa Rosa");
    await userEvent.setup().type(screen.getByLabelText("Buscar"), "zzz");

    expect(await screen.findByText("Ningún cliente coincide con la búsqueda")).toBeTruthy();
    expect(screen.queryByText("Todavía no hay clientes")).toBeNull();
  });

  it("enlaza al alta, a la ficha por el nombre y a la edición de cada cliente", async () => {
    stubCustomers(() => pageOf([buildCustomer({ id: "c-9", name: "Bodega Santa Rosa" })]));

    await renderCustomers();
    await screen.findByText("Bodega Santa Rosa");

    expect(screen.getByRole("link", { name: "Nuevo cliente" }).getAttribute("href")).toBe(
      "/customers/new",
    );
    expect(screen.getByRole("link", { name: "Bodega Santa Rosa" }).getAttribute("href")).toBe(
      "/customers/c-9",
    );
    expect(
      screen.getByRole("link", { name: "Editar Bodega Santa Rosa" }).getAttribute("href"),
    ).toBe("/customers/c-9/edit");
  });

  it("clicar la fila abre la ficha, y clicar «Editar» va a la edición y no a la ficha", async () => {
    stubCustomers(() => pageOf([buildCustomer({ id: "c-9", name: "Bodega Santa Rosa" })]));
    const user = userEvent.setup();

    await renderCustomers();
    await user.click(await screen.findByText("987654321"));
    await waitFor(() => expect(useRouter().currentRoute.value.path).toBe("/customers/c-9"));

    await navigateTo("/customers");
    await user.click(await screen.findByRole("link", { name: "Editar Bodega Santa Rosa" }));
    await waitFor(() => expect(useRouter().currentRoute.value.path).toBe("/customers/c-9/edit"));
    // Si el clic llegara también a la fila, una segunda navegación la
    // llevaría a la ficha un instante después.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(useRouter().currentRoute.value.path).toBe("/customers/c-9/edit");
  });
});
