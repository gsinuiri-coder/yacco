import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateIssuerSettingsDto } from "./dto/create-issuer-settings.dto.js";
import type { IssuerSettingsResponseDto } from "./dto/issuer-settings-response.dto.js";

const ISSUER_SETTINGS_INCLUDE = {
  createdBy: { select: { id: true, username: true } },
} satisfies Prisma.IssuerSettingsVersionInclude;

type SettingsWithCreator = Prisma.IssuerSettingsVersionGetPayload<{
  include: typeof ISSUER_SETTINGS_INCLUDE;
}>;

function toResponse(settings: SettingsWithCreator): IssuerSettingsResponseDto {
  return {
    id: settings.id,
    taxId: settings.taxId,
    legalName: settings.legalName,
    fiscalAddress: settings.fiscalAddress,
    taxRate: settings.taxRate.toFixed(2),
    receiptDocumentThreshold: settings.receiptDocumentThreshold.toFixed(2),
    createdById: settings.createdById,
    createdAt: settings.createdAt,
    createdBy: settings.createdBy,
  };
}

@Injectable()
export class IssuerSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateIssuerSettingsDto,
    createdById: string,
  ): Promise<IssuerSettingsResponseDto> {
    const settings = await this.prisma.issuerSettingsVersion.create({
      data: {
        taxId: dto.taxId.trim(),
        legalName: dto.legalName.trim(),
        fiscalAddress: dto.fiscalAddress.trim(),
        taxRate: new Prisma.Decimal(dto.taxRate),
        receiptDocumentThreshold: new Prisma.Decimal(dto.receiptDocumentThreshold),
        createdById,
      },
      include: ISSUER_SETTINGS_INCLUDE,
    });
    return toResponse(settings);
  }

  async getCurrent(): Promise<IssuerSettingsResponseDto | null> {
    const settings = await this.prisma.issuerSettingsVersion.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: ISSUER_SETTINGS_INCLUDE,
    });
    return settings === null ? null : toResponse(settings);
  }
}
