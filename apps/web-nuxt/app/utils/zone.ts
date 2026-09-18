import type { Weekday } from "@yacco/shared";

export const WEEKDAY_ORDER: readonly Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  MONDAY: "Lunes",
  TUESDAY: "Martes",
  WEDNESDAY: "Miércoles",
  THURSDAY: "Jueves",
  FRIDAY: "Viernes",
  SATURDAY: "Sábado",
  SUNDAY: "Domingo",
};

/** Una zona sin días todavía es un estado real, honesto: ver CreateZoneDto. */
export function formatDeliveryDays(days: readonly Weekday[]): string {
  if (days.length === 0) return "Sin días definidos";
  return WEEKDAY_ORDER.filter((day) => days.includes(day))
    .map((day) => WEEKDAY_LABEL[day])
    .join(", ");
}

export function toggleDay(days: readonly Weekday[], day: Weekday): Weekday[] {
  return days.includes(day) ? days.filter((current) => current !== day) : [...days, day];
}
