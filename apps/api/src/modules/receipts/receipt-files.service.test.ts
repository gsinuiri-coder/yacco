import { jest } from "@jest/globals";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ReceiptMedium } from "@prisma/client";
import { Readable } from "node:stream";
import { ReceiptFilesService } from "./receipt-files.service.js";

const RECEIPT_ID = "11111111-1111-4111-8111-111111111111";

function buildTransactionMock() {
  return {
    $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    receipt: { findUnique: jest.fn<() => Promise<unknown>>() },
    receiptFile: { create: jest.fn<(...args: unknown[]) => Promise<unknown>>() },
  };
}

function buildService() {
  const tx = buildTransactionMock();
  const prisma = {
    receiptFile: { findUnique: jest.fn<() => Promise<unknown>>() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const storage = {
    upload: jest.fn<() => Promise<void>>().mockResolvedValue(),
    get: jest.fn<() => Promise<unknown>>(),
  };
  return {
    tx,
    prisma,
    storage,
    service: new ReceiptFilesService(prisma as never, storage as never),
  };
}

describe("ReceiptFilesService", () => {
  it("uploads a validated manual document and records only its private object key", async () => {
    const { tx, storage, service } = buildService();
    tx.receipt.findUnique.mockResolvedValue({
      id: RECEIPT_ID,
      medium: ReceiptMedium.MANUAL,
      files: [],
    });
    tx.receiptFile.create.mockImplementation(async (args) => (args as { data: unknown }).data);

    const result = await service.upload(RECEIPT_ID, { buffer: Buffer.from("%PDF-1.7") });

    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^receipts/${RECEIPT_ID}/[0-9a-f-]+\\.pdf$`)),
      expect.any(Buffer),
      "application/pdf",
    );
    expect(result).toEqual({
      fileName: expect.stringMatching(/^[0-9a-f-]+\.pdf$/),
      contentType: "application/pdf",
    });
  });

  it("allows one PDF and one XML for an external electronic receipt", async () => {
    const { tx, service } = buildService();
    tx.receipt.findUnique.mockResolvedValue({
      id: RECEIPT_ID,
      medium: ReceiptMedium.EXTERNAL_ELECTRONIC,
      files: [{ objectKey: `receipts/${RECEIPT_ID}/document.pdf`, contentType: "application/pdf" }],
    });
    tx.receiptFile.create.mockImplementation(async (args) => (args as { data: unknown }).data);

    await expect(
      service.upload(RECEIPT_ID, {
        buffer: Buffer.from('<?xml version="1.0"?><Invoice></Invoice>'),
      }),
    ).resolves.toEqual(expect.objectContaining({ contentType: "application/xml" }));
  });

  it("rejects a second manual file or duplicate electronic category", async () => {
    const manual = buildService();
    manual.tx.receipt.findUnique.mockResolvedValue({
      id: RECEIPT_ID,
      medium: ReceiptMedium.MANUAL,
      files: [{ objectKey: "existing.jpg", contentType: "image/jpeg" }],
    });
    await expect(
      manual.service.upload(RECEIPT_ID, { buffer: Buffer.from("%PDF-1.7") }),
    ).rejects.toThrow(ConflictException);

    const electronic = buildService();
    electronic.tx.receipt.findUnique.mockResolvedValue({
      id: RECEIPT_ID,
      medium: ReceiptMedium.EXTERNAL_ELECTRONIC,
      files: [{ objectKey: "existing.pdf", contentType: "application/pdf" }],
    });
    await expect(
      electronic.service.upload(RECEIPT_ID, { buffer: Buffer.from("%PDF-1.7") }),
    ).rejects.toThrow(ConflictException);
  });

  it("returns 404 for an unknown receipt before storing anything", async () => {
    const { tx, storage, service } = buildService();
    tx.receipt.findUnique.mockResolvedValue(null);

    await expect(service.upload(RECEIPT_ID, { buffer: Buffer.from("%PDF-1.7") })).rejects.toThrow(
      NotFoundException,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("reads an existing file through StorageService", async () => {
    const { prisma, storage, service } = buildService();
    const fileName = "22222222-2222-4222-8222-222222222222.pdf";
    const objectKey = `receipts/${RECEIPT_ID}/${fileName}`;
    prisma.receiptFile.findUnique.mockResolvedValue({
      receiptId: RECEIPT_ID,
      objectKey,
      contentType: "application/pdf",
    });
    storage.get.mockResolvedValue({
      stream: Readable.from([Buffer.from("pdf")]),
      contentType: "application/pdf",
      contentLength: 3,
    });

    const result = await service.get(RECEIPT_ID, fileName);

    expect(storage.get).toHaveBeenCalledWith(objectKey);
    expect(result).toEqual(
      expect.objectContaining({ contentType: "application/pdf", contentLength: 3 }),
    );
  });

  it("rejects path traversal instead of looking up an arbitrary object key", async () => {
    const { prisma, service } = buildService();

    await expect(service.get(RECEIPT_ID, "../secret.pdf")).rejects.toThrow(NotFoundException);
    expect(prisma.receiptFile.findUnique).not.toHaveBeenCalled();
  });
});
