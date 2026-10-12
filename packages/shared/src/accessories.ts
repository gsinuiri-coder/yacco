/** Contracts for accessories module. */

export type AccessoryMovementType =
  | "ENTRY"
  | "SALE"
  | "SALE_VOID"
  | "LOAN"
  | "LOAN_VOID"
  | "LOAN_RETURN"
  | "LOAN_RETURN_VOID"
  | "LOAN_CHARGE"
  | "LOAN_CHARGE_VOID"
  | "WRITE_OFF"
  | "COUNT_ADJUSTMENT";

export interface AccessorySummary {
  id: string;
  name: string;
  listPrice: string;
  active: boolean;
  stock: number;
  totalBorrowed: number;
}

export interface CreateAccessoryEntryBody {
  quantity: number;
}

export interface CreateAccessoryWriteOffBody {
  quantity: number;
  reason: string;
}

export interface CountAccessoryBody {
  countedQuantity: number;
  reason?: string;
}

export interface LoanAccessoryBody {
  productId: string;
  quantity: number;
}

export interface ReturnAccessoryBody {
  productId: string;
  quantity: number;
}

export interface ChargeAccessoryBody {
  productId: string;
  quantity: number;
  reason: string;
  unitPrice?: string;
}

export interface VoidChargeAccessoryBody {
  reason: string;
}

export interface AccessoryMovementItem {
  id: string;
  productId: string;
  productName: string;
  type: AccessoryMovementType;
  quantity: number;
  locationId: string | null;
  locationName: string | null;
  customerName: string | null;
  saleId: string | null;
  reason: string | null;
  reversesMovementId: string | null;
  recordedById: string;
  recordedByName: string;
  occurredAt: string;
  createdAt: string;
}

export interface CustomerAccessoryBalanceItem {
  locationId: string;
  productId: string;
  productName: string;
  quantity: number;
  listPrice: string;
  agreedPrice: string | null;
}

export interface BorrowedAccessoryItem {
  customerId: string;
  customerName: string;
  locationId: string;
  locationName: string;
  productId: string;
  productName: string;
  quantity: number;
  lastMovementAt: string;
}

export interface AccessoryStockDiscrepancy {
  productId: string;
  productName: string;
  materializedStock: number;
  ledgerStock: number;
  difference: number;
}

export interface CustomerAccessoryBalanceDiscrepancy {
  locationId: string;
  locationName: string;
  productId: string;
  productName: string;
  materializedBalance: number;
  ledgerBalance: number;
  difference: number;
}

export interface AccessoryReconciliationResult {
  stockDiscrepancies: AccessoryStockDiscrepancy[];
  customerBalanceDiscrepancies: CustomerAccessoryBalanceDiscrepancy[];
  isBalanced: boolean;
}
