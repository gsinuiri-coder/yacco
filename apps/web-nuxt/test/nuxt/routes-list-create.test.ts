import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { getQuery, readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { Route, User, Zone } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { DRIVER, buildRoute, buildStop, pageOf } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const NORTE: Zone = { id: "z-norte", name: "Norte", deliveryDays: [], active: true };
type Query = Record<string, string>;

function endpoint(...args: Parameters<typeof registerEndpoint>) {
  cleanups.push(registerEndpoint(...args));
}

function stubCatalogs(drivers: User[] | "falla" = [DRIVER], zones: Zone[] | "falla" = [NORTE]) {
  const userQueries: Query[] = [];
  const fail = (event: H3Event) => {
    setResponseStatus(event, 500);
    return { message: "no disponible" };
  };
  endpoint("/api/v1/users", (event: H3Event) => {
    userQueries.push(getQuery(event) as Query);
    return drivers === "falla" ? fail(event) : drivers;
  });
  endpoint("/api/v1/zones", (event: H3Event) => (zones === "falla" ? fail(event) : zones));
  return userQueries;
}

function stubRoutes(respond: (query: Query) => Route[] | ReturnType<typeof pageOf<Route>>) {
  const seen: Query[] = [];
  endpoint("/api/v1/routes", {
    method: "GET",
    handler: (event: H3Event) => {
      const query = getQuery(event) as Query;
      seen.push(query);
      const result = respond(query);
      return Array.isArray(result) ? pageOf(result) : result;
    },
  });
  return seen;
}

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("Rutas", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("lista día, chofer, zona, estado y el resumen de paradas", async () => {
    stubCatalogs();
    stubRoutes(() => [
      buildRoute({
        status: "IN_PROGRESS",
        stops: [
          buildStop({ position: 1, status: "DELIVERED" }),
          buildStop({ position: 2, status: "FAILED" }),
          buildStop({ position: 3, status: "PENDING" }),
        ],
      }),
      buildRoute({ id: "r-2", date: "2026-08-27", zoneId: null, zone: null, stops: [] }),
    ]);

    await renderSuspended(App, { route: "/routes" });

    const enCurso = (await screen.findByText("En curso")).closest("tr") as HTMLElement;
    expect(within(enCurso).getByText("28/08/2026")).toBeTruthy();
    expect(within(enCurso).getByText("Luis Quispe")).toBeTruthy();
    expect(within(enCurso).getByText("Norte")).toBeTruthy();
    expect(within(enCurso).getByText("3 paradas")).toBeTruthy();
    expect(within(enCurso).getByText("1 entregada · 1 no entregada · 1 pendiente")).toBeTruthy();

    const planificada = screen.getByText("Planificada").closest("tr") as HTMLElement;
    expect(within(planificada).getByText("Sin zona")).toBeTruthy();
    expect(within(planificada).getByText("Sin paradas")).toBeTruthy();
    expect(screen.getByText("2 rutas")).toBeTruthy();
  });

  it("los filtros viajan en la query (el día como texto) y «Limpiar filtros» los deshace", async () => {
    stubCatalogs();
    const seen = stubRoutes(() => [buildRoute()]);

    await renderSuspended(App, { route: "/routes" });
    await screen.findByText("28/08/2026");

    await choose("Chofer", "Luis Quispe");
    await waitFor(() => expect(seen.at(-1)?.driverId).toBe(DRIVER.id));
    await choose("Zona", "Norte");
    await waitFor(() => expect(seen.at(-1)?.zoneId).toBe("z-norte"));
    await choose("Estado", "Liquidada");
    await waitFor(() => expect(seen.at(-1)?.status).toBe("SETTLED"));
    await fireEvent.update(screen.getByLabelText("Día"), "2026-08-28");
    await waitFor(() => expect(seen.at(-1)?.date).toBe("2026-08-28"));

    await userEvent.setup().click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() => expect(seen.at(-1)).toEqual({ page: "1", limit: "20" }));
  });

  it("la fecha de cada ruta lleva a su detalle", async () => {
    stubCatalogs();
    stubRoutes(() => [buildRoute({ id: "r-77" })]);

    await renderSuspended(App, { route: "/routes" });

    const link = await screen.findByRole("link", {
      name: "Ver la ruta de Luis Quispe del 28/08/2026",
    });
    expect(link.getAttribute("href")).toBe("/routes/r-77");
  });

  it("sin rutas invita a planificar la primera", async () => {
    stubCatalogs();
    stubRoutes(() => []);

    await renderSuspended(App, { route: "/routes" });

    expect(await screen.findByText("Todavía no hay rutas")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Planificar ruta" })).toHaveLength(2);
  });

  it("muestra el error de carga y permite reintentar", async () => {
    stubCatalogs();
    let attempt = 0;
    endpoint("/api/v1/routes", {
      method: "GET",
      handler: (event: H3Event) => {
        attempt++;
        if (attempt === 1) {
          setResponseStatus(event, 500);
          return { message: "Base de datos no disponible" };
        }
        return pageOf([buildRoute()]);
      },
    });

    await renderSuspended(App, { route: "/routes" });
    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("28/08/2026")).toBeTruthy();
  });

  it("un catálogo caído deja el filtro sólo con «Todos», pero la lista sigue", async () => {
    stubCatalogs("falla", "falla");
    stubRoutes(() => [buildRoute()]);

    await renderSuspended(App, { route: "/routes" });

    expect(await screen.findByText("28/08/2026")).toBeTruthy();
    await userEvent.setup().click(screen.getByLabelText("Chofer"));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual(["Todos"]);
  });
});

