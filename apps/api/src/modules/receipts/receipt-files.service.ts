import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ReceiptMedium } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { type ReceiptFileCategory, validateReceiptFile } from "./receipt-file.validator.js";

const RECEIPT_FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|xml|jpg|png|webp)$/;

export interface ReceiptUploadedFile {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

export interface ReceiptFileReference {
  fileName: string;
  contentType: string;
}

export interface RawReceiptFile {
  stream: Readable;
  contentType: string;
  contentLength?: number | undefined;
}

function categoryFromContentType(contentType: string): ReceiptFileCategory {
  if (contentType === "application/pdf") return "PDF";
  if (contentType === "application/xml") return "XML";
  return "DOCUMENT";
}

@Injectable()
export class ReceiptFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async upload(
    receiptId: string,
    file: ReceiptUploadedFile,
    createdById: string,
  ): Promise<ReceiptFileReference> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM receipts WHERE id = ${receiptId}::uuid FOR UPDATE`,
      );
      const receipt = await tx.receipt.findUnique({
        where: { id: receiptId },
        select: {
          id: true,
          medium: true,
          voidedAt: true,
          files: { select: { objectKey: true, contentType: true } },
        },
      });
      if (receipt === null) throw new NotFoundException("El comprobante no existe");
      if (receipt.voidedAt !== null) {
        throw new ConflictException("No se adjuntan archivos a un comprobante anulado");
      }

      const validated = validateReceiptFile(file.buffer, receipt.medium);
      this.assertFileSlotAvailable(receipt.medium, receipt.files, validated.category);

      const fileName = `${randomUUID()}.${validated.extension}`;
      const objectKey = `receipts/${receiptId}/${fileName}`;
      await tx.receiptFile.create({
        data: {
          receiptId,
          objectKey,
          contentType: validated.contentType,
          createdAt: new Date(),
          createdById,
        },
      });
      await this.storageService.upload(objectKey, file.buffer, validated.contentType);
      return { fileName, contentType: validated.contentType };
    });
  }

  async get(receiptId: string, fileName: string): Promise<RawReceiptFile> {
    if (!RECEIPT_FILE_NAME_PATTERN.test(fileName)) {
      throw new NotFoundException("El archivo no existe");
    }
    // A receipt registered again reuses the original's object key, which
    // carries the original's id: match by file name within this receipt.
    const file = await this.prisma.receiptFile.findFirst({
      where: { receiptId, objectKey: { endsWith: `/${fileName}` } },
      select: { objectKey: true, contentType: true },
    });
    if (file === null) throw new NotFoundException("El archivo no existe");

    const stored = await this.storageService.get(file.objectKey);
    return {
      stream: stored.stream,
      contentType: file.contentType,
      contentLength: stored.contentLength,
    };
  }

  private assertFileSlotAvailable(
    medium: ReceiptMedium,
    files: { objectKey: string; contentType: string }[],
    category: ReceiptFileCategory,
  ): void {
    if (medium === ReceiptMedium.MANUAL && files.length > 0) {
      throw new ConflictException("El comprobante manual ya tiene un archivo adjunto");
    }
    if (
      medium === ReceiptMedium.EXTERNAL_ELECTRONIC &&
      files.some((file) => categoryFromContentType(file.contentType) === category)
    ) {
      throw new ConflictException(`El comprobante electrónico ya tiene un archivo ${category}`);
    }
  }
}
