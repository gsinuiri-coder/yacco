import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { listCustomerLocations } from "../api/customer-locations";
import type { CustomerLocation } from "../api/customer-locations";
import type { Customer } from "../api/customers";
import { listOrders } from "../api/orders";
import type { Order } from "../api/orders";
import { addRouteStop } from "../api/routes";
import { useAuth } from "../auth/use-auth";
import { formatBusinessDate } from "../lib/business-date";
import { formatMoney } from "../lib/money";
import { CustomerSelect } from "./customer-select";
import { FormSubmitFooter } from "./form-submit-footer";

/** De dónde sale la parada, en el vocabulario de la planta. */
type StopSource = "ORDER" | "VAN_SALE";

/**
 * Tope de la API (MAX_LIMIT en list-orders-query.dto.ts). Un selector no
 * pagina, así que si hay más pendientes que esto el formulario lo dice en vez
 * de recortar en silencio.
 */
const ORDERS_LIMIT = 100;

export interface RouteStopFormProps {
  routeId: string;
  onCancel: () => void;
  /** La parada se agregó; quien llama recarga la ruta desde la API. */
  onAdded: () => void;
}

/**
 * Agregar una parada a la ruta, por los dos caminos que el dominio reconoce:
 * un pedido tomado por adelantado (preventa) o un cliente al que se le vende
 * en la calle (autoventa).
 *
 * La lista de pedidos pide `status=PENDING&hasRouteStop=false`, que es
 * exactamente lo que `POST /routes/:id/stops` acepta: así el selector nunca
 * ofrece una opción que va a fallar al hacer clic.
 */
export function RouteStopForm({ routeId, onCancel, onAdded }: RouteStopFormProps) {
  const { apiClient } = useAuth();

  const [source, setSource] = useState<StopSource>("ORDER");

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [locations, setLocations] = useState<CustomerLocation[]>([]);
  const [locationId, setLocationId] = useState("");

  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingOrders(true);
    setOrdersError(null);

    listOrders(apiClient, { status: "PENDING", hasRouteStop: false, limit: ORDERS_LIMIT })
      .then((response) => {
        if (cancelled) return;
        setOrders(response.data);
        setOrdersTotal(response.total);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setOrdersError(
          error instanceof Error ? error.message : "No se pudieron cargar los pedidos pendientes.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOrders(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  // Las ubicaciones del cliente elegido, de su propio endpoint. Un cliente
  // tiene una principal y a veces alguna más; se preselecciona la primera
  // para que el caso normal sea un solo clic.
  useEffect(() => {
    if (customer === null) {
      setLocations([]);
      setLocationId("");
      return;
    }
    let cancelled = false;
    listCustomerLocations(apiClient, customer.id)
      .then((response) => {
        if (cancelled) return;
        setLocations(response);
        setLocationId(response[0]?.id ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setLocations([]);
        setLocationId("");
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, customer]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    if (source === "ORDER" && orderId === "") {
      setValidationError("Elige el pedido que va a entregar el chofer");
      return;
    }
    if (source === "VAN_SALE" && locationId === "") {
      setValidationError("Elige el cliente y la dirección a la que va el chofer");
      return;
    }

    setValidationError(null);
    setIsSubmitting(true);
    setSubmitError(null);
    addRouteStop(
      apiClient,
      routeId,
      source === "ORDER" ? { origin: "ORDER", orderId } : { origin: "VAN_SALE", locationId },
    )
      .then(() => onAdded())
      .catch((error: unknown) => {
        // El 400 de la API nombra el problema concreto (pedido ya asignado,
        // ubicación inexistente); se muestra tal cual.
        setSubmitError(error instanceof Error ? error.message : "No se pudo agregar la parada.");
        setIsSubmitting(false);
      });
  }

  const hasNoPendingOrders = !isLoadingOrders && ordersError === null && orders.length === 0;

  return (
    <form className="card__body" onSubmit={handleSubmit} noValidate aria-label="Agregar parada">
      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="stopSource">
            ¿De dónde sale la parada?
          </label>
          <select
            id="stopSource"
            value={source}
            disabled={isSubmitting}
            onChange={(event) => {
              setSource(event.target.value as StopSource);
              setValidationError(null);
            }}
          >
            <option value="ORDER">De un pedido ya tomado</option>
            <option value="VAN_SALE">Autoventa: un cliente sin pedido</option>
          </select>
        </div>

        {source === "ORDER" ? (
          <div className="field form-grid__full">
            <label className="field__label" htmlFor="stopOrder">
              Pedido pendiente
            </label>
            <select
              id="stopOrder"
              value={orderId}
              disabled={isSubmitting || isLoadingOrders || hasNoPendingOrders}
              onChange={(event) => {
                setOrderId(event.target.value);
                setValidationError(null);
              }}
            >
              <option value="">
                {isLoadingOrders
                  ? "Cargando pedidos…"
                  : hasNoPendingOrders
                    ? "No hay pedidos pendientes sin asignar"
                    : "Elige un pedido"}
              </option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {describeOrder(order)}
                </option>
              ))}
            </select>
            {ordersError && (
              <span className="field__error">
                No se pudieron cargar los pedidos pendientes: {ordersError}
              </span>
            )}
            {hasNoPendingOrders && (
              <span className="field__hint">
                Todos los pedidos pendientes ya están en una ruta. Usa autoventa para agregar un
                cliente sin pedido.
              </span>
            )}
            {ordersTotal > orders.length && (
              <span className="field__hint">
                Se muestran los {orders.length} pedidos con entrega más próxima, de {ordersTotal}{" "}
                pendientes sin asignar.
              </span>
            )}
          </div>
        ) : (
          <>
            <div className="form-grid__full">
              <CustomerSelect
                id="stopCustomer"
                label="Cliente"
                value={customer}
                onChange={(next) => {
                  setCustomer(next);
                  setValidationError(null);
                }}
              />
            </div>
            <div className="field form-grid__full">
              <label className="field__label" htmlFor="stopLocation">
                Dirección de entrega
              </label>
              <select
                id="stopLocation"
                value={locationId}
                disabled={isSubmitting || customer === null || locations.length === 0}
                onChange={(event) => {
                  setLocationId(event.target.value);
                  setValidationError(null);
                }}
              >
                <option value="">
                  {customer === null ? "Elige un cliente primero" : "Elige una dirección"}
                </option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} · {location.address}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <FormSubmitFooter
        validationError={validationError}
        submitError={submitError}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel="Agregar parada"
        submittingLabel="Agregando…"
      />
    </form>
  );
}

/** Lo mínimo para reconocer el pedido en una lista: quién, cuándo y cuánto. */
function describeOrder(order: Order): string {
  const items = order.items.map((item) => `${item.quantity}× ${item.product.name}`).join(", ");
  return `${order.customer.name} · entrega ${formatBusinessDate(order.deliveryDate)} · ${items} · ${formatMoney(order.total)}`;
}
