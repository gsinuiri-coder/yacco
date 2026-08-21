import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { CustomerCreatePage } from "./customer-create-page";

function renderCreate() {
  return renderWithProviders(
    <Routes>
      <Route path="/customers/new" element={<CustomerCreatePage />} />
      <Route path="/customers" element={<h1>Clientes</h1>} />
    </Routes>,
    "/customers/new",
  );
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre"), "Bodega Santa Rosa");
  await user.type(screen.getByLabelText("Teléfono"), "987654321");
  await user.type(screen.getByLabelText("Dirección"), "Av. Los Alamos 452");
  await user.type(screen.getByLabelText("Referencia"), "Portón azul");
}

/** Captures the JSON body of the POST so the test can assert the contract. */
function stubCreate(status = 201, payload?: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post(`${API_BASE_URL}/customers`, async ({ request }) => {
      captured.body = await request.json();
      if (status >= 400) {
        return HttpResponse.json(payload, { status });
      }
      return HttpResponse.json(payload ?? { id: "new-id" }, { status });
    }),
  );
  return captured;
}

describe("CustomerCreatePage", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("envía solo los campos del contrato y vuelve a la lista", async () => {
    const user = userEvent.setup();
    const captured = stubCreate();

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo cliente" });
    await fillRequiredFields(user);
    await user.type(screen.getByLabelText("Límite de crédito (opcional)"), "150.00");

    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    expect(await screen.findByRole("heading", { name: "Clientes" })).toBeInTheDocument();
    expect(captured.body).toEqual({
      name: "Bodega Santa Rosa",
      phone: "987654321",
      address: "Av. Los Alamos 452",
      addressReference: "Portón azul",
      creditLimit: "150.00",
    });
    // debtBalance is read-only: the API rejects a body that carries it.
    expect(captured.body).not.toHaveProperty("debtBalance");
  });

  it("omite los opcionales en blanco en vez de mandarlos vacíos", async () => {
    const user = userEvent.setup();
    const captured = stubCreate();

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo cliente" });
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    await screen.findByRole("heading", { name: "Clientes" });
    // zoneId: "" would fail the API's @IsUUID and turn a blank field into a 400.
    expect(captured.body).not.toHaveProperty("zoneId");
    expect(captured.body).not.toHaveProperty("creditLimit");
  });

  it("manda el límite de crédito como string, no como número", async () => {
    const user = userEvent.setup();
    const captured = stubCreate();

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo cliente" });
    await fillRequiredFields(user);
    await user.type(screen.getByLabelText("Límite de crédito (opcional)"), "0.30");

    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    await screen.findByRole("heading", { name: "Clientes" });
    const body = captured.body as { creditLimit: unknown };
    expect(typeof body.creditLimit).toBe("string");
    expect(body.creditLimit).toBe("0.30");
  });

  it("valida en el cliente antes de llamar a la API", async () => {
    const user = userEvent.setup();
    // No POST handler: if the page called the API, MSW would fail the test.
    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo cliente" });

    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    expect(await screen.findByText("El nombre es obligatorio")).toBeInTheDocument();
    expect(screen.getByText("El teléfono es obligatorio")).toBeInTheDocument();
    expect(screen.getByText("La dirección es obligatoria")).toBeInTheDocument();
    expect(screen.getByText("La referencia de dirección es obligatoria")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nuevo cliente" })).toBeInTheDocument();
  });

  it("rechaza un límite de crédito que la API rechazaría, sin llamarla", async () => {
    const user = userEvent.setup();

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo cliente" });
    await fillRequiredFields(user);
    await user.type(screen.getByLabelText("Límite de crédito (opcional)"), "mucho");

    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    expect(
      await screen.findByText('El límite de crédito debe ser un monto como "150.00"'),
    ).toBeInTheDocument();
  });

  it("muestra el 400 de la API en vez de tragárselo", async () => {
    const user = userEvent.setup();
    stubCreate(400, { message: ["El teléfono no puede superar los 30 caracteres"] });

    renderCreate();
    await screen.findByRole("heading", { name: "Nuevo cliente" });
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El teléfono no puede superar los 30 caracteres",
    );
    // Still on the form, with the values intact, so the user can fix them.
    expect(screen.getByLabelText("Nombre")).toHaveValue("Bodega Santa Rosa");
  });
});
