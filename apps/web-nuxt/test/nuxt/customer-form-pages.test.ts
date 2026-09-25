import { registerEndpoint, renderSuspended } from "@nuxt/test-utils/runtime";
import { screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import type { Customer, Zone } from "@yacco/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "~/app.vue";
import { buildCustomer } from "../support/fixtures";
import { resetSession, signIn } from "../support/session";

const cleanups: Array<() => void> = [];
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const NORTE: Zone = { id: "z-norte", name: "Norte", deliveryDays: [], active: true };
const SUR: Zone = { id: "z-sur", name: "Sur", deliveryDays: [], active: true };

function endpoint(...args: Parameters<typeof registerEndpoint>) {
  cleanups.push(registerEndpoint(...args));
}

function stubZones(zones: Zone[] | "falla") {
  endpoint("/api/v1/zones", (event: H3Event) => {
    if (zones === "falla") {
      setResponseStatus(event, 500);
      return { message: "Catálogo no disponible" };
    }
    return zones;
  });
}

/** Guarda el cuerpo de cada escritura; responde `status` con `payload`. */
function stubWrite(path: string, method: "POST" | "PATCH", status = 200, payload?: unknown) {
  const bodies: unknown[] = [];
  endpoint(path, {
    method,
    handler: async (event: H3Event) => {
      bodies.push(await readBody(event));
      setResponseStatus(event, status);
      return payload ?? buildCustomer();
    },
  });
  return bodies;
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Nombre"), "  Bodega Nueva ");
  await user.type(screen.getByLabelText("Teléfono"), "987000111");
  await user.type(screen.getByLabelText("Dirección"), "Jr. Puno 120");
  await user.type(screen.getByLabelText("Referencia"), "Frente al parque");
}

async function chooseZone(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByLabelText("Zona (opcional)"));
  await user.click(await screen.findByRole("option", { name }));
}

const onCustomersList = () =>
  waitFor(() => expect(useRouter().currentRoute.value.path).toBe("/customers"));

describe("Nuevo cliente", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    endpoint("/api/v1/customers", () => ({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    }));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("manda sólo los campos del contrato, sin opcionales vacíos, y vuelve a la lista", async () => {
    stubZones([NORTE]);
    const bodies = stubWrite("/api/v1/customers", "POST", 201);
    const user = userEvent.setup();

    await renderSuspended(App, { route: "/customers/new" });
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    await onCustomersList();
    expect(bodies).toEqual([
      {
        name: "Bodega Nueva",
        phone: "987000111",
        address: "Jr. Puno 120",
        addressReference: "Frente al parque",
      },
    ]);
  });

  it("la zona sale de su catálogo y el límite de crédito viaja como string", async () => {
    stubZones([NORTE, SUR]);
    const bodies = stubWrite("/api/v1/customers", "POST", 201);
    const user = userEvent.setup();

    await renderSuspended(App, { route: "/customers/new" });
    await fillRequired(user);
    await chooseZone(user, "Sur");
    await user.type(screen.getByLabelText("Límite de crédito (opcional)"), "150.50");
    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    await onCustomersList();
    expect(bodies[0]).toMatchObject({ zoneId: "z-sur", creditLimit: "150.50" });
  });

  it("si el catálogo de zonas falla, el formulario sigue usable con 'Sin zona'", async () => {
    stubZones("falla");
    const user = userEvent.setup();

    await renderSuspended(App, { route: "/customers/new" });
    await user.click(await screen.findByLabelText("Zona (opcional)"));

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual(["Sin zona"]);
  });

  it("valida en el cliente antes de llamar a la API, y corregir un campo borra sólo su error", async () => {
    stubZones([]);
    const bodies = stubWrite("/api/v1/customers", "POST", 201);
    const user = userEvent.setup();

    await renderSuspended(App, { route: "/customers/new" });
    await user.type(await screen.findByLabelText("Límite de crédito (opcional)"), "mucho");
    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    expect(await screen.findByText("El nombre es obligatorio")).toBeTruthy();
    expect(screen.getByText("El teléfono es obligatorio")).toBeTruthy();
    expect(screen.getByText('El límite de crédito debe ser un monto como "150.00"')).toBeTruthy();
    expect(bodies).toHaveLength(0);

    await user.type(screen.getByLabelText("Nombre"), "Bodega");

    await waitFor(() => expect(screen.queryByText("El nombre es obligatorio")).toBeNull());
    expect(screen.getByText("El teléfono es obligatorio")).toBeTruthy();
  });

  it("muestra el 400 de la API en vez de tragárselo", async () => {
    stubZones([]);
    stubWrite("/api/v1/customers", "POST", 400, { message: ["El teléfono ya está registrado"] });
    const user = userEvent.setup();

    await renderSuspended(App, { route: "/customers/new" });
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "El teléfono ya está registrado",
    );
    expect(useRouter().currentRoute.value.path).toBe("/customers/new");
  });
});

