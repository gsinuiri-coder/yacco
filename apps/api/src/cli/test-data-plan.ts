import { Weekday } from "@prisma/client";
import { businessDatesGoingBack } from "./seed-demo-plan.js";

/**
 * Qué carga `pnpm demo:prueba` (ítem K de docs/plan-final.md): los datos de
 * prueba con los que se ensaya la planta en la base LOCAL de Docker. Solo
 * datos; quien los escribe es test-data-seeder.ts, por los servicios de la
 * app.
 *
 * Todo lo que crea lleva «PRUEBA» en el nombre, para que la tarjeta «Puesta
 * en marcha» del Panel (ítem H) lo encuentre activo y pida retirarlo antes
 * de operar con datos reales.
 */

/** Precio de lista por nombre de producto, como los siembra seed-catalog.json. */
export const TEST_LIST_PRICES: Readonly<Record<string, string>> = {
  "Recarga 20L con caño": "8.00",
  "Recarga 20L sin caño": "8.00",
  "Bidón 20L con caño": "30.00",
  "Bidón 20L sin caño": "28.00",
};

export interface TestUserPlan {
  name: string;
  username: string;
  role: "DRIVER" | "SELLER";
}

export const TEST_DRIVER_1: TestUserPlan = {
  name: "PRUEBA Chofer 1",
  username: "prueba.chofer1",
  role: "DRIVER",
};

export const TEST_USERS: readonly TestUserPlan[] = [
  TEST_DRIVER_1,
  { name: "PRUEBA Chofer 2", username: "prueba.chofer2", role: "DRIVER" },
  { name: "PRUEBA Oficina", username: "prueba.oficina", role: "SELLER" },
];

export const TEST_ZONE_DAYS: Readonly<Record<string, Weekday[]>> = {
  Parque: [
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
    Weekday.SATURDAY,
  ],
  Surco: [Weekday.TUESDAY, Weekday.THURSDAY, Weekday.SATURDAY],
  "Casas Parque": [Weekday.WEDNESDAY, Weekday.SATURDAY],
};

/** Los dos tipos de envase, por el nombre de su producto de recarga. */
export type TestContainerKey = "CON_CANO" | "SIN_CANO";

export const REFILL_PRODUCT_BY_CONTAINER: Readonly<Record<TestContainerKey, string>> = {
  CON_CANO: "Recarga 20L con caño",
  SIN_CANO: "Recarga 20L sin caño",
};

/** «Ingreso de envases nuevos»: vacíos que entran a la planta. */
export const TEST_FLEET_ENTRY: Readonly<Record<TestContainerKey, number>> = {
  CON_CANO: 200,
  SIN_CANO: 100,
};

export const TEST_BATCH_CODE = "PRUEBA-LOTE-1";

export const TEST_BATCH: Readonly<Record<TestContainerKey, number>> = {
  CON_CANO: 120,
  SIN_CANO: 60,
};

export const TEST_CUSTOMER = {
  name: "PRUEBA Planta",
  phone: "000000000",
  address: "Planta Yacco (cliente de prueba)",
  addressReference: "No es un cliente real",
  zoneName: "Parque",
} as const;

/** El pedido del día: 4 recargas con caño y 1 sin caño, a precio de lista. */
export const TEST_ORDER: Readonly<Record<TestContainerKey, number>> = {
  CON_CANO: 4,
  SIN_CANO: 1,
};

/**
 * Lo que sube al camión: uno más de cada tipo que el pedido, para que la
 * liquidación tenga llenos que vuelven a la planta.
 */
export const TEST_TRUCK_LOAD: Readonly<Record<TestContainerKey, number>> = {
  CON_CANO: 5,
  SIN_CANO: 2,
};

/** Vacíos que el cliente devuelve en la entrega: le queda 1 con caño. */
export const TEST_EMPTIES_RETURNED: Readonly<Record<TestContainerKey, number>> = {
  CON_CANO: 3,
  SIN_CANO: 1,
};

/** Total del pedido 40.00: 20.00 en efectivo al chofer, 15.00 por Yape, queda 5.00 de deuda. */
export const TEST_CASH_AT_DELIVERY = "20.00";
export const TEST_YAPE_AMOUNT = "15.00";

/**
 * Clave de idempotencia fija del Yape: una segunda corrida devuelve el mismo
 * cobro en vez de crear otro (PaymentsService.createOfficePayment).
 */
export const TEST_YAPE_REQUEST_ID = "6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * La única barrera entre este script y una base con datos reales. Solo deja
 * pasar un Postgres en esta máquina (el de Docker, o el de Testcontainers en
 * los tests): Neon y cualquier otro host quedan afuera, y con ellos
 * producción. Nunca repite la URL en el mensaje: lleva la contraseña.
 */
export function assertLocalDatabaseUrl(databaseUrl: string | undefined): void {
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("Falta DATABASE_URL: este script solo corre contra la base local de Docker.");
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("DATABASE_URL no es una URL válida.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      "DATABASE_URL no apunta a esta máquina. Los datos de prueba se cargan solo " +
        "en la base local de Docker, nunca en Neon ni en producción.",
    );
  }
}

/** El día de hoy en Lima, AAAA-MM-DD, sin pasar por un Date en hora local. */
export function limaToday(now: Date): string {
  return businessDatesGoingBack(1, now)[0] as string;
}
