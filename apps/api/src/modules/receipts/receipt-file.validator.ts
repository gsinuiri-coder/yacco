import { BadRequestException } from "@nestjs/common";
import { ReceiptMedium } from "@prisma/client";
import { validateImageFile } from "../customer-locations/image-file.validator.js";

export const MAX_RECEIPT_FILE_BYTES = 10 * 1024 * 1024;

export type ReceiptFileCategory = "DOCUMENT" | "PDF" | "XML";

export interface ValidatedReceiptFile {
  contentType: string;
  extension: string;
  category: ReceiptFileCategory;
}

export function receiptFileName(objectKey: string): string {
  return objectKey.slice(objectKey.lastIndexOf("/") + 1);
}

function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-";
}

function isXml(buffer: Buffer): boolean {
  return buffer
    .toString("utf8", 0, Math.min(buffer.length, 1024))
    .replace(/^\uFEFF/, "")
    .trimStart()
    .startsWith("<?xml");
}

export function validateReceiptFile(buffer: Buffer, medium: ReceiptMedium): ValidatedReceiptFile {
  if (buffer.length > MAX_RECEIPT_FILE_BYTES) {
    throw new BadRequestException("El archivo no puede superar los 10 MB");
  }

  if (isPdf(buffer)) {
    return {
      contentType: "application/pdf",
      extension: "pdf",
      category: medium === ReceiptMedium.MANUAL ? "DOCUMENT" : "PDF",
    };
  }

  if (medium === ReceiptMedium.EXTERNAL_ELECTRONIC) {
    if (isXml(buffer)) {
      return { contentType: "application/xml", extension: "xml", category: "XML" };
    }
    throw new BadRequestException("El comprobante electrónico solo admite archivos PDF o XML");
  }

  try {
    const image = validateImageFile(buffer);
    return { ...image, category: "DOCUMENT" };
  } catch (error) {
    if (error instanceof BadRequestException && buffer.length > 5 * 1024 * 1024) throw error;
    throw new BadRequestException("El comprobante manual solo admite una imagen o un PDF");
  }
}