describe("Editar cliente", () => {
  beforeEach(async () => {
    resetSession();
    cleanups.push(signIn());
    endpoint("/api/v1/customers", () => ({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    }));
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function stubCustomer(customer: Customer) {
    endpoint(`/api/v1/customers/${CUSTOMER_ID}`, { method: "GET", handler: () => customer });
  }

  const editRoute = `/customers/${CUSTOMER_ID}/edit`;
  const baseCustomer = () =>
    buildCustomer({ id: CUSTOMER_ID, creditLimit: "150.00", debtBalance: "40.50" });

  it("precarga los datos del cliente, con su zona vigente", async () => {
    stubZones([NORTE, SUR]);
    stubCustomer({ ...baseCustomer(), zoneId: "z-sur", zone: { id: "z-sur", name: "Sur" } });

    await renderSuspended(App, { route: editRoute });

    expect(((await screen.findByLabelText("Nombre")) as HTMLInputElement).value).toBe(
      "Bodega Santa Rosa",
    );
    expect((screen.getByLabelText("Teléfono") as HTMLInputElement).value).toBe("987654321");
    expect((screen.getByLabelText("Referencia") as HTMLInputElement).value).toBe("Portón azul");
    expect((screen.getByLabelText("Límite de crédito (opcional)") as HTMLInputElement).value).toBe(
      "150.00",
    );
    expect(
      screen.getByRole("checkbox", { name: /Cliente activo/ }).getAttribute("aria-checked"),
    ).toBe("true");
    await waitFor(() =>
      expect(screen.getByLabelText("Zona (opcional)").textContent).toContain("Sur"),
    );
  });

  it("una zona retirada del cliente sigue ofrecida, marcada, y guardar sin tocarla la conserva", async () => {
    stubZones([NORTE]);
    stubCustomer({
      ...baseCustomer(),
      zoneId: "z-antigua",
      zone: { id: "z-antigua", name: "Antigua" },
    });
    const bodies = stubWrite(`/api/v1/customers/${CUSTOMER_ID}`, "PATCH");
    const user = userEvent.setup();

    await renderSuspended(App, { route: editRoute });
    await waitFor(() =>
      expect(screen.getByLabelText("Zona (opcional)").textContent).toContain("Antigua (retirada)"),
    );
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await onCustomersList();
    expect(bodies[0]).toMatchObject({ zoneId: "z-antigua" });
  });

  it("elegir otra zona activa la manda en el PATCH", async () => {
    stubZones([NORTE, SUR]);
    stubCustomer({ ...baseCustomer(), zoneId: "z-norte", zone: { id: "z-norte", name: "Norte" } });
    const bodies = stubWrite(`/api/v1/customers/${CUSTOMER_ID}`, "PATCH");
    const user = userEvent.setup();

    await renderSuspended(App, { route: editRoute });
    await screen.findByLabelText("Nombre");
    await chooseZone(user, "Sur");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await onCustomersList();
    expect(bodies[0]).toMatchObject({ zoneId: "z-sur" });
  });

  it("la deuda se ve, sin perder precisión, y no hay campo para editarla", async () => {
    stubZones([]);
    stubCustomer({ ...baseCustomer(), debtBalance: "0.30", creditLimit: null });

    await renderSuspended(App, { route: editRoute });

    expect(await screen.findByText("Deuda actual")).toBeTruthy();
    expect(screen.getByText("S/ 0.30")).toBeTruthy();
    expect(screen.getByText(/Límite de crédito vigente: Sin límite/)).toBeTruthy();
    expect(screen.queryByLabelText(/deuda/i)).toBeNull();
  });

  it("un saldo negativo se ve como plata a favor, no como deuda con signo", async () => {
    stubZones([]);
    stubCustomer({ ...baseCustomer(), debtBalance: "-15.00" });

    await renderSuspended(App, { route: editRoute });

    expect(await screen.findByText("A favor S/ 15.00")).toBeTruthy();
    expect(screen.queryByText("-S/ 15.00")).toBeNull();
  });

  it("guarda los cambios y nunca manda debtBalance", async () => {
    stubZones([]);
    stubCustomer(baseCustomer());
    const bodies = stubWrite(`/api/v1/customers/${CUSTOMER_ID}`, "PATCH");
    const user = userEvent.setup();

    await renderSuspended(App, { route: editRoute });
    const name = await screen.findByLabelText("Nombre");
    await user.clear(name);
    await user.type(name, "Bodega Santa Rosa II");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await onCustomersList();
    expect(bodies[0]).toMatchObject({
      name: "Bodega Santa Rosa II",
      phone: "987654321",
      active: true,
      creditLimit: "150.00",
    });
    expect(bodies[0]).not.toHaveProperty("debtBalance");
  });

  it("dar de baja manda active=false, sin borrar al cliente", async () => {
    stubZones([]);
    stubCustomer(baseCustomer());
    const bodies = stubWrite(`/api/v1/customers/${CUSTOMER_ID}`, "PATCH");
    const user = userEvent.setup();

    await renderSuspended(App, { route: editRoute });
    await user.click(await screen.findByRole("checkbox", { name: /Cliente activo/ }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await onCustomersList();
    expect(bodies[0]).toMatchObject({ active: false });
  });

  it("muestra el 400 de la API al guardar", async () => {
    stubZones([]);
    stubCustomer(baseCustomer());
    stubWrite(`/api/v1/customers/${CUSTOMER_ID}`, "PATCH", 400, {
      message: ["La zona debe ser un identificador válido"],
    });
    const user = userEvent.setup();

    await renderSuspended(App, { route: editRoute });
    await screen.findByLabelText("Nombre");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "La zona debe ser un identificador válido",
    );
  });

  it("un cliente que no existe lo dice, sin formulario, con salida a la lista", async () => {
    stubZones([]);
    endpoint(`/api/v1/customers/${CUSTOMER_ID}`, (event: H3Event) => {
      setResponseStatus(event, 404);
      return { message: "no existe" };
    });

    await renderSuspended(App, { route: editRoute });

    expect(await screen.findByText("Ese cliente no existe")).toBeTruthy();
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(within(document.body).getByRole("link", { name: "Volver a clientes" })).toBeTruthy();
  });

  it("si la carga falla por otra cosa, muestra el motivo y deja reintentar", async () => {
    stubZones([]);
    let attempt = 0;
    endpoint(`/api/v1/customers/${CUSTOMER_ID}`, (event: H3Event) => {
      attempt++;
      if (attempt === 1) {
        setResponseStatus(event, 500);
        return { message: "Base de datos no disponible" };
      }
      return baseCustomer();
    });

    await renderSuspended(App, { route: editRoute });

    expect((await screen.findByRole("alert")).textContent).toContain("Base de datos no disponible");
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Nombre")).toBeTruthy();
  });
});
