import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { JsonBodyType } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { CustomerPrice, EffectivePrice } from "../api/customer-prices";
import type { Product } from "../api/products";
import { API_BASE_URL } from "../config";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { signIn } from "../test/session";
import { CustomerPricesSection } from "./customer-prices-section";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const PRICE_ID = "33333333-3333-4333-8333-333333333333";

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: PRODUCT_ID,
    name: "Recarga 20L",
    type: "REFILL",
    containerType: { id: "44444444-4444-4444-8444-444444444444", name: "Bidón 20L" },
    listPrice: "8.00",
    active: true,
    ...overrides,
  };
}

function buildPrice(overrides: Partial<CustomerPrice> = {}): CustomerPrice {
  return {
    id: PRICE_ID,
    product: { id: PRODUCT_ID, name: "Recarga 20L" },
    location: null,
    price: "7.00",
    ...overrides,
  };
}

function stubProducts(products: Product[]): void {
  server.use(http.get(`${API_BASE_URL}/products`, () => HttpResponse.json(products)));
}

function stubPrices(prices: CustomerPrice[]): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/prices`, () => HttpResponse.json(prices)),
  );
}

function stubEffectivePrices(items: EffectivePrice[]): void {
  server.use(
    http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/effective-prices`, () =>
      HttpResponse.json(items),
    ),
  );
}

/** Captures the JSON body of the POST so the test can assert the contract. */
function stubCreate(status = 201, payload?: JsonBodyType): { body: unknown } {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post(`${API_BASE_URL}/customers/${CUSTOMER_ID}/prices`, async ({ request }) => {
      captured.body = await request.json();
      return HttpResponse.json(payload, { status });
    }),
  );
  return captured;
}

