import {
  formatDebtBalance,
  type MarkRouteStopBody,
  type NamedReference,
  type RouteStop,
  type StopMarkPayloadV1,
  type StopStatus,
} from "@yacco/shared";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { QUEUED_OPERATION_STATE_LABELS, type QueuedOperation } from "../offline/offline-store";
import { styles } from "../theme";
import { StopDeliveryForm, type StopDeliveryContext } from "./StopDeliveryForm";

/** Las mismas palabras que la web (route-status.ts). */
export const STOP_STATUS_LABELS: Record<StopStatus, string> = {
  PENDING: "Pendiente",
  DELIVERED: "Entregada",
  FAILED: "No entregada",
};

interface StopCardProps {
  stop: RouteStop;
  /** La última marca de esta parada que hizo el celular, si hizo alguna. */
  queued: QueuedOperation | null;
  /** La ruta está en curso: recién ahí se marcan paradas, igual que en la web. */
  canMark: boolean;
  /** Sin el local en la ruta guardada no hay precios ni saldos: no se ofrece «Se entregó». */
  delivery: StopDeliveryContext | null;
  /** Los saldos con lo que el celular marcó y la ruta guardada todavía no cuenta. */
  balances: StopBalances | null;
  onDeliver: (body: MarkRouteStopBody) => Promise<void>;
  onFail: (failureReason: string) => Promise<void>;
}

export interface StopBalances {
  /** La deuda en S/ del cliente, una sola aunque tenga varios locales. */
  debt: string;
  /** Los envases que tiene ESTE local, por tipo. */
  containers: { containerType: NamedReference; quantity: number }[];
}

type Mode = "idle" | "delivering" | "failing";

function containersLine(containers: StopBalances["containers"]): string {
  if (containers.length === 0) return "Envases en el local: ninguno";
  const counts = containers.map((line) => `${line.quantity} ${line.containerType.name}`);
  return `Envases en el local: ${counts.join(", ")}`;
}

function statusLine(stop: RouteStop, queued: QueuedOperation | null): string {
  const origin = stop.origin === "VAN_SALE" ? " · Venta en ruta" : "";
  if (queued === null) return `${STOP_STATUS_LABELS[stop.status]}${origin}`;
  const label = QUEUED_OPERATION_STATE_LABELS[queued.state];
  // En revisión gana el servidor: la parada queda como la tiene la oficina.
  const shown =
    queued.state === "IN_REVIEW"
      ? stop.status
      : (queued.envelope.payload as unknown as StopMarkPayloadV1).status;
  return `${STOP_STATUS_LABELS[shown]}${origin} · ${label}`;
}

export function StopCard({
  stop,
  queued,
  canMark,
  delivery,
  balances,
  onDeliver,
  onFail,
}: StopCardProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const markable = canMark && stop.status === "PENDING" && queued === null;

  async function save(): Promise<void> {
    const failureReason = reason.trim();
    if (failureReason === "") {
      setError("Escribe por qué no se pudo entregar");
      return;
    }
    setSaving(true);
    try {
      await onFail(failureReason);
      setMode("idle");
    } catch {
      setError("No se pudo guardar en el celular. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card} accessibilityLabel={`Parada ${stop.position}`}>
      <Text style={styles.label}>
        {stop.position}. {stop.location.name}
      </Text>
      <Text>{stop.location.customer.name}</Text>
      <Text>{stop.location.address}</Text>
      {balances !== null && (
        <>
          <Text>Deuda del cliente: {formatDebtBalance(balances.debt)}</Text>
          <Text>{containersLine(balances.containers)}</Text>
        </>
      )}
      <Text>{statusLine(stop, queued)}</Text>
      {queued?.state === "IN_REVIEW" && queued.reason !== null && <Text>{queued.reason}</Text>}

      {markable && mode === "idle" && (
        <View>
          {delivery !== null && (
            <Pressable
              style={styles.button}
              accessibilityRole="button"
              onPress={() => setMode("delivering")}
            >
              <Text style={styles.buttonText}>Se entregó</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.secondaryButton}
            accessibilityRole="button"
            onPress={() => setMode("failing")}
          >
            <Text style={styles.secondaryButtonText}>No se pudo entregar</Text>
          </Pressable>
        </View>
      )}

      {markable && mode === "delivering" && delivery !== null && (
        <StopDeliveryForm {...delivery} onSave={onDeliver} onCancel={() => setMode("idle")} />
      )}

      {markable && mode === "failing" && (
        <View>
          <TextInput
            style={styles.input}
            accessibilityLabel="Por qué no se pudo entregar"
            placeholder="Por qué no se pudo entregar"
            value={reason}
            onChangeText={(text) => {
              setReason(text);
              setError(null);
            }}
          />
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
            <Text style={styles.buttonText}>Guardar</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            accessibilityRole="button"
            onPress={() => {
              setMode("idle");
              setError(null);
            }}
          >
            <Text style={styles.secondaryButtonText}>Cancelar</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
