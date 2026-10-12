import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
const LIMA_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" });
const CALENDAR_DAY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizePlate(plate: string): string {
  return plate.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function diffCalendarDays(fromDay: string, toDay: string): number {
  const parts1 = CALENDAR_DAY_REGEX.exec(fromDay);
  const parts2 = CALENDAR_DAY_REGEX.exec(toDay);
  if (!parts1 || !parts2) return 0;
  const utc1 = Date.UTC(Number(parts1[1]), Number(parts1[2]) - 1, Number(parts1[3]));
  const utc2 = Date.UTC(Number(parts2[1]), Number(parts2[2]) - 1, Number(parts2[3]));
  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

export type VehicleReviewStatusCode = "VIGENTE" | "POR_VENCER" | "VENCIDA" | "SIN_REGISTRO";

export function calculateReviewStatus(
  endsOn: string,
  todayLima: string,
): { status: "VIGENTE" | "POR_VENCER" | "VENCIDA"; daysRemaining: number } {
  const daysRemaining = diffCalendarDays(todayLima, endsOn);
  if (daysRemaining < 0) {
    return { status: "VENCIDA", daysRemaining };
  }
  if (daysRemaining <= 15) {
    return { status: "POR_VENCER", daysRemaining };
  }
  return { status: "VIGENTE", daysRemaining };
}
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateVehicleDto } from "./dto/create-vehicle.dto.js";
import type { UpdateVehicleDto } from "./dto/update-vehicle.dto.js";
import type { VehicleResponseDto } from "./dto/vehicle-response.dto.js";
import type { CreateVehicleReviewTypeDto } from "./dto/create-vehicle-review-type.dto.js";
import type { UpdateVehicleReviewTypeDto } from "./dto/update-vehicle-review-type.dto.js";
import type { VehicleReviewTypeResponseDto } from "./dto/vehicle-review-type-response.dto.js";
import type { CreateVehicleReviewDto } from "./dto/create-vehicle-review.dto.js";
import type { VoidVehicleReviewDto } from "./dto/void-vehicle-review.dto.js";
import type {
  VehicleReviewResponseDto,
  VehicleReviewTypeStatusDto,
} from "./dto/vehicle-review-response.dto.js";
import type { UpcomingReviewAlertDto } from "./dto/upcoming-reviews-response.dto.js";

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseBusinessDay(dayString: string): Date {
  return new Date(`${dayString}T00:00:00.000Z`);
}

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  getTodayLima(now: Date = new Date()): string {
    return LIMA_DAY_FORMAT.format(now);
  }

  // --- VEHICLES ---

  async createVehicle(dto: CreateVehicleDto, createdById: string): Promise<VehicleResponseDto> {
    const cleanPlate = normalizePlate(dto.plate);
    if (!cleanPlate) {
      throw new BadRequestException("La placa del vehículo no puede estar vacía");
    }

    const existing = await this.prisma.vehicle.findFirst({
      where: { plate: cleanPlate },
    });
    if (existing !== null) {
      throw new ConflictException(`Ya existe un vehículo con la placa "${cleanPlate}"`);
    }

    const vehicle = await this.prisma.vehicle.create({
      data: {
        plate: cleanPlate,
        name: dto.name.trim(),
        brand: dto.brand.trim(),
        model: dto.model.trim(),
        capacityUnits: dto.capacityUnits ?? null,
        vehicleClass: dto.vehicleClass?.trim() || null,
        circulationCardNumber: dto.circulationCardNumber?.trim() || null,
        active: true,
        createdById,
      },
    });

    return this.mapVehicle(vehicle);
  }

  async findAllVehicles(includeInactive = false): Promise<VehicleResponseDto[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ active: "desc" }, { plate: "asc" }],
    });
    return vehicles.map((v) => this.mapVehicle(v));
  }

  async findOneVehicle(id: string): Promise<VehicleResponseDto> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
    });
    if (!vehicle) {
      throw new NotFoundException(`El vehículo "${id}" no existe`);
    }
    return this.mapVehicle(vehicle);
  }

  async updateVehicle(
    id: string,
    dto: UpdateVehicleDto,
    updatedById: string,
  ): Promise<VehicleResponseDto> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
    });
    if (!vehicle) {
      throw new NotFoundException(`El vehículo "${id}" no existe`);
    }

    let cleanPlate: string | undefined = undefined;
    if (dto.plate !== undefined) {
      cleanPlate = normalizePlate(dto.plate);
      if (!cleanPlate) {
        throw new BadRequestException("La placa del vehículo no puede estar vacía");
      }
      if (cleanPlate !== vehicle.plate) {
        const usageCount = await this.prisma.routeVehicleAssignment.count({
          where: { vehicleId: id },
        });
        if (usageCount > 0) {
          throw new ConflictException(
            "La placa no se puede modificar porque el vehículo ya estuvo en una ruta. Desactiva este vehículo y crea uno nuevo.",
          );
        }

        const existingWithPlate = await this.prisma.vehicle.findFirst({
          where: { plate: cleanPlate, id: { not: id } },
        });
        if (existingWithPlate !== null) {
          throw new ConflictException(`Ya existe un vehículo con la placa "${cleanPlate}"`);
        }
      }
    }

    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(cleanPlate !== undefined ? { plate: cleanPlate } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.brand !== undefined ? { brand: dto.brand.trim() } : {}),
        ...(dto.model !== undefined ? { model: dto.model.trim() } : {}),
        ...(dto.capacityUnits !== undefined ? { capacityUnits: dto.capacityUnits } : {}),
        ...(dto.vehicleClass !== undefined ? { vehicleClass: dto.vehicleClass?.trim() || null } : {}),
        ...(dto.circulationCardNumber !== undefined
          ? { circulationCardNumber: dto.circulationCardNumber?.trim() || null }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        updatedById,
        updatedAt: new Date(),
      },
    });

    return this.mapVehicle(updated);
  }

  // --- VEHICLE REVIEW TYPES ---

  async findAllReviewTypes(includeInactive = false): Promise<VehicleReviewTypeResponseDto[]> {
    const types = await this.prisma.vehicleReviewType.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return types.map((t) => ({
      id: t.id,
      name: t.name,
      active: t.active,
      createdById: t.createdById,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async createReviewType(
    dto: CreateVehicleReviewTypeDto,
    createdById: string,
  ): Promise<VehicleReviewTypeResponseDto> {
    const trimmedName = dto.name.trim();
    if (!trimmedName) {
      throw new BadRequestException("El nombre del tipo de revisión no puede estar vacío");
    }

    const existing = await this.prisma.vehicleReviewType.findFirst({
      where: { name: trimmedName },
    });
    if (existing !== null) {
      throw new ConflictException(`Ya existe un tipo de revisión con el nombre "${trimmedName}"`);
    }

    const created = await this.prisma.vehicleReviewType.create({
      data: {
        name: trimmedName,
        active: true,
        createdById,
      },
    });

    return {
      id: created.id,
      name: created.name,
      active: created.active,
      createdById: created.createdById,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async updateReviewType(
    id: string,
    dto: UpdateVehicleReviewTypeDto,
  ): Promise<VehicleReviewTypeResponseDto> {
    const existing = await this.prisma.vehicleReviewType.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`El tipo de revisión "${id}" no existe`);
    }

    const updated = await this.prisma.vehicleReviewType.update({
      where: { id },
      data: {
        active: dto.active,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      active: updated.active,
      createdById: updated.createdById,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  // --- VEHICLE REVIEWS ---

  async createReview(
    vehicleId: string,
    dto: CreateVehicleReviewDto,
    recordedById: string,
  ): Promise<VehicleReviewResponseDto> {
    if (dto.endsOn < dto.startsOn) {
      throw new BadRequestException(
        "La fecha de vencimiento no puede ser anterior a la fecha de inicio",
      );
    }

    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) {
      throw new NotFoundException(`El vehículo "${vehicleId}" no existe`);
    }

    const reviewType = await this.prisma.vehicleReviewType.findUnique({
      where: { id: dto.reviewTypeId },
    });
    if (!reviewType || !reviewType.active) {
      throw new BadRequestException(
        `El tipo de revisión "${dto.reviewTypeId}" no existe o no está activo`,
      );
    }

    const created = await this.prisma.vehicleReview.create({
      data: {
        vehicleId,
        reviewTypeId: dto.reviewTypeId,
        startsOn: parseBusinessDay(dto.startsOn),
        endsOn: parseBusinessDay(dto.endsOn),
        notes: dto.notes?.trim() || null,
        recordedById,
      },
      include: {
        reviewType: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true } },
      },
    });

    return this.mapReview(created);
  }

  async findAllReviewsByVehicle(vehicleId: string): Promise<VehicleReviewResponseDto[]> {
    const reviews = await this.prisma.vehicleReview.findMany({
      where: { vehicleId },
      include: {
        reviewType: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ endsOn: "desc" }, { createdAt: "desc" }],
    });
    return reviews.map((r) => this.mapReview(r));
  }

  async voidReview(
    vehicleId: string,
    reviewId: string,
    dto: VoidVehicleReviewDto,
    voidedById: string,
  ): Promise<VehicleReviewResponseDto> {
    const voidReason = dto.voidReason.trim();
    if (!voidReason) {
      throw new BadRequestException("El motivo de anulación es obligatorio");
    }

    const review = await this.prisma.vehicleReview.findUnique({
      where: { id: reviewId },
      include: {
        reviewType: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true } },
      },
    });
    if (!review || review.vehicleId !== vehicleId) {
      throw new NotFoundException(`La revisión "${reviewId}" no existe para este vehículo`);
    }
    if (review.voidedAt !== null) {
      throw new ConflictException("Esta revisión ya ha sido anulada");
    }

    const updated = await this.prisma.vehicleReview.update({
      where: { id: reviewId },
      data: {
        voidedAt: new Date(),
        voidedById,
        voidReason,
      },
      include: {
        reviewType: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true } },
      },
    });

    return this.mapReview(updated);
  }

  async getVehicleReviewsStatus(
    vehicleId: string,
    todayOverride?: string,
  ): Promise<VehicleReviewTypeStatusDto[]> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) {
      throw new NotFoundException(`El vehículo "${vehicleId}" no existe`);
    }

    const today = todayOverride ?? this.getTodayLima();
    const reviewTypes = await this.prisma.vehicleReviewType.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });

    const reviews = await this.prisma.vehicleReview.findMany({
      where: { vehicleId, voidedAt: null },
      include: {
        reviewType: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ endsOn: "desc" }, { createdAt: "desc" }],
    });

    const statuses: VehicleReviewTypeStatusDto[] = [];
    for (const rt of reviewTypes) {
      const latest = reviews.find((r) => r.reviewTypeId === rt.id && r.voidedAt === null);
      if (!latest) {
        statuses.push({
          reviewTypeId: rt.id,
          reviewTypeName: rt.name,
          status: "SIN_REGISTRO",
          daysRemaining: null,
          latestReview: null,
        });
      } else {
        const endsOnStr = toDateString(latest.endsOn);
        const { status, daysRemaining } = calculateReviewStatus(endsOnStr, today);
        statuses.push({
          reviewTypeId: rt.id,
          reviewTypeName: rt.name,
          status,
          daysRemaining,
          latestReview: this.mapReview(latest),
        });
      }
    }

    return statuses;
  }

  // --- ALERTS (FOR DASHBOARD & ASSIGNMENT CHECK) ---

  async getUpcomingReviewAlerts(todayOverride?: string): Promise<UpcomingReviewAlertDto[]> {
    const today = todayOverride ?? this.getTodayLima();
    const alerts: UpcomingReviewAlertDto[] = [];

    // 1. Vehicle reviews for active vehicles
    const activeVehicles = await this.prisma.vehicle.findMany({
      where: { active: true },
      select: { id: true, plate: true, name: true },
    });

    for (const v of activeVehicles) {
      const statuses = await this.getVehicleReviewsStatus(v.id, today);
      for (const st of statuses) {
        if (st.status === "POR_VENCER" || st.status === "VENCIDA") {
          alerts.push({
            type: "VEHICLE_REVIEW",
            targetId: v.id,
            targetName: `${v.plate} (${v.name})`,
            detail: st.reviewTypeName,
            expiresOn: st.latestReview?.endsOn ?? today,
            daysRemaining: st.daysRemaining ?? 0,
            status: st.status,
          });
        }
      }
    }

    // 2. Driver license expiration for active drivers
    const activeDrivers = await this.prisma.user.findMany({
      where: {
        active: true,
        roles: { some: { role: { name: UserRole.DRIVER } } },
        licenseExpiresOn: { not: null },
      },
      select: {
        id: true,
        name: true,
        licenseNumber: true,
        licenseCategory: true,
        licenseExpiresOn: true,
      },
    });

    for (const d of activeDrivers) {
      if (d.licenseExpiresOn) {
        const expiresOnStr = toDateString(d.licenseExpiresOn);
        const daysRemaining = diffCalendarDays(today, expiresOnStr);
        let status: "POR_VENCER" | "VENCIDA" | null = null;
        if (daysRemaining < 0) {
          status = "VENCIDA";
        } else if (daysRemaining <= 15) {
          status = "POR_VENCER";
        }
        if (status !== null) {
          alerts.push({
            type: "DRIVER_LICENSE",
            targetId: d.id,
            targetName: d.name,
            detail: `Licencia ${d.licenseCategory ? `${d.licenseCategory} ` : ""}(${d.licenseNumber ?? "s/n"})`,
            expiresOn: expiresOnStr,
            daysRemaining,
            status,
          });
        }
      }
    }

    // Order alerts: VENCIDA first, then soonest expiration
    alerts.sort((a, b) => {
      if (a.status === "VENCIDA" && b.status !== "VENCIDA") return -1;
      if (a.status !== "VENCIDA" && b.status === "VENCIDA") return 1;
      return a.daysRemaining - b.daysRemaining;
    });

    return alerts;
  }

  async calculateVehicleAndDriverWarnings(
    vehicleId: string,
    driverId: string,
    routeDate: string,
    excludeRouteId?: string,
  ): Promise<string[]> {
    const warnings: string[] = [];
    const today = this.getTodayLima();

    // 1. Vehicle reviews
    const reviewStatuses = await this.getVehicleReviewsStatus(vehicleId, today);
    for (const st of reviewStatuses) {
      if (st.status === "VENCIDA") {
        warnings.push(`El vehículo tiene la revisión "${st.reviewTypeName}" vencida`);
      } else if (st.status === "POR_VENCER") {
        warnings.push(`El vehículo tiene la revisión "${st.reviewTypeName}" por vencer`);
      }
    }

    // 2. Driver license
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      select: { licenseExpiresOn: true },
    });
    if (driver?.licenseExpiresOn) {
      const expiresOnStr = toDateString(driver.licenseExpiresOn);
      const diff = diffCalendarDays(today, expiresOnStr);
      if (diff < 0) {
        warnings.push("La licencia de conducir del chofer está vencida");
      } else if (diff <= 15) {
        warnings.push("La licencia de conducir del chofer está por vencer");
      }
    }

    // 3. Vehicle in another IN_PROGRESS route today
    const inProgressRoute = await this.prisma.route.findFirst({
      where: {
        vehicleId,
        date: parseBusinessDay(routeDate),
        status: "IN_PROGRESS",
        ...(excludeRouteId ? { id: { not: excludeRouteId } } : {}),
      },
      select: { id: true },
    });
    if (inProgressRoute !== null) {
      warnings.push("El vehículo ya se encuentra en uso en otra ruta en curso el día de hoy");
    }

    return warnings;
  }

  // --- PRIVATE HELPERS ---

  private mapVehicle(v: {
    id: string;
    plate: string;
    name: string;
    brand: string;
    model: string;
    capacityUnits: number | null;
    vehicleClass: string | null;
    circulationCardNumber: string | null;
    active: boolean;
    createdById: string;
    createdAt: Date;
    updatedById: string | null;
    updatedAt: Date | null;
  }): VehicleResponseDto {
    return {
      id: v.id,
      plate: v.plate,
      name: v.name,
      brand: v.brand,
      model: v.model,
      capacityUnits: v.capacityUnits,
      vehicleClass: v.vehicleClass,
      circulationCardNumber: v.circulationCardNumber,
      active: v.active,
      createdById: v.createdById,
      createdAt: v.createdAt.toISOString(),
      updatedById: v.updatedById,
      updatedAt: v.updatedAt ? v.updatedAt.toISOString() : null,
    };
  }

  private mapReview(r: {
    id: string;
    vehicleId: string;
    reviewTypeId: string;
    reviewType: { id: string; name: string };
    startsOn: Date;
    endsOn: Date;
    notes: string | null;
    recordedById: string;
    recordedBy: { id: string; name: string };
    createdAt: Date;
    voidedAt: Date | null;
    voidedById: string | null;
    voidedBy: { id: string; name: string } | null;
    voidReason: string | null;
  }): VehicleReviewResponseDto {
    return {
      id: r.id,
      vehicleId: r.vehicleId,
      reviewTypeId: r.reviewTypeId,
      reviewType: r.reviewType,
      startsOn: toDateString(r.startsOn),
      endsOn: toDateString(r.endsOn),
      notes: r.notes,
      recordedById: r.recordedById,
      recordedBy: r.recordedBy,
      createdAt: r.createdAt.toISOString(),
      voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
      voidedById: r.voidedById,
      voidedBy: r.voidedBy,
      voidReason: r.voidReason,
    };
  }
}
