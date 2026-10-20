import { describe, it } from "vitest";
import { expectNativeNuxtUi } from "../support/nuxt-ui-guard";

const PANEL_TEMPLATES = [
  "../../app/pages/index.vue",
  "../../app/pages/login.vue",
  "../../app/pages/pending-approvals.vue",
  "../../app/components/PendingApprovalsCard.vue",
  "../../app/components/UpcomingReviewsCard.vue",
  "../../app/components/SetupChecklistCard.vue",
  "../../app/components/RoleDashboardSummary.vue",
];

/**
 * Las únicas clases que quedan en estas plantillas, cada una con lo que
 * ningún componente ni prop de Nuxt UI resuelve. Agregar una acá es una
 * decisión que se anota en el PR, no un atajo.
 */
const ALLOWED_CLASSES: Record<string, string> = {
  "w-full": "UInput es inline por defecto; el campo ocupa su fila",
  "mx-auto w-full max-w-2xl": "el Panel conserva su columna angosta y centrada en escritorio",
  "hidden lg:flex": "el lema de la planta solo en pantallas anchas, como antes",
  "size-20": "la miniatura de la foto por aprobar, del tamaño de antes",
  "flex justify-end gap-2": "botones de rechazar y aprobar separados y a la derecha",
  "flex flex-wrap gap-2": "enlaces hermanos separados, sin fundirse como UFieldGroup",
  "flex flex-wrap items-center gap-2": "badges y enlace en una línea, separados",
};

describe("Panel, ingreso y aprobaciones con Nuxt UI nativo", () => {
  it.each(PANEL_TEMPLATES)(
    "%s no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón",
    (path) => {
      expectNativeNuxtUi(new URL(path, import.meta.url), ALLOWED_CLASSES);
    },
  );
});
