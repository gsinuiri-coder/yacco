import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "./args.js";
import { exportCustomers, exportVouchers } from "./export.js";
import type { CollectionLike, DocumentLike, FirestoreLike } from "./export.js";

/** In-memory stand-in for the slice of Firestore the exporters touch. */
interface FakeDocument {
  id: string;
  fields: Record<string, unknown>;
  subcollections?: Record<string, FakeDocument[]>;
}

function fakeCollection(docs: FakeDocument[]): CollectionLike {
  return {
    get: () =>
      Promise.resolve({
        docs: docs.map((doc): DocumentLike => ({
          id: doc.id,
          data: () => doc.fields,
          ref: { collection: (name) => fakeCollection(doc.subcollections?.[name] ?? []) },
        })),
      }),
  };
}

function fakeFirestore(collections: Record<string, FakeDocument[]>): FirestoreLike {
  return { collection: (name) => fakeCollection(collections[name] ?? []) };
}

const CREATED_AT = Timestamp.fromDate(new Date("2025-02-02T12:00:00.000Z"));

describe("exportCustomers", () => {
  it("exports every customer document as-is, with types converted", async () => {
    const firestore = fakeFirestore({
      customers: [
        {
          id: "c1",
          fields: { name: "Bodega Santa Rosa", phone: "987654321", createdAt: CREATED_AT },
        },
        { id: "c2", fields: { name: "Kiosko", debt: 12.5 } },
      ],
    });

    const customers = await exportCustomers(firestore);

    expect(customers).toEqual([
      {
        id: "c1",
        data: {
          name: "Bodega Santa Rosa",
          phone: "987654321",
          createdAt: "2025-02-02T12:00:00.000Z",
        },
      },
      { id: "c2", data: { name: "Kiosko", debt: 12.5 } },
    ]);
  });

  it("returns an empty list for an empty collection", async () => {
    await expect(exportCustomers(fakeFirestore({}))).resolves.toEqual([]);
  });
});

describe("exportVouchers", () => {
  const firestore = fakeFirestore({
    vouchers: [
      {
        id: "v-pending",
        fields: { total: 30, debtPaid: 10, createdAt: CREATED_AT },
        subcollections: { debtPays: [{ id: "p1", fields: { amount: 10, paidAt: CREATED_AT } }] },
      },
      {
        id: "v-settled",
        fields: { total: 20, debtPaid: 20 },
        subcollections: { debtPays: [{ id: "p2", fields: { amount: 20 } }] },
      },
      { id: "v-no-pays", fields: { total: 5 } },
    ],
  });

  it("by default keeps only vouchers with pending debt, each with its debtPays nested", async () => {
    const { vouchers, scanned } = await exportVouchers(firestore, { pendingOnly: true });

    expect(scanned).toBe(3);
    expect(vouchers.map((voucher) => voucher.id)).toEqual(["v-pending", "v-no-pays"]);
    expect(vouchers[0]).toEqual({
      id: "v-pending",
      data: { total: 30, debtPaid: 10, createdAt: "2025-02-02T12:00:00.000Z" },
      debtPays: [{ id: "p1", data: { amount: 10, paidAt: "2025-02-02T12:00:00.000Z" } }],
    });
    expect(vouchers[1]?.debtPays).toEqual([]);
  });

  it("with pendingOnly false exports them all", async () => {
    const { vouchers, scanned } = await exportVouchers(firestore, { pendingOnly: false });

    expect(scanned).toBe(3);
    expect(vouchers.map((voucher) => voucher.id)).toEqual(["v-pending", "v-settled", "v-no-pays"]);
  });
});

describe("parseArgs", () => {
  it("defaults vouchers to pending-only and the output dir to output/", () => {
    expect(parseArgs(["vouchers"])).toEqual({
      command: "vouchers",
      pendingOnly: true,
      outDir: "output",
    });
  });

  it("--all exports everything; --pending-only restores the default; --out changes the dir", () => {
    expect(parseArgs(["vouchers", "--all"]).pendingOnly).toBe(false);
    expect(parseArgs(["vouchers", "--all", "--pending-only"]).pendingOnly).toBe(true);
    expect(parseArgs(["customers", "--out", "C:/foto"]).outDir).toBe("C:/foto");
  });

  it("rejects an unknown command, an unknown flag, and --out without a value", () => {
    expect(() => parseArgs([])).toThrow(UsageError);
    expect(() => parseArgs(["orders"])).toThrow(/Comando desconocido/);
    expect(() => parseArgs(["customers", "--verbose"])).toThrow(/Opción desconocida/);
    expect(() => parseArgs(["customers", "--out"])).toThrow(/--out necesita/);
    expect(() => parseArgs(["customers", "--out", "--all"])).toThrow(/--out necesita/);
  });
});
