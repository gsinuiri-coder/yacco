import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  createCustomerPrice,
  deleteCustomerPrice,
  listCustomerPrices,
  listEffectivePrices,
  updateCustomerPrice,
} from "../api/customer-prices";
import type { CustomerPrice, EffectivePrice } from "../api/customer-prices";
import { listProducts } from "../api/products";
import type { Product } from "../api/products";
import { useAuth } from "../auth/use-auth";
import { formatMoney, isValidMoney } from "../lib/money";
import { ErrorState } from "./error-state";

export interface CustomerPricesSectionProps {
  customerId: string;
  /** Management (create/edit/delete) is ADMIN-only — the backend enforces
   * this; hiding the controls here is only UI clarity, not the security
   * boundary. A non-ADMIN reads `effective-prices` instead of the
   * management list below, since the API refuses the latter to a SELLER. */
  isAdmin: boolean;
}

/** ADMIN view: only the agreed (customer-wide) prices, with full CRUD. */
export function CustomerPricesSection({ customerId, isAdmin }: CustomerPricesSectionProps) {
  const { apiClient } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<CustomerPrice[]>([]);
  const [effectivePrices, setEffectivePrices] = useState<EffectivePrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [isAddingPrice, setIsAddingPrice] = useState(false);
  const [newProductId, setNewProductId] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSavingAction, setIsSavingAction] = useState(false);

  useEffect(() => {
    let ignore = false;
    setIsLoading(true);
    setLoadError(null);

    const handleError = (error: unknown) => {
      if (ignore) return;
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los precios.");
    };
    const handleDone = () => {
      if (!ignore) setIsLoading(false);
    };

    if (isAdmin) {
      Promise.all([listProducts(apiClient), listCustomerPrices(apiClient, customerId)])
        .then(([productList, priceList]) => {
          if (ignore) return;
          setProducts(productList);
          setPrices(priceList);
        })
        .catch(handleError)
        .finally(handleDone);
    } else {
      listEffectivePrices(apiClient, customerId)
        .then((priceList) => {
          if (!ignore) setEffectivePrices(priceList);
        })
        .catch(handleError)
        .finally(handleDone);
    }

    return () => {
      ignore = true;
    };
  }, [apiClient, customerId, isAdmin, reloadToken]);

  const selectedNewProduct = products.find((product) => product.id === newProductId) ?? null;

  function handleStartAdd() {
    setIsAddingPrice(true);
    setNewProductId("");
    setNewPrice("");
    setCreateError(null);
  }

  function handleCancelAdd() {
    setIsAddingPrice(false);
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;
    if (newProductId === "") {
      setCreateError("Elige un producto");
      return;
    }
    if (!isValidMoney(newPrice.trim())) {
      setCreateError('El precio debe ser un monto válido, como "12.50"');
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    createCustomerPrice(apiClient, customerId, { productId: newProductId, price: newPrice.trim() })
      .then((created) => {
        setPrices((current) => [...current, created]);
        setIsAddingPrice(false);
      })
      .catch((error: unknown) => {
        // The backend's message names the concrete product ("ya existe un
        // precio para..."); shown verbatim so it never drifts from the
        // message the API actually maintains.
        setCreateError(error instanceof Error ? error.message : "No se pudo pactar el precio.");
      })
      .finally(() => setIsCreating(false));
  }

  function handleStartEdit(price: CustomerPrice) {
    setEditingId(price.id);
    setEditPrice(price.price);
    setActionError(null);
  }

  function handleCancelEdit() {
    setEditingId(null);
  }

  function handleSaveEdit(priceId: string) {
    if (isSavingAction) return;
    if (!isValidMoney(editPrice.trim())) {
      setActionError('El precio debe ser un monto válido, como "12.50"');
      return;
    }

    setIsSavingAction(true);
    setActionError(null);
    updateCustomerPrice(apiClient, customerId, priceId, { price: editPrice.trim() })
      .then((updated) => {
        setPrices((current) => current.map((price) => (price.id === priceId ? updated : price)));
        setEditingId(null);
      })
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : "No se pudo actualizar el precio.");
      })
      .finally(() => setIsSavingAction(false));
  }

  function handleStartDelete(priceId: string) {
    setConfirmingDeleteId(priceId);
    setActionError(null);
  }

  function handleCancelDelete() {
    setConfirmingDeleteId(null);
  }

  function handleConfirmDelete(priceId: string) {
    if (isSavingAction) return;
    setIsSavingAction(true);
    setActionError(null);
    deleteCustomerPrice(apiClient, customerId, priceId)
      .then(() => {
        setPrices((current) => current.filter((price) => price.id !== priceId));
        setConfirmingDeleteId(null);
      })
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : "No se pudo eliminar el precio.");
      })
      .finally(() => setIsSavingAction(false));
  }

  return (
    <section className="card">
      <div className="card__body">
        <div className="page-header">
          <h2>Precios pactados</h2>
          {isAdmin && !isAddingPrice && (
            <button
              type="button"
              className="button button--secondary"
              onClick={handleStartAdd}
              disabled={isLoading}
            >
              Agregar precio
            </button>
          )}
        </div>

        {loadError ? (
          <ErrorState message={loadError} onRetry={() => setReloadToken((token) => token + 1)} />
        ) : isLoading ? (
          <p className="state" role="status">
            Cargando precios…
          </p>
        ) : isAdmin ? (
          <>
            {createError && (
              <div className="notice notice--error" role="alert">
                {createError}
              </div>
            )}
            {actionError && (
              <div className="notice notice--error" role="alert">
                {actionError}
              </div>
            )}

            {isAddingPrice && (
              <form className="form-grid" onSubmit={handleCreate} noValidate>
                <div className="field">
                  <label className="field__label" htmlFor="newPriceProduct">
                    Producto
                  </label>
                  <select
                    id="newPriceProduct"
                    value={newProductId}
                    disabled={isCreating}
                    onChange={(event) => setNewProductId(event.target.value)}
                  >
                    <option value="">Selecciona un producto</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="newPriceValue">
                    Precio pactado
                  </label>
                  <input
                    id="newPriceValue"
                    type="text"
                    inputMode="decimal"
                    placeholder="12.50"
                    value={newPrice}
                    disabled={isCreating}
                    onChange={(event) => setNewPrice(event.target.value)}
                  />
                  {selectedNewProduct && (
                    <span className="field__hint">
                      Precio de lista: {formatMoney(selectedNewProduct.listPrice)}
                    </span>
                  )}
                </div>
                <div className="form-actions form-grid__full">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={handleCancelAdd}
                    disabled={isCreating}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="button button--primary" disabled={isCreating}>
                    {isCreating ? "Guardando…" : "Guardar precio"}
                  </button>
                </div>
              </form>
            )}

            {prices.length === 0 ? (
              <p className="state">
                Este cliente no tiene precios pactados: rige el precio de lista para todos sus
                productos.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <caption className="visually-hidden">Precios pactados del cliente</caption>
                  <thead>
                    <tr>
                      <th scope="col">Producto</th>
                      <th scope="col" className="table__numeric">
                        Precio
                      </th>
                      <th scope="col" className="table__actions">
                        <span className="visually-hidden">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {prices.map((price) => (
                      <tr key={price.id}>
                        <td>{price.product.name}</td>
                        <td className="table__numeric">
                          {editingId === price.id ? (
                            <input
                              aria-label={`Precio de ${price.product.name}`}
                              type="text"
                              inputMode="decimal"
                              value={editPrice}
                              disabled={isSavingAction}
                              onChange={(event) => setEditPrice(event.target.value)}
                            />
                          ) : (
                            formatMoney(price.price)
                          )}
                        </td>
                        <td className="table__actions">
                          {confirmingDeleteId === price.id ? (
                            <span>
                              ¿Eliminar? Volverá a regir el precio de lista.{" "}
                              <button
                                type="button"
                                className="button button--secondary"
                                onClick={handleCancelDelete}
                                disabled={isSavingAction}
                              >
                                No
                              </button>{" "}
                              <button
                                type="button"
                                className="button button--primary"
                                onClick={() => handleConfirmDelete(price.id)}
                                disabled={isSavingAction}
                              >
                                {isSavingAction ? "Eliminando…" : "Sí, eliminar"}
                              </button>
                            </span>
                          ) : editingId === price.id ? (
                            <>
                              <button
                                type="button"
                                className="button button--secondary"
                                onClick={handleCancelEdit}
                                disabled={isSavingAction}
                              >
                                Cancelar
                              </button>{" "}
                              <button
                                type="button"
                                className="button button--primary"
                                onClick={() => handleSaveEdit(price.id)}
                                disabled={isSavingAction}
                              >
                                {isSavingAction ? "Guardando…" : "Guardar"}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="button button--ghost"
                                onClick={() => handleStartEdit(price)}
                              >
                                Editar
                              </button>{" "}
                              <button
                                type="button"
                                className="button button--ghost"
                                onClick={() => handleStartDelete(price.id)}
                              >
                                Eliminar
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Precios efectivos del cliente</caption>
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col" className="table__numeric">
                    Precio
                  </th>
                  <th scope="col">Origen</th>
                </tr>
              </thead>
              <tbody>
                {effectivePrices.map((item) => (
                  <tr key={item.product.id}>
                    <td>{item.product.name}</td>
                    <td className="table__numeric">{formatMoney(item.price)}</td>
                    <td>
                      {item.source === "LIST" ? (
                        <span className="cell-secondary">Precio de lista</span>
                      ) : (
                        <span className="badge badge--info">Pactado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
