/**
 * Contracts for Route Pit Stops (paradas en planta en medio de la ruta).
 * Money is a 2-decimal string end to end.
 */

interface Named {
  id: string;
  name: string;
}

export interface RoutePitStopCount {
  id: string;
  pitStopId?: string;
  containerTypeId: string;
  containerType: Named;
  expectedFull: number;
  countedFull: number;
  expectedEmpty: number;
  countedEmpty: number;
  differenceReason: string | null;
}

export interface RoutePitStopLoad {
  id: string;
  batchItemId: string;
  quantity: number;
  batch: { id: string; code: string; date: string };
  containerType: Named;
}

export interface RoutePitStopMovement {
  id: string;
  type: string;
  quantity: number;
  containerType: Named;
}

export interface RoutePitStopUnload {
  type: "EMPTY_UNLOAD" | "FULL_RETURN";
  containerTypeId: string;
  containerType: Named;
  quantity: number;
}

export interface RoutePitStop {
  id: string;
  routeId: string;
  recordedById?: string;
  recordedBy: Named;
  createdAt: string;
  notes: string | null;
  cashExpected: string | null;
  cashDelivered: string | null;
  cashReason: string | null;
  voidedAt: string | null;
  voidedById?: string | null;
  voidedBy: Named | null;
  voidReason: string | null;
  counts: RoutePitStopCount[];
  loads: RoutePitStopLoad[];
  unloads?: RoutePitStopUnload[];
  movements: RoutePitStopMovement[];
}

export type RoutePitStopResponse = RoutePitStop;

export interface RoutePitStopContainerPreview {
  containerTypeId: string;
  containerTypeName: string;
  expectedFull: number;
  expectedEmpty: number;
  previousFullDifferences?: number;
  previousEmptyDifferences?: number;
}

export interface RoutePitStopCashPreview {
  cashCollected?: string;
  cashCollectedInRoute?: string;
  cashDeliveredInPreviousPits: string;
  cashExpected: string;
}

export interface RoutePitStopPreview {
  containers: RoutePitStopContainerPreview[];
  cash: RoutePitStopCashPreview;
}

export type RoutePitStopPreviewResponse = RoutePitStopPreview;

export interface CreateRoutePitStopCountBody {
  containerTypeId: string;
  countedFull: number;
  countedEmpty: number;
  differenceReason?: string;
}

export interface CreateRoutePitStopLoadBody {
  batchItemId: string;
  quantity: number;
}

export interface CreateRoutePitStopUnloadBody {
  containerTypeId: string;
  quantity: number;
}

export interface CreateRoutePitStopBody {
  counts: CreateRoutePitStopCountBody[];
  loads?: CreateRoutePitStopLoadBody[];
  unloadEmpties?: CreateRoutePitStopUnloadBody[];
  returnFulls?: CreateRoutePitStopUnloadBody[];
  cashDelivered?: string;
  cashReason?: string;
  notes?: string;
}

export interface VoidRoutePitStopBody {
  voidReason: string;
}
