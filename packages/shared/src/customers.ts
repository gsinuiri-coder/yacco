/**
 * Contracts derived from apps/api/src/modules/customers. Nothing invented:
 * when the API changes, this file changes against the real DTOs.
 *
 * Money (`creditLimit`, `debtBalance`) is a 2-decimal string on the wire.
 * `debtBalance` is read-only — the API rejects a body carrying it — so it is
 * on Customer and on neither write shape.
 */

/** CustomerResponseDto. `createdAt` is an ISO instant. */
export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  addressReference: string;
  contactName: string | null;
  latitude: string | null;
  longitude: string | null;
  zoneId: string | null;
  zone: { id: string; name: string } | null;
  creditLimit: string | null;
  debtBalance: string;
  active: boolean;
  createdAt: string;
  // Document and tax details (Fase 3, Fila 4)
  documentType?: string | null;
  documentNumber?: string | null;
  legalName?: string | null;
  fiscalAddress?: string | null;
  duplicateDocumentWarning?: string | null;
}

export type CustomerDocumentType = "RUC" | "DNI" | "CE";

export function validateCustomerDocument(
  documentType?: string | null,
  documentNumber?: string | null,
): string | null {
  const type = documentType?.trim() || null;
  const num = documentNumber?.trim() || null;
  if (!type && !num) return null;
  if (!type && num) return "El tipo de documento es obligatorio si se indica el número";
  if (type && !num) return "El número de documento es obligatorio si se indica el tipo";
  if (type === "RUC") {
    if (!/^\d{11}$/.test(num!)) return "El RUC debe tener exactamente 11 dígitos";
  } else if (type === "DNI") {
    if (!/^\d{8}$/.test(num!)) return "El DNI debe tener exactamente 8 dígitos";
  } else if (type === "CE") {
    if (!/^[a-zA-Z0-9]{4,20}$/.test(num!)) {
      return "El carné de extranjería debe tener entre 4 y 20 caracteres alfanuméricos";
    }
  }
  return null;
}

/** ListCustomersQueryDto. */
export interface CustomerListQuery {
  page?: number;
  limit?: number;
  search?: string;
  zoneId?: string;
  /** Only customers without a zone ("Sin zona"). Mutually exclusive with `zoneId`: both is a 400. */
  withoutZone?: boolean;
  active?: boolean;
}

/** CreateCustomerDto, without `active`: a new customer starts active. */
export interface CreateCustomerBody {
  name: string;
  phone: string;
  address: string;
  addressReference: string;
  zoneId?: string;
  creditLimit?: string;
  documentType?: string | null;
  documentNumber?: string | null;
  legalName?: string | null;
  fiscalAddress?: string | null;
}

/** UpdateCustomerDto: every field optional, plus deactivation. */
export interface UpdateCustomerBody extends Partial<CreateCustomerBody> {
  contactName?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  active?: boolean;
}

export interface CustomerContact {
  id: string;
  customerId: string;
  name: string;
  phone: string | null;
  active: boolean;
  createdById: string;
  createdAt: string;
  removedById: string | null;
  removedAt: string | null;
  createdBy?: { id: string; name: string };
  removedBy?: { id: string; name: string } | null;
}

export interface CreateCustomerContactBody {
  name: string;
  phone?: string | null;
}

export type LocationPhotoStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface CustomerLocationPhoto {
  id: string;
  locationId: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  status: LocationPhotoStatus;
  uploadedById: string;
  createdAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  hiddenById: string | null;
  hiddenAt: string | null;
  hiddenReason: string | null;
  uploadedBy?: { id: string; name: string };
  reviewedBy?: { id: string; name: string } | null;
  hiddenBy?: { id: string; name: string } | null;
  location?: {
    id: string;
    name: string;
    customer?: { id: string; name: string };
  };
}

export interface ReviewPhotoBody {
  status: "APPROVED" | "REJECTED";
  rejectionReason?: string;
}

export interface HidePhotoBody {
  reason: string;
}

export type CoordinateRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface CustomerLocationCoordinateRequest {
  id: string;
  locationId: string;
  latitude: string;
  longitude: string;
  accuracyM: string | null;
  previousLatitude: string | null;
  previousLongitude: string | null;
  status: CoordinateRequestStatus;
  requestedById: string;
  createdAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  requestedBy?: { id: string; name: string };
  reviewedBy?: { id: string; name: string } | null;
  location?: {
    id: string;
    name: string;
    customer?: { id: string; name: string };
  };
}

export interface CreateCoordinateRequestBody {
  latitude: string;
  longitude: string;
  accuracyM?: string | null;
}

export interface ReviewCoordinateRequestBody {
  status: "APPROVED" | "REJECTED";
  rejectionReason?: string;
}

export interface PendingApprovalsResponse {
  photos: CustomerLocationPhoto[];
  coordinateRequests: CustomerLocationCoordinateRequest[];
  totalPending: number;
}

/** MAX_LIMIT in the API's list-customers-query.dto.ts. */
export const CUSTOMERS_PAGE_SIZE = 20;

/**
 * ZoneCustomerCountsDto (GET /customers/zone-counts). Active customers only;
 * a zone with none is absent from `zones`, so a missing zone reads as 0.
 */
export interface ZoneCustomerCounts {
  zones: Array<{ zoneId: string; activeCustomers: number }>;
  withoutZone: number;
}
