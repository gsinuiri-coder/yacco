import type { PaymentStatus } from "./payments.js";

/**
 * Contracts derived from apps/api/src/modules/routes. `date` is a calendar day
 * "AAAA-MM-DD" in America/Lima; `createdAt`/`correctedAt` are instants.
 */

/** Prisma enum RouteStatus. */
export type RouteStatus = "PLANNED" | "IN_PROGRESS" | "FINISHED" | "SETTLED";

/** Prisma enum StopStatus. */
export type StopStatus = "PENDING" | "DELIVERED" | "FAILED";

/** Prisma enum StopOrigin: a previously taken order, or a sale on the street. */
export type StopOrigin = "ORDER" | "VAN_SALE";

interface Named {
  id: string;
  name: string;
}

/** RouteStopLocationDto. */
export interface RouteStopLocation {
  id: string;
  name: string;
  address: string;
  customer: Named;
}

/**
 * RouteStopSaleDto: the stop's CURRENT sale. Voided sales never come here.
 * `creditLimitExceeded` warns; the sale is recorded anyway.
 */
export interface RouteStopSale {
  id: string;
  total: string;
  creditLimitExceeded: boolean;
}

/** RouteStopPaymentDto: the stop's current payment. */
export interface RouteStopPayment {
  id: string;
  status: PaymentStatus;
  amount: string;
}

/** RouteStopCorrectionDto: the LAST correction only — who, when and why. */
export interface RouteStopCorrection {
  correctedAt: string;
  correctedBy: Named;
  correctionReason: string | null;
}

/**
 * RouteStopStockShortfallDto: more of a container type was recorded than the
 * truck had. Only a correction can produce it, and it warns, never blocks.
 */
export interface RouteStopStockShortfall {
  containerTypeId: string;
  containerType: Named;
  available: number;
  requested: number;
}

/** RouteStopContainerBalanceDto: what the customer still holds, per type. */
export interface RouteStopContainerBalance {
  containerTypeId: string;
  containerType: Named;
  quantity: number;
}

/**
 * RouteStopResponseDto. `sale`/`payment` come in a route's detail and in a
 * write's response, never when listing routes. `containerBalances` and
 * `stockShortfall` only in a write's response. `correction` always.
 */
export interface RouteStop {
  id: string;
  routeId: string;
  position: number;
  origin: StopOrigin;
  locationId: string;
  location: RouteStopLocation;
  orderId: string | null;
  status: StopStatus;
  failureReason: string | null;
  correction: RouteStopCorrection | null;
  sale?: RouteStopSale | null;
  payment?: RouteStopPayment | null;
  containerBalances?: RouteStopContainerBalance[];
  stockShortfall?: RouteStopStockShortfall[];
}

/** RouteResponseDto. Stops always come ordered by `position`. */
export interface Route {
  id: string;
  date: string;
  driverId: string;
  driver: Named;
  zoneId: string | null;
  zone: Named | null;
  status: RouteStatus;
  createdById: string;
  createdAt: string;
  stops: RouteStop[];
}

/** ListRoutesQueryDto. */
export interface RouteListQuery {
  page?: number;
  limit?: number;
  date?: string;
  driverId?: string;
  zoneId?: string;
  status?: RouteStatus;
}

export const ROUTES_PAGE_SIZE = 20;

/** CreateRouteDto: born PLANNED and EMPTY. `zoneId` is only a label. */
export interface CreateRouteBody {
  driverId: string;
  date: string;
  zoneId?: string;
}

/** CreateRouteStopDto: ORDER carries `orderId`, VAN_SALE carries `locationId`. */
export interface CreateRouteStopBody {
  origin: StopOrigin;
  orderId?: string;
  locationId?: string;
}

/** DeliverySaleItemDto. `unitPrice` only when charged differently, with an authorizer. */
export interface DeliverySaleItemBody {
  productId: string;
  quantity: number;
  unitPrice?: string;
}

/** ContainerReturnDto. */
export interface ContainerReturnBody {
  containerTypeId: string;
  quantity: number;
}

/** DeliveryPaymentDto. */
export interface DeliveryPaymentBody {
  paymentMethodId: string;
  amount: string;
}

/** MarkRouteStopDto: only the two terminal states. */
export interface MarkRouteStopBody {
  status: "DELIVERED" | "FAILED";
  failureReason?: string;
  items?: DeliverySaleItemBody[];
  containersReturned?: ContainerReturnBody[];
  payment?: DeliveryPaymentBody;
  priceOverrideAuthorizedById?: string;
}

/** CorrectRouteStopDto: the mark to re-register, plus the mandatory reason. */
export interface CorrectRouteStopBody extends MarkRouteStopBody {
  correctionReason: string;
}

/** RouteLoadResponseDto: units loaded on the truck from one batch line. */
export interface RouteLoad {
  id: string;
  routeId: string;
  batchItemId: string;
  batchItem: {
    id: string;
    containerTypeId: string;
    containerType: Named;
    batchId: string;
    batch: { id: string; code: string };
  };
  quantity: number;
}

/** CreateRouteLoadDto. `batchItemId` is resolved FIFO by the screen, never asked. */
export interface CreateRouteLoadBody {
  batchItemId: string;
  quantity: number;
}
