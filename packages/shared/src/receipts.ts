export type ReceiptType = "SALES_RECEIPT" | "INVOICE" | "CREDIT_NOTE";
export type ReceiptMedium = "MANUAL" | "EXTERNAL_ELECTRONIC";
export type ReceiptStatus = "ACTIVE" | "VOIDED";
export type SaleReceiptStatus = "AVAILABLE" | "RECEIPTED" | "EXEMPT";

export interface ReceiptCustomer {
  id: string;
  name: string;
}

export interface ReceiptUser {
  id: string;
  username: string;
}

export interface ReceiptRow {
  id: string;
  type: ReceiptType;
  medium: ReceiptMedium;
  series: string;
  number: string;
  issuedOn: string;
  customerId: string;
  issuerSettingsVersionId: string;
  taxableAmount: string;
  taxAmount: string;
  total: string;
  affectedReceiptId: string | null;
  reason: string | null;
  createdById: string;
  createdAt: string;
  voidedAt: string | null;
  voidedById: string | null;
  voidReason: string | null;
  status: ReceiptStatus;
  customer: ReceiptCustomer;
  createdBy: ReceiptUser;
}

export interface ReceiptIssuerSettings {
  id: string;
  taxId: string;
  legalName: string;
  fiscalAddress: string;
  taxRate: string;
  receiptDocumentThreshold: string;
}

export interface ReceiptSaleDetail {
  id: string;
  soldAt: string;
  total: string;
  location: { id: string; name: string };
  releasedAt: string | null;
}

export interface ReceiptFile {
  fileName: string;
  contentType: string;
}

export interface ReceiptCreditNote {
  id: string;
  series: string;
  number: string;
  medium: ReceiptMedium;
  status: ReceiptStatus;
}

export interface ReceiptDetail extends ReceiptRow {
  issuerSettingsVersion: ReceiptIssuerSettings;
  sales: ReceiptSaleDetail[];
  files: ReceiptFile[];
  creditNotes: ReceiptCreditNote[];
  voidedBy: ReceiptUser | null;
  /** Voided, and its paper (the original, for a credit note) is neither live nor cancelled by a live credit note. */
  canRegisterAgain: boolean;
  /** The live receipt with the same type, series and number, once loaded again. */
  registeredAgainId: string | null;
}

export interface ReceiptSaleStatusReceipt {
  id: string;
  type: ReceiptType;
  series: string;
  number: string;
}

export interface ReceiptSaleStatusExemption {
  id: string;
  reason: string;
}

export interface ReceiptSaleStatusRow {
  id: string;
  soldAt: string;
  total: string;
  location: { id: string; name: string };
  status: SaleReceiptStatus;
  receipt: ReceiptSaleStatusReceipt | null;
  exemption: ReceiptSaleStatusExemption | null;
}

export interface ReceiptPreview {
  customerId: string;
  saleIds: string[];
  issuerSettingsVersionId: string;
  taxRate: string;
  taxableAmount: string;
  taxAmount: string;
  total: string;
}
