import { describe, it } from "vitest";
import { expectNativeNuxtUi } from "../support/nuxt-ui-guard";

const RECEIPT_TEMPLATES = [
  "../../app/pages/receipts/index.vue",
  "../../app/pages/receipts/new.vue",
  "../../app/pages/receipts/[id].vue",
  "../../app/pages/payments.vue",
  "../../app/components/PaymentRejectForm.vue",
  "../../app/components/ReceiptFileButton.vue",
  "../../app/components/MoneyAmount.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInput, USelect y UTextarea son inline por defecto; el campo ocupa su fila",
  "font-semibold text-error": "una deuda mayor que cero se lee en rojo, como antes",
};

describe("comprobantes y cobros con Nuxt UI nativo", () => {
  it.each(RECEIPT_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      expectNativeNuxtUi(new URL(path, import.meta.url), ALLOWED_CLASSES);
    },
  );
});