describe("CustomerPricesSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("ADMIN", () => {
    beforeEach(() => signIn(["ADMIN"]));

    it("muestra la lista de precios pactados, con producto y precio", async () => {
      stubProducts([buildProduct()]);
      stubPrices([buildPrice()]);

      renderWithProviders(<CustomerPricesSection customerId={CUSTOMER_ID} isAdmin />);

      expect(await screen.findByText("Recarga 20L")).toBeInTheDocument();
      expect(screen.getByText("S/ 7.00")).toBeInTheDocument();
    });

    it("sin precios pactados, el estado vacío explica que rige el precio de lista", async () => {
      stubProducts([buildProduct()]);
      stubPrices([]);

      renderWithProviders(<CustomerPricesSection customerId={CUSTOMER_ID} isAdmin />);

      expect(await screen.findByText(/rige el precio de lista/)).toBeInTheDocument();
    });

    it("crea un precio: el POST manda price como string, y no prellena con el de lista", async () => {
      const user = userEvent.setup();
      stubProducts([buildProduct()]);
      stubPrices([]);
      const captured = stubCreate(201, buildPrice());

      renderWithProviders(<CustomerPricesSection customerId={CUSTOMER_ID} isAdmin />);
      await screen.findByText(/rige el precio de lista/);

      await user.click(screen.getByRole("button", { name: "Agregar precio" }));
      await user.selectOptions(screen.getByLabelText("Producto"), PRODUCT_ID);

      // Referencia visible, pero el campo del precio pactado sigue vacío.
      expect(screen.getByText("Precio de lista: S/ 8.00")).toBeInTheDocument();
      expect(screen.getByLabelText("Precio pactado")).toHaveValue("");

      await user.type(screen.getByLabelText("Precio pactado"), "7.00");
      await user.click(screen.getByRole("button", { name: "Guardar precio" }));

      await screen.findByText("Recarga 20L");
      expect(captured.body).toEqual({ productId: PRODUCT_ID, price: "7.00" });
      expect(typeof (captured.body as { price: unknown }).price).toBe("string");
    });

    it("un precio inválido bloquea el envío", async () => {
      const user = userEvent.setup();
      stubProducts([buildProduct()]);
      stubPrices([]);
      // Sin handler de POST: si el formulario llamara a la API, MSW haría fallar el test.

      renderWithProviders(<CustomerPricesSection customerId={CUSTOMER_ID} isAdmin />);
      await screen.findByText(/rige el precio de lista/);

      await user.click(screen.getByRole("button", { name: "Agregar precio" }));
      await user.selectOptions(screen.getByLabelText("Producto"), PRODUCT_ID);
      await user.type(screen.getByLabelText("Precio pactado"), "mucho");
      await user.click(screen.getByRole("button", { name: "Guardar precio" }));

      expect(await screen.findByText(/monto válido/)).toBeInTheDocument();
    });

    it("el duplicado del backend se muestra con su mensaje, tal cual", async () => {
      const user = userEvent.setup();
      stubProducts([buildProduct()]);
      stubPrices([]);
      stubCreate(409, {
        message: "Ya existe un precio pactado para este cliente y este producto",
      });

      renderWithProviders(<CustomerPricesSection customerId={CUSTOMER_ID} isAdmin />);
      await screen.findByText(/rige el precio de lista/);

      await user.click(screen.getByRole("button", { name: "Agregar precio" }));
      await user.selectOptions(screen.getByLabelText("Producto"), PRODUCT_ID);
      await user.type(screen.getByLabelText("Precio pactado"), "7.00");
      await user.click(screen.getByRole("button", { name: "Guardar precio" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Ya existe un precio pactado para este cliente y este producto",
      );
    });

    it("muestra un error al cargar los precios y permite reintentar", async () => {
      const user = userEvent.setup();
      stubProducts([buildProduct()]);
      let attempt = 0;
      server.use(
        http.get(`${API_BASE_URL}/customers/${CUSTOMER_ID}/prices`, () => {
          attempt += 1;
          if (attempt === 1) {
            return HttpResponse.json({ message: "Base de datos no disponible" }, { status: 500 });
          }
          return HttpResponse.json([]);
        }),
      );

      renderWithProviders(<CustomerPricesSection customerId={CUSTOMER_ID} isAdmin />);

      expect(await screen.findByRole("alert")).toHaveTextContent("Base de datos no disponible");

      await user.click(screen.getByRole("button", { name: "Reintentar" }));

      expect(await screen.findByText(/rige el precio de lista/)).toBeInTheDocument();
    });

    it("un fallo al guardar la edición muestra el error, sin perder la fila", async () => {
      const user = userEvent.setup();
      stubProducts([buildProduct()]);
      stubPrices([buildPrice({ price: "7.00" })]);
      server.use(
        http.patch(`${API_BASE_URL}/customers/${CUSTOMER_ID}/prices/${PRICE_ID}`, () =>
          HttpResponse.json({ message: "No se pudo guardar" }, { status: 500 }),
        ),
      );

      renderWithProviders(<CustomerPricesSection customerId={CUSTOMER_ID} isAdmin />);
      await screen.findByText("S/ 7.00");

      await user.click(screen.getByRole("button", { name: "Editar" }));
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
      // Stays in edit mode with the typed value, rather than reverting silently.
      expect(screen.getByLabelText("Precio de Recarga 20L")).toHaveValue("7.00");
    });

    it("edita un precio existente y actualiza la lista", async () => {
      const user = userEvent.setup();
      stubProducts([buildProduct()]);
      stubPrices([buildPrice({ price: "7.00" })]);
      server.use(
        http.patch(
          `${API_BASE_URL}/customers/${CUSTOMER_ID}/prices/${PRICE_ID}`,
          async ({ request }) => {
            const body = (await request.json()) as { price: string };
            return HttpResponse.json(buildPrice({ price: body.price }));
          },
        ),
      );

      renderWithProviders(<CustomerPricesSection customerId={CUSTOMER_ID} isAdmin />);
      await screen.findByText("S/ 7.00");

      await user.click(screen.getByRole("button", { name: "Editar" }));
      const input = screen.getByLabelText("Precio de Recarga 20L");
      await user.clear(input);
      await user.type(input, "6.50");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      expect(await screen.findByText("S/ 6.50")).toBeInTheDocument();
    });

    it("eliminar pide confirmación y solo entonces dispara el DELETE", async () => {
      const user = userEvent.setup();
      stubProducts([buildProduct()]);
      stubPrices([buildPrice()]);
      let deleteCount = 0;
      server.use(
        http.delete(`${API_BASE_URL}/customers/${CUSTOMER_ID}/prices/${PRICE_ID}`, () => {
          deleteCount++;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      renderWithProviders(<CustomerPricesSection customerId={CUSTOMER_ID} isAdmin />);
      await screen.findByText("Recarga 20L");

      await user.click(screen.getByRole("button", { name: "Eliminar" }));
      expect(deleteCount).toBe(0);
      expect(await screen.findByText(/Volverá a regir el precio de lista/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Sí, eliminar" }));

      await waitFor(() => expect(deleteCount).toBe(1));
      expect(await screen.findByText(/rige el precio de lista/)).toBeInTheDocument();
    });
  });

  describe("no ADMIN", () => {
    beforeEach(() => signIn(["SELLER"]));

    it("muestra los precios en solo lectura, sin controles de alta/edición/baja", async () => {
      stubEffectivePrices([
        { product: { id: PRODUCT_ID, name: "Recarga 20L" }, price: "7.00", source: "CUSTOMER" },
      ]);

      renderWithProviders(<CustomerPricesSection customerId={CUSTOMER_ID} isAdmin={false} />);

      expect(await screen.findByText("Recarga 20L")).toBeInTheDocument();
      expect(screen.getByText("S/ 7.00")).toBeInTheDocument();
      expect(screen.getByText("Pactado")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Agregar precio" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    });
  });
});
