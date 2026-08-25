import { toExportedDocument } from "./convert.js";
import type { ExportedDocument } from "./convert.js";
import { hasPendingDebt } from "./pending-debt.js";
import type { ExportedVoucher } from "./pending-debt.js";

/**
 * The slice of the Firestore API this script uses, as an interface, so the
 * exporters can be exercised with an in-memory fake. A real
 * `admin.firestore.Firestore` satisfies it structurally; nothing here is
 * ever tested against a live database.
 */
export interface DocumentLike {
  id: string;
  data(): Record<string, unknown>;
  ref: { collection(name: string): CollectionLike };
}

export interface CollectionLike {
  get(): Promise<{ docs: DocumentLike[] }>;
}

export interface FirestoreLike {
  collection(name: string): CollectionLike;
}

export const CUSTOMERS_COLLECTION = "customers";
export const VOUCHERS_COLLECTION = "vouchers";
export const DEBT_PAYS_SUBCOLLECTION = "debtPays";

export async function exportCustomers(firestore: FirestoreLike): Promise<ExportedDocument[]> {
  const snapshot = await firestore.collection(CUSTOMERS_COLLECTION).get();
  return snapshot.docs.map((doc) => toExportedDocument(doc.id, doc.data()));
}

export interface VouchersExportOptions {
  /** Default: only vouchers with debt outstanding — what the loader needs, and far fewer. */
  pendingOnly: boolean;
}

export interface VouchersExportResult {
  vouchers: ExportedVoucher[];
  /** How many were read before the pending filter, for the closing report. */
  scanned: number;
}

/**
 * Each voucher carries its `debtPays` subcollection nested inside: one read
 * per voucher, which is fine for a one-off snapshot and keeps every payment
 * next to the debt it pays.
 */
export async function exportVouchers(
  firestore: FirestoreLike,
  options: VouchersExportOptions,
): Promise<VouchersExportResult> {
  const snapshot = await firestore.collection(VOUCHERS_COLLECTION).get();
  const vouchers: ExportedVoucher[] = [];
  for (const doc of snapshot.docs) {
    const debtPaysSnapshot = await doc.ref.collection(DEBT_PAYS_SUBCOLLECTION).get();
    const voucher: ExportedVoucher = {
      ...toExportedDocument(doc.id, doc.data()),
      debtPays: debtPaysSnapshot.docs.map((pay) => toExportedDocument(pay.id, pay.data())),
    };
    if (!options.pendingOnly || hasPendingDebt(voucher)) {
      vouchers.push(voucher);
    }
  }
  return { vouchers, scanned: snapshot.docs.length };
}