describe("Planificar ruta", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function stubCreate(respond: (event: H3Event) => unknown = () => buildRoute({ id: "r-new" })) {
    const bodies: unknown[] = [];
    endpoint("/api/v1/routes", {
      method: "POST",
      handler: async (event: H3Event) => {
        bodies.push(await readBody(event));
        return respond(event);
      },
    });
    endpoint("/api/v1/routes/r-new", { method: "GET", handler: () => buildRoute({ id: "r-new" }) });
    return bodies;
  }

  const planButton = () => screen.getByRole("button", { name: "Planificar ruta" });

  it("sólo ofrece choferes, planifica con el día de hoy y cae en el detalle", async () => {
    const userQueries = stubCatalogs();
    const bodies = stubCreate();

    await renderSuspended(App, { route: "/routes/new" });
    await choose("Chofer", "Luis Quispe");
    await choose("Zona (opcional)", "Norte");
    await userEvent.setup().click(planButton());

    await waitFor(() => expect(useRouter().currentRoute.value.path).toBe("/routes/r-new"));
    expect(userQueries[0]).toEqual({ role: "DRIVER" });
    expect(bodies).toEqual([
      {
        driverId: DRIVER.id,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        zoneId: "z-norte",
      },
    ]);
  });

  it("sin zona elegida no manda zoneId, tampoco si el catálogo de zonas cayó", async () => {
    stubCatalogs([DRIVER], "falla");
    const bodies = stubCreate();

    await renderSuspended(App, { route: "/routes/new" });
    await choose("Chofer", "Luis Quispe");
    await userEvent.setup().click(planButton());

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).not.toHaveProperty("zoneId");
  });

  it("sin chofer no llama a la API y lo pide", async () => {
    stubCatalogs();
    const bodies = stubCreate();

    await renderSuspended(App, { route: "/routes/new" });
    await screen.findByLabelText("Chofer");
    await userEvent.setup().click(planButton());

    expect(await screen.findByText("Elige el chofer que va a hacer la ruta")).toBeTruthy();
    expect(bodies).toHaveLength(0);
  });

  it("el 400 de la API (chofer con ruta ese día) se muestra tal cual y deja reintentar", async () => {
    stubCatalogs();
    stubCreate((event) => {
      setResponseStatus(event, 400);
      return {
        message: 'El chofer "Luis Quispe" ya tiene una ruta planificada para el 2026-08-28',
      };
    });

    await renderSuspended(App, { route: "/routes/new" });
    await choose("Chofer", "Luis Quispe");
    await userEvent.setup().click(planButton());

    expect((await screen.findByRole("alert")).textContent).toContain(
      'El chofer "Luis Quispe" ya tiene una ruta planificada para el 2026-08-28',
    );
    expect((planButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("sin choferes activos lo dice y no deja enviar", async () => {
    stubCatalogs([]);

    await renderSuspended(App, { route: "/routes/new" });

    expect(await screen.findByText(/No hay choferes activos para asignar/)).toBeTruthy();
    expect((planButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("si el catálogo de choferes cae, lo dice (no es lo mismo que no haber) y deja reintentar", async () => {
    stubCatalogs("falla");

    await renderSuspended(App, { route: "/routes/new" });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No se pudo cargar la lista de choferes.",
    );
    expect(screen.queryByText(/No hay choferes activos/)).toBeNull();
    expect((planButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("«Cancelar» vuelve a la lista sin llamar a la API", async () => {
    stubCatalogs();
    const bodies = stubCreate();
    stubRoutes(() => []);

    await renderSuspended(App, { route: "/routes/new" });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(useRouter().currentRoute.value.path).toBe("/routes"));
    expect(bodies).toHaveLength(0);
  });
});
