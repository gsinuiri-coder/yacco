import type { NamedReference } from "./container-balances.js";

/** CustomerDebtRowDto (HU-19). `debt` is money on the wire; the date a Lima calendar day. */
export interface CustomerDebtRow {
  customer: NamedReference;
  zone: NamedReference | null;
  debt: string;
  oldestChargeDate: string;
  /** The charge that opened the current debt is the roster's opening balance: `oldestChargeDate` is the date it was loaded with, not a sale made in the system. */
  openedByOpeningBalance: boolean;
}

/** CustomerDebtsReportDto. Only customers who owe; `total` is their sum. */
export interface CustomerDebtsReport {
  rows: CustomerDebtRow[];
  total: string;
}

/** LoanedContainerRowDto (HU-20). A negative quantity is a finding, not an error. */
export interface LoanedContainerRow {
  customer: NamedReference;
  containerType: NamedReference;
  quantity: number;
}

export interface ContainerTypeQuantity {
  containerType: NamedReference;
  quantity: number;
}

/** LoanedContainersReportDto. `total` matches the fleet's WITH_CUSTOMER state. */
export interface LoanedContainersReport {
  rows: LoanedContainerRow[];
  byType: ContainerTypeQuantity[];
  total: number;
}

export interface ProducedByType {
  containerType: NamedReference;
  producedQty: number;
}

/** ProductionReportBatchDto (HU-21). `date` is "AAAA-MM-DD". */
export interface ProductionReportBatch {
  id: string;
  code: string;
  date: string;
  items: ProducedByType[];
  total: number;
}

export interface ProductionReport {
  batches: ProductionReportBatch[];
  byType: ProducedByType[];
  total: number;
}
