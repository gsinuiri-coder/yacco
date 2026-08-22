import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CustomerForm, emptyCustomerForm } from "./customer-form";

function renderForm() {
  return render(
    <CustomerForm
      initialValues={emptyCustomerForm()}
      submitLabel="Registrar cliente"
      isSubmitting={false}
      submitError={null}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("CustomerForm", () => {
  it("no expone el campo de zona: no existe módulo Zones que dé un valor válido", () => {
    renderForm();

    expect(screen.queryByLabelText(/zona/i)).not.toBeInTheDocument();
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
