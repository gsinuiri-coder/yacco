import { diffCalendarDays } from "./business-date.js";

export interface Vehicle {
  id: string;
  plate: string;
  name: string;
  brand: string;
  model: string;
  capacityUnits: number | null;
  vehicleClass: string | null;
  circulationCardNumber: string | null;
  active: boolean;
  createdById: string;
  createdAt: string;
  updatedById: string | null;
  updatedAt: string | null;
}

export interface VehicleSummary {
  id: string;
  plate: string;
  name: string;
  brand: string;
  model: string;
  capacityUnits: number | null;
}

export interface CreateVehicleBody {
  plate: string;
  name: string;
  brand: string;
  model: string;
  capacityUnits?: number | null;
  vehicleClass?: string | null;
  circulationCardNumber?: string | null;
}

export interface UpdateVehicleBody {
  plate?: string;
  name?: string;
  brand?: string;
  model?: string;
  capacityUnits?: number | null;
  vehicleClass?: string | null;
  circulationCardNumber?: string | null;
  active?: boolean;
}

export interface VehicleReviewType {
  id: string;
  name: string;
  active: boolean;
  createdById: string;
  createdAt: string;
}

export interface CreateVehicleReviewTypeBody {
  name: string;
}

export interface UpdateVehicleReviewTypeBody {
  active: boolean;
}

export type VehicleReviewStatusCode = "VIGENTE" | "POR_VENCER" | "VENCIDA" | "SIN_REGISTRO";

export interface VehicleReview {
  id: string;
  vehicleId: string;
  reviewTypeId: string;
  reviewType: { id: string; name: string };
  startsOn: string;
  endsOn: string;
  notes: string | null;
  recordedById: string;
  recordedBy: { id: string; name: string };
  createdAt: string;
  voidedAt: string | null;
  voidedById: string | null;
  voidedBy: { id: string; name: string } | null;
  voidReason: string | null;
}

export interface VehicleReviewTypeStatus {
  reviewTypeId: string;
  reviewTypeName: string;
  status: VehicleReviewStatusCode;
  daysRemaining: number | null;
  latestReview: VehicleReview | null;
}

export interface CreateVehicleReviewBody {
  reviewTypeId: string;
  startsOn: string;
  endsOn: string;
  notes?: string | null;
}

export interface VoidVehicleReviewBody {
  voidReason: string;
}

export interface RouteVehicleAssignment {
  id: string;
  routeId: string;
  vehicleId: string;
  vehicle: VehicleSummary;
  assignedById: string;
  assignedBy: { id: string; name: string };
  createdAt: string;
  reason: string | null;
  pitStopId: string | null;
  isVoided?: boolean;
}

export interface AssignRouteVehicleBody {
  vehicleId: string;
  reason?: string;
}

export interface UpcomingReviewAlert {
  type: "VEHICLE_REVIEW" | "DRIVER_LICENSE";
  targetId: string;
  targetName: string;
  detail: string;
  expiresOn: string;
  daysRemaining: number;
  status: "POR_VENCER" | "VENCIDA";
}

/**
 * Normaliza una placa de vehículo eliminando espacios, guiones y caracteres no alfanuméricos,
 * convirtiendo todo a mayúsculas.
 */
export function normalizePlate(plate: string): string {
  return plate.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Calcula el estado de una revisión dada su fecha de fin ("AAAA-MM-DD") y la fecha de hoy ("AAAA-MM-DD").
 * - "VENCIDA": si endsOn < todayLima
 * - "POR_VENCER": si faltan 15 días o menos (0 <= diff <= 15)
 * - "VIGENTE": si faltan más de 15 días (diff > 15)
 */
export function calculateReviewStatus(
  endsOn: string,
  todayLima: string,
): { status: "VIGENTE" | "POR_VENCER" | "VENCIDA"; daysRemaining: number } {
  const daysRemaining = diffCalendarDays(todayLima, endsOn);
  if (daysRemaining < 0) {
    return { status: "VENCIDA", daysRemaining };
  }
  if (daysRemaining <= 15) {
    return { status: "POR_VENCER", daysRemaining };
  }
  return { status: "VIGENTE", daysRemaining };
}
