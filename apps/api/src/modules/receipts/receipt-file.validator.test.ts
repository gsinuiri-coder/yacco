import { BadRequestException } from "@nestjs/common";
import { ReceiptMedium } from "@prisma/client";
import { MAX_RECEIPT_FILE_BYTES, validateReceiptFile } from "./receipt-file.validator.js";

describe("validateReceiptFile", () => {
  it("accepts PDF and XML by content for external electronic receipts", () => {
    expect(
      validateReceiptFile(Buffer.from("%PDF-1.7\ncontent"), ReceiptMedium.EXTERNAL_ELECTRONIC),
    ).toEqual({ contentType: "application/pdf", extension: "pdf", category: "PDF" });
    expect(
      validateReceiptFile(
        Buffer.from('<?xml version="1.0"?><Invoice></Invoice>'),
        ReceiptMedium.EXTERNAL_ELECTRONIC,
      ),
    ).toEqual({ contentType: "application/xml", extension: "xml", category: "XML" });
  });

  it("accepts a real image or PDF for a manual receipt", () => {
    expect(
      validateReceiptFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), ReceiptMedium.MANUAL),
    ).toEqual({ contentType: "image/jpeg", extension: "jpg", category: "DOCUMENT" });
    expect(validateReceiptFile(Buffer.from("%PDF-1.4"), ReceiptMedium.MANUAL)).toEqual({
      contentType: "application/pdf",
      extension: "pdf",
      category: "DOCUMENT",
    });
  });

  it("rejects an image for an external electronic receipt and disguised text", () => {
    expect(() =>
      validateReceiptFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), ReceiptMedium.EXTERNAL_ELECTRONIC),
    ).toThrow(BadRequestException);
    expect(() => validateReceiptFile(Buffer.from("not a pdf"), ReceiptMedium.MANUAL)).toThrow(
      BadRequestException,
    );
  });

  it("rejects files over 10 MB", () => {
    expect(() =>
      validateReceiptFile(Buffer.alloc(MAX_RECEIPT_FILE_BYTES + 1), ReceiptMedium.MANUAL),
    ).toThrow("El archivo no puede superar los 10 MB");
  });
});
