import {
  agreedPrice,
  buildMarkBody,
  formatSoles,
  saleLineSubtotal,
  saleTotal,
  type MarkRouteStopBody,
  type RouteSnapshot,
  type RouteSnapshotLocation,
  type RouteSnapshotOrder,
  type SaleLineDraft,
} from "@yacco/shared";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { deliveryEffect, exceedsCreditLimit } from "../offline/delivery-effect";
import { styles } from "../theme";

export type DeliveryCatalog = Pick<RouteSnapshot, "products" | "containerTypes" | "paymentMethods">;

/** Lo que la entrega necesita de la ruta guardada en el celular. */
export interface StopDeliveryContext {
  location: RouteSnapshotLocation;
  /** El pedido de la parada, si salió de uno: se precarga para confirmar. */
  order: RouteSnapshotOrder | null;
  catalog: DeliveryCatalog;
  /** La deuda del cliente antes de esta entrega, con lo que el celular todavía no mandó. */
  debtBefore: string;
}

interface StopDeliveryFormProps extends StopDeliveryContext {
  onSave: (body: MarkRouteStopBody) => Promise<void>;
  onCancel: () => void;
}

/**
 * «Se entregó», como el formulario de «Mi ruta» en la web con las mismas
 * reglas (buildMarkBody de @yacco/shared): el chofer cobra el precio pactado
 * y no lo cambia (supuesto 12), así que el precio nunca se escribe.
 */
export function StopDeliveryForm({
  location,
  order,
  catalog,
  debtBefore,
  onSave,
  onCancel,
}: StopDeliveryFormProps) {
  const [items, setItems] = useState<SaleLineDraft[]>(() =>
    (order?.items ?? []).map((item, index) => ({
      key: index,
      productId: item.product.id,
      quantity: String(item.quantity),
      unitPrice: "",
    })),
  );
  const [nextKey, setNextKey] = useState(order?.items.length ?? 0);
  const [choosing, setChoosing] = useState(false);
  const [returns, setReturns] = useState<Record<string, string>>({});
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const names = new Map<string, string>();
  for (const item of order?.items ?? []) names.set(item.product.id, item.product.name);
  for (const product of catalog.products) names.set(product.id, product.name);

  const draft = {
    outcome: "DELIVERED" as const,
    failureReason: "",
    items,
    returns: Object.entries(returns)
      .filter(([, quantity]) => quantity.trim() !== "" && quantity.trim() !== "0")
      .map(([containerTypeId, quantity], key) => ({ key, containerTypeId, quantity })),
    paymentMethodId,
    amount,
    authorizerId: "",
  };
  const body = buildMarkBody(draft, location.prices);
  const total = saleTotal(items, location.prices);
  const overLimit =
    typeof body !== "string" &&
    exceedsCreditLimit(location, debtBefore, deliveryEffect(catalog, location, body).debtDelta);

  function edit(change: () => void): void {
    change();
    setError(null);
  }

  function addProduct(productId: string): void {
    edit(() => {
      setItems([...items, { key: nextKey, productId, quantity: "1", unitPrice: "" }]);
      setNextKey(nextKey + 1);
      setChoosing(false);
    });
  }

  async function save(): Promise<void> {
    if (typeof body === "string") {
      setError(body);
      return;
    }
    setSaving(true);
    try {
      await onSave(body);
    } catch {
      setError("No se pudo guardar en el celular. Inténtalo de nuevo.");
      setSaving(false);
    }
  }

  return (
    <View>
      <Text style={styles.label}>Lo que se entregó</Text>
      {items.map((line) => {
        const name = names.get(line.productId) ?? line.productId;
        const agreed = agreedPrice(location.prices, line.productId);
        const subtotal = saleLineSubtotal(line, agreed);
        return (
          <View key={line.key} style={styles.card}>
            <Text style={styles.label}>{name}</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel={`Cantidad de ${name}`}
              keyboardType="number-pad"
              value={line.quantity}
              onChangeText={(quantity) =>
                edit(() =>
                  setItems(
                    items.map((other) => (other.key === line.key ? { ...other, quantity } : other)),
                  ),
                )
              }
            />
            <Text>
              {agreed === null ? "Sin precio pactado" : `Precio pactado: ${formatSoles(agreed)}`}
              {subtotal === null ? "" : ` · Subtotal: ${formatSoles(subtotal)}`}
            </Text>
            <Pressable
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel={`Quitar ${name}`}
              onPress={() => edit(() => setItems(items.filter((other) => other.key !== line.key)))}
            >
              <Text style={styles.secondaryButtonText}>Quitar</Text>
            </Pressable>
          </View>
        );
      })}
      {choosing ? (
        catalog.products.map((product) => (
          <Pressable
            key={product.id}
            style={styles.secondaryButton}
            accessibilityRole="button"
            onPress={() => addProduct(product.id)}
          >
            <Text style={styles.secondaryButtonText}>{product.name}</Text>
          </Pressable>
        ))
      ) : (
        <Pressable
          style={styles.secondaryButton}
          accessibilityRole="button"
          onPress={() => setChoosing(true)}
        >
          <Text style={styles.secondaryButtonText}>Agregar producto</Text>
        </Pressable>
      )}
      <Text style={styles.label}>Total de la venta: {formatSoles(total)}</Text>

      <Text style={styles.label}>Envases vacíos que devolvió</Text>
      {catalog.containerTypes.map((type) => (
        <TextInput
          key={type.id}
          style={styles.input}
          accessibilityLabel={`Vacíos devueltos de ${type.name}`}
          placeholder={`Vacíos de ${type.name}`}
          keyboardType="number-pad"
          value={returns[type.id] ?? ""}
          onChangeText={(quantity) => edit(() => setReturns({ ...returns, [type.id]: quantity }))}
        />
      ))}

      <Text style={styles.label}>Cobro</Text>
      {[{ id: "", name: "No cobró nada (queda al fiado)" }, ...catalog.paymentMethods].map(
        (method) => (
          <Pressable
            key={method.id}
            style={paymentMethodId === method.id ? styles.button : styles.secondaryButton}
            accessibilityRole="radio"
            accessibilityState={{ checked: paymentMethodId === method.id }}
            onPress={() => edit(() => setPaymentMethodId(method.id))}
          >
            <Text
              style={paymentMethodId === method.id ? styles.buttonText : styles.secondaryButtonText}
            >
              {method.name}
            </Text>
          </Pressable>
        ),
      )}
      {paymentMethodId !== "" && (
        <TextInput
          style={styles.input}
          accessibilityLabel="Monto cobrado"
          placeholder={total}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={(text) => edit(() => setAmount(text))}
        />
      )}

      {overLimit && (
        <Text style={styles.notice}>
          Esta venta supera el límite de crédito de {location.name}. Se guarda igual.
        </Text>
      )}
      {error !== null && (
        <Text style={styles.alert} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        disabled={saving}
        onPress={() => void save()}
      >
        <Text style={styles.buttonText}>Guardar la entrega</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} accessibilityRole="button" onPress={onCancel}>
        <Text style={styles.secondaryButtonText}>Cancelar</Text>
      </Pressable>
    </View>
  );
}
