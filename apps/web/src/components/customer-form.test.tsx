import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ZoneOption } from "./customer-form";
import { CustomerForm, emptyCustomerForm } from "./customer-form";

const NORTE: ZoneOption = { id: "11111111-1111-4111-8111-111111111111", name: "Norte" };
const SUR: ZoneOption = { id: "22222222-2222-4222-8222-222222222222", name: "Sur" };

function renderForm(zones: ZoneOption[] = [], onSubmit = vi.fn()) {
  render(
    <CustomerForm
      initialValues={emptyCustomerForm()}
      submitLabel="Registrar cliente"
      isSubmitting={false}
      submitError={null}
      zones={zones}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  return onSubmit;
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre"), "Bodega Santa Rosa");
  await user.type(screen.getByLabelText("Teléfono"), "987654321");
  await user.type(screen.getByLabelText("Dirección"), "Av. Los Alamos 452");
  await user.type(screen.getByLabelText("Referencia"), "Portón azul");
}

describe("CustomerForm", () => {
  it("el campo de zona ofrece 'Sin zona' primero y luego el catálogo dado", () => {
    renderForm([NORTE, SUR]);

    const select = screen.getByLabelText("Zona (opcional)");
    const options = within(select).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Sin zona", "Norte", "Sur"]);
  });

  it("sin elegir zona, el envío manda zoneId vacío (sin zona)", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm([NORTE]);
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ zoneId: "" }));
  });

  it("elegir una zona la manda en los valores del envío", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm([NORTE, SUR]);
    await fillRequiredFields(user);

    await user.selectOptions(screen.getByLabelText("Zona (opcional)"), SUR.id);
    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ zoneId: SUR.id }));
  });

  it("un error de validación desaparece al corregir ese campo, sin volver a enviar", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));
    expect(await screen.findByText("El nombre es obligatorio")).toBeInTheDocument();

    // Corrige el campo sin tocar el botón de enviar de nuevo.
    await user.type(screen.getByLabelText("Nombre"), "Bodega Santa Rosa");

    expect(screen.queryByText("El nombre es obligatorio")).not.toBeInTheDocument();
  });

  it("corregir un campo no borra los errores de los demás que siguen mal", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Registrar cliente" }));
    expect(await screen.findByText("El nombre es obligatorio")).toBeInTheDocument();
    expect(screen.getByText("El teléfono es obligatorio")).toBeInTheDocument();
    expect(screen.getByText("La dirección es obligatoria")).toBeInTheDocument();
    expect(screen.getByText("La referencia de dirección es obligatoria")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre"), "Bodega Santa Rosa");

    expect(screen.queryByText("El nombre es obligatorio")).not.toBeInTheDocument();
    expect(screen.getByText("El teléfono es obligatorio")).toBeInTheDocument();
    expect(screen.getByText("La dirección es obligatoria")).toBeInTheDocument();
    expect(screen.getByText("La referencia de dirección es obligatoria")).toBeInTheDocument();
  });
});
