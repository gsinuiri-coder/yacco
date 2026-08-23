import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { ContainerType } from "../api/container-types";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import {
  ProductionBatchItemsForm,
  emptyProductionBatchItem,
  validateProductionBatchItem,
} from "./production-batch-items-form";
import type { ProductionBatchItemDraft } from "./production-batch-items-form";

function buildContainerType(overrides: Partial<ContainerType> = {}): ContainerType {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Bidón 20L con caño",
    active: true,
    ...overrides,
  };
}

function stubContainerTypes(containerTypes: ContainerType[]): void {
  server.use(http.get(`${API_BASE_URL}/container-types`, () => HttpResponse.json(containerTypes)));
}

function Harness({ initial }: { initial: ProductionBatchItemDraft[] }) {
  const [items, setItems] = useState<ProductionBatchItemDraft[]>(initial);
  return (
    <ProductionBatchItemsForm items={items} errors={[]} disabled={false} onChange={setItems} />
  );
}

describe("validateProductionBatchItem", () => {
  const valid: ProductionBatchItemDraft = { key: 0, containerTypeId: "ct1", producedQty: "200" };

  it("requiere un tipo de envase", () => {
    expect(validateProductionBatchItem({ ...valid, containerTypeId: "" })).toBe(
      "Elige un tipo de envase",
    );
  });

  it("requiere una cantidad entera mayor que 0", () => {
    expect(validateProductionBatchItem({ ...valid, producedQty: "0" })).toMatch(
      /entero mayor que 0/,
    );
    expect(validateProductionBatchItem({ ...valid, producedQty: "1.5" })).toMatch(
      /entero mayor que 0/,
    );
    expect(validateProductionBatchItem({ ...valid, producedQty: "mucho" })).toMatch(
      /entero mayor que 0/,
    );
  });

  it("topa la cantidad en MAX_ITEM_QUANTITY", () => {
    expect(validateProductionBatchItem({ ...valid, producedQty: "100001" })).toBe(
      "La cantidad producida no puede superar 100000",
    );
  });

  it("acepta una línea completa", () => {
    expect(validateProductionBatchItem(valid)).toBeUndefined();
  });
});

describe("ProductionBatchItemsForm", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn();
  });

  it("un tipo de envase ya elegido en otra línea no se vuelve a ofrecer", async () => {
    const user = userEvent.setup();
    const conCanio = buildContainerType({ id: "con-canio", name: "Con caño" });
    const sinCanio = buildContainerType({ id: "sin-canio", name: "Sin caño" });
    stubContainerTypes([conCanio, sinCanio]);

    renderWithProviders(
      <Harness initial={[emptyProductionBatchItem(0), emptyProductionBatchItem(1)]} />,
    );

    await user.selectOptions(await screen.findByLabelText("Tipo de envase (línea 1)"), conCanio.id);

    const secondLineSelect = screen.getByLabelText("Tipo de envase (línea 2)") as HTMLSelectElement;
    const optionLabels = Array.from(secondLineSelect.options).map((option) => option.textContent);
    expect(optionLabels).not.toContain("Con caño");
    expect(optionLabels).toContain("Sin caño");

    // La línea 1 sigue mostrando su propia selección entre sus opciones.
    const firstLineSelect = screen.getByLabelText("Tipo de envase (línea 1)") as HTMLSelectElement;
    expect(Array.from(firstLineSelect.options).map((option) => option.textContent)).toContain(
      "Con caño",
    );
  });

  it("agrega y quita líneas, pero nunca deja la lista vacía", async () => {
    const user = userEvent.setup();
    stubContainerTypes([buildContainerType()]);

    renderWithProviders(<Harness initial={[emptyProductionBatchItem(0)]} />);
    await screen.findByLabelText("Tipo de envase (línea 1)");

    expect(screen.getByRole("button", { name: "Quitar línea 1" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(screen.getByLabelText("Tipo de envase (línea 2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar línea 1" })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Quitar línea 2" }));
    expect(screen.queryByLabelText("Tipo de envase (línea 2)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar línea 1" })).toBeDisabled();
  });

  it("muestra un error de catálogo con reintento", async () => {
    server.use(
      http.get(`${API_BASE_URL}/container-types`, () =>
        HttpResponse.json({ message: "fallo" }, { status: 500 }),
      ),
    );

    renderWithProviders(<Harness initial={[emptyProductionBatchItem(0)]} />);
    expect(await screen.findByText("fallo")).toBeInTheDocument();

    stubContainerTypes([buildContainerType()]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByLabelText("Tipo de envase (línea 1)")).toBeInTheDocument();
  });
});
