import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CoordinateRequestStatus, LocationPhotoStatus, Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import type { CreateCoordinateRequestDto } from "./dto/create-coordinate-request.dto.js";
import type { CustomerLocationCoordinateRequestResponseDto } from "./dto/customer-location-coordinate-request-response.dto.js";
import type { CustomerLocationPhotoResponseDto } from "./dto/customer-location-photo-response.dto.js";
import type { CustomerLocationResponseDto } from "./dto/customer-location-response.dto.js";
import type { ListCustomerLocationsQueryDto } from "./dto/list-customer-locations-query.dto.js";
import type { PendingApprovalsResponseDto } from "./dto/pending-approvals-response.dto.js";
import type { ReviewCoordinateRequestDto } from "./dto/review-coordinate-request.dto.js";
import type { ReviewPhotoDto } from "./dto/review-photo.dto.js";
import type { UpdateCustomerLocationDto } from "./dto/update-customer-location.dto.js";
import { GoogleMapsLinkRequester } from "./google-maps-link-requester.js";
import { validateImageFile } from "./image-file.validator.js";

const LOCATION_SELECT = {
  id: true,
  name: true,
  address: true,
  addressReference: true,
  phone: true,
  contactName: true,
  latitude: true,
  longitude: true,
  isPrimary: true,
  active: true,
  externalCode: true,
} as const;

const GOOGLE_MAPS_REDIRECT_HOSTS = new Set([
  "google.com",
  "maps.app.goo.gl",
  "maps.google.com",
  "www.google.com",
]);

type LocationRow = Prisma.CustomerLocationGetPayload<{ select: typeof LOCATION_SELECT }>;

function toResponse(location: LocationRow): CustomerLocationResponseDto {
  return {
    ...location,
    latitude: location.latitude?.toFixed(6) ?? null,
    longitude: location.longitude?.toFixed(6) ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPhotoResponse(photo: any): CustomerLocationPhotoResponseDto {
  return {
    id: photo.id,
    locationId: photo.locationId,
    objectKey: photo.objectKey,
    contentType: photo.contentType,
    sizeBytes: photo.sizeBytes,
    status: photo.status,
    uploadedById: photo.uploadedById,
    createdAt: photo.createdAt,
    reviewedById: photo.reviewedById,
    reviewedAt: photo.reviewedAt,
    rejectionReason: photo.rejectionReason,
    hiddenById: photo.hiddenById,
    hiddenAt: photo.hiddenAt,
    hiddenReason: photo.hiddenReason,
    uploadedBy: photo.uploadedBy,
    reviewedBy: photo.reviewedBy,
    hiddenBy: photo.hiddenBy,
    location: photo.location,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCoordinateRequestResponse(req: any): CustomerLocationCoordinateRequestResponseDto {
  return {
    id: req.id,
    locationId: req.locationId,
    latitude: req.latitude.toFixed(6),
    longitude: req.longitude.toFixed(6),
    accuracyM: req.accuracyM?.toFixed(2) ?? null,
    previousLatitude: req.previousLatitude?.toFixed(6) ?? null,
    previousLongitude: req.previousLongitude?.toFixed(6) ?? null,
    status: req.status,
    requestedById: req.requestedById,
    createdAt: req.createdAt,
    reviewedById: req.reviewedById,
    reviewedAt: req.reviewedAt,
    rejectionReason: req.rejectionReason,
    requestedBy: req.requestedBy,
    reviewedBy: req.reviewedBy,
    location: req.location,
  };
}

function googleMapsUrl(value: string, shortOnly = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException("El enlace de Google Maps no es válido");
  }
  const allowedHost = shortOnly
    ? url.hostname === "maps.app.goo.gl"
    : GOOGLE_MAPS_REDIRECT_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" || url.port !== "" || !allowedHost) {
    throw new BadRequestException("Solo se aceptan enlaces seguros de Google Maps");
  }
  if (url.hostname !== "maps.app.goo.gl" && !url.pathname.startsWith("/maps")) {
    throw new BadRequestException("El enlace no lleva a Google Maps");
  }
  return url;
}

export interface UploadedFileParam {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

@Injectable()
export class CustomerLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleMapsLinkRequester: GoogleMapsLinkRequester,
    private readonly storageService: StorageService,
  ) {}

  /** Active locations only by default; there are only a handful per customer. */
  async findAll(
    customerId: string,
    query: ListCustomerLocationsQueryDto,
  ): Promise<CustomerLocationResponseDto[]> {
    await this.assertCustomerExists(customerId);

    const locations = await this.prisma.customerLocation.findMany({
      where: { customerId, active: query.active ?? true },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      select: LOCATION_SELECT,
    });
    return locations.map(toResponse);
  }

  async update(
    customerId: string,
    locationId: string,
    dto: UpdateCustomerLocationDto,
  ): Promise<CustomerLocationResponseDto> {
    const result = await this.prisma.customerLocation.updateMany({
      where: { id: locationId, customerId },
      data: {
        ...(dto.contactName !== undefined
          ? { contactName: dto.contactName === null ? null : dto.contactName.trim() || null }
          : {}),
        ...(dto.latitude !== undefined
          ? { latitude: dto.latitude === null ? null : new Prisma.Decimal(dto.latitude) }
          : {}),
        ...(dto.longitude !== undefined
          ? { longitude: dto.longitude === null ? null : new Prisma.Decimal(dto.longitude) }
          : {}),
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(`El local "${locationId}" no pertenece a este cliente`);
    }
    const location = await this.prisma.customerLocation.findFirstOrThrow({
      where: { id: locationId, customerId },
      select: LOCATION_SELECT,
    });
    return toResponse(location);
  }

  async resolveGoogleMapsLink(customerId: string, value: string): Promise<{ url: string }> {
    await this.assertCustomerExists(customerId);
    let current = googleMapsUrl(value, true);

    for (let redirect = 0; redirect < 5; redirect++) {
      let response: { status: number; location: string | null };
      try {
        response = await this.googleMapsLinkRequester.getRedirect(
          `${current.pathname}${current.search}`,
        );
      } catch {
        throw new BadRequestException("No se pudo abrir el enlace abreviado de Google Maps");
      }
      const { location } = response;
      if (response.status < 300 || response.status >= 400 || location === null) {
        throw new BadRequestException("El enlace abreviado de Google Maps no se pudo expandir");
      }
      current = googleMapsUrl(new URL(location, current).toString());
      if (current.hostname !== "maps.app.goo.gl") return { url: current.toString() };
    }

    throw new BadRequestException("El enlace abreviado de Google Maps tiene demasiados desvíos");
  }

  async assertDriverHasAccessToLocation(driverId: string, locationId: string): Promise<void> {
    const hasStop = await this.prisma.routeStop.findFirst({
      where: {
        locationId,
        route: { driverId },
      },
      select: { id: true },
    });
    if (hasStop === null) {
      throw new ForbiddenException("No tienes acceso a este local");
    }
  }

  private isStaff(roles: UserRole[]): boolean {
    return roles.includes(UserRole.ADMIN) || roles.includes(UserRole.SELLER);
  }

  private async assertLocationExists(locationId: string): Promise<void> {
    const loc = await this.prisma.customerLocation.findUnique({
      where: { id: locationId },
      select: { id: true },
    });
    if (loc === null) {
      throw new NotFoundException(`El local "${locationId}" no existe`);
    }
  }

  // --- Photos -------------------------------------------------------------

  async uploadPhoto(
    locationId: string,
    file: UploadedFileParam,
    user: { sub: string; roles: UserRole[] },
  ): Promise<CustomerLocationPhotoResponseDto> {
    await this.assertLocationExists(locationId);

    const isStaff = this.isStaff(user.roles);
    if (!isStaff) {
      await this.assertDriverHasAccessToLocation(user.sub, locationId);
    }

    if (isStaff) {
      const approvedCount = await this.prisma.customerLocationPhoto.count({
        where: {
          locationId,
          status: LocationPhotoStatus.APPROVED,
          hiddenAt: null,
        },
      });
      if (approvedCount >= 10) {
        throw new BadRequestException("El local ya tiene el máximo de 10 fotos visibles");
      }
    }

    const { contentType, extension } = validateImageFile(file.buffer);
    const objectKey = `customer-locations/${locationId}/${randomUUID()}.${extension}`;

    await this.storageService.upload(objectKey, file.buffer, contentType);

    const status = isStaff ? LocationPhotoStatus.APPROVED : LocationPhotoStatus.PENDING;
    const reviewedById = isStaff ? user.sub : null;
    const reviewedAt = isStaff ? new Date() : null;

    const photo = await this.prisma.customerLocationPhoto.create({
      data: {
        locationId,
        objectKey,
        contentType,
        sizeBytes: file.buffer.length,
        status,
        uploadedById: user.sub,
        reviewedById,
        reviewedAt,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });

    return toPhotoResponse(photo);
  }

  async findPhotos(
    locationId: string,
    user: { sub: string; roles: UserRole[] },
  ): Promise<CustomerLocationPhotoResponseDto[]> {
    await this.assertLocationExists(locationId);

    const isStaff = this.isStaff(user.roles);
    if (!isStaff) {
      await this.assertDriverHasAccessToLocation(user.sub, locationId);
    }

    const photos = await this.prisma.customerLocationPhoto.findMany({
      where: {
        locationId,
        hiddenAt: null,
        status: LocationPhotoStatus.APPROVED,
      },
      orderBy: { createdAt: "asc" },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        hiddenBy: { select: { id: true, name: true } },
      },
    });

    return photos.map(toPhotoResponse);
  }

  async getRawPhoto(
    photoId: string,
    user: { sub: string; roles: UserRole[] },
  ): Promise<{ stream: Readable; contentType: string; sizeBytes: number }> {
    const photo = await this.prisma.customerLocationPhoto.findUnique({
      where: { id: photoId },
    });
    if (photo === null) {
      throw new NotFoundException(`La foto "${photoId}" no existe`);
    }

    const isStaff = this.isStaff(user.roles);
    if (!isStaff) {
      if (photo.status !== LocationPhotoStatus.APPROVED || photo.hiddenAt !== null) {
        throw new ForbiddenException("No tienes acceso a esta foto");
      }
      await this.assertDriverHasAccessToLocation(user.sub, photo.locationId);
    }

    const storageObj = await this.storageService.get(photo.objectKey);
    return {
      stream: storageObj.stream,
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
    };
  }

  async hidePhoto(
    photoId: string,
    reason: string,
    adminId: string,
  ): Promise<CustomerLocationPhotoResponseDto> {
    const photo = await this.prisma.customerLocationPhoto.findUnique({
      where: { id: photoId },
    });
    if (photo === null) {
      throw new NotFoundException(`La foto "${photoId}" no existe`);
    }

    const updated = await this.prisma.customerLocationPhoto.update({
      where: { id: photoId },
      data: {
        hiddenById: adminId,
        hiddenAt: new Date(),
        hiddenReason: reason.trim(),
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        hiddenBy: { select: { id: true, name: true } },
      },
    });

    return toPhotoResponse(updated);
  }

  async reviewPhoto(
    photoId: string,
    dto: ReviewPhotoDto,
    adminId: string,
  ): Promise<CustomerLocationPhotoResponseDto> {
    const photo = await this.prisma.customerLocationPhoto.findUnique({
      where: { id: photoId },
    });
    if (photo === null) {
      throw new NotFoundException(`La foto "${photoId}" no existe`);
    }

    if (dto.status === "REJECTED") {
      if (!dto.rejectionReason?.trim()) {
        throw new BadRequestException("El motivo de rechazo es obligatorio");
      }
    } else if (dto.status === "APPROVED") {
      const approvedCount = await this.prisma.customerLocationPhoto.count({
        where: {
          locationId: photo.locationId,
          status: LocationPhotoStatus.APPROVED,
          hiddenAt: null,
        },
      });
      if (approvedCount >= 10) {
        throw new BadRequestException("El local ya tiene el máximo de 10 fotos visibles");
      }
    }

    const updated = await this.prisma.customerLocationPhoto.update({
      where: { id: photoId },
      data: {
        status: dto.status as LocationPhotoStatus,
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: dto.status === "REJECTED" ? dto.rejectionReason?.trim() || null : null,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        hiddenBy: { select: { id: true, name: true } },
      },
    });

    return toPhotoResponse(updated);
  }

  // --- Coordinate Requests ------------------------------------------------

  async createCoordinateRequest(
    locationId: string,
    dto: CreateCoordinateRequestDto,
    user: { sub: string; roles: UserRole[] },
  ): Promise<CustomerLocationCoordinateRequestResponseDto> {
    const location = await this.prisma.customerLocation.findUnique({
      where: { id: locationId },
      select: { id: true, latitude: true, longitude: true },
    });
    if (location === null) {
      throw new NotFoundException(`El local "${locationId}" no existe`);
    }

    if (!this.isStaff(user.roles)) {
      await this.assertDriverHasAccessToLocation(user.sub, locationId);
    }

    const request = await this.prisma.customerLocationCoordinateRequest.create({
      data: {
        locationId,
        latitude: new Prisma.Decimal(dto.latitude),
        longitude: new Prisma.Decimal(dto.longitude),
        accuracyM: dto.accuracyM ? new Prisma.Decimal(dto.accuracyM) : null,
        previousLatitude: location.latitude,
        previousLongitude: location.longitude,
        status: CoordinateRequestStatus.PENDING,
        requestedById: user.sub,
      },
      include: {
        requestedBy: { select: { id: true, name: true } },
      },
    });

    return toCoordinateRequestResponse(request);
  }

  async findCoordinateRequests(
    locationId: string,
  ): Promise<CustomerLocationCoordinateRequestResponseDto[]> {
    await this.assertLocationExists(locationId);

    const requests = await this.prisma.customerLocationCoordinateRequest.findMany({
      where: { locationId },
      orderBy: { createdAt: "desc" },
      include: {
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });

    return requests.map(toCoordinateRequestResponse);
  }

  async reviewCoordinateRequest(
    requestId: string,
    dto: ReviewCoordinateRequestDto,
    adminId: string,
  ): Promise<CustomerLocationCoordinateRequestResponseDto> {
    const request = await this.prisma.customerLocationCoordinateRequest.findUnique({
      where: { id: requestId },
    });
    if (request === null) {
      throw new NotFoundException(`La solicitud "${requestId}" no existe`);
    }

    if (dto.status === "REJECTED") {
      if (!dto.rejectionReason?.trim()) {
        throw new BadRequestException("El motivo de rechazo es obligatorio");
      }
      const updated = await this.prisma.customerLocationCoordinateRequest.update({
        where: { id: requestId },
        data: {
          status: CoordinateRequestStatus.REJECTED,
          reviewedById: adminId,
          reviewedAt: new Date(),
          rejectionReason: dto.rejectionReason.trim(),
        },
        include: {
          requestedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
      });
      return toCoordinateRequestResponse(updated);
    }

    // APPROVED: updates location coordinates and preserves previous coordinates in same tx
    const [updated] = await this.prisma.$transaction([
      this.prisma.customerLocationCoordinateRequest.update({
        where: { id: requestId },
        data: {
          status: CoordinateRequestStatus.APPROVED,
          reviewedById: adminId,
          reviewedAt: new Date(),
          rejectionReason: null,
        },
        include: {
          requestedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.customerLocation.update({
        where: { id: request.locationId },
        data: {
          latitude: request.latitude,
          longitude: request.longitude,
        },
      }),
    ]);

    return toCoordinateRequestResponse(updated);
  }

  // --- Pending Approvals --------------------------------------------------

  async getPendingApprovals(): Promise<PendingApprovalsResponseDto> {
    const [photos, coordinateRequests] = await Promise.all([
      this.prisma.customerLocationPhoto.findMany({
        where: { status: LocationPhotoStatus.PENDING },
        orderBy: { createdAt: "asc" },
        include: {
          uploadedBy: { select: { id: true, name: true } },
          location: {
            select: {
              id: true,
              name: true,
              customer: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.customerLocationCoordinateRequest.findMany({
        where: { status: CoordinateRequestStatus.PENDING },
        orderBy: { createdAt: "asc" },
        include: {
          requestedBy: { select: { id: true, name: true } },
          location: {
            select: {
              id: true,
              name: true,
              customer: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    return {
      photos: photos.map(toPhotoResponse),
      coordinateRequests: coordinateRequests.map(toCoordinateRequestResponse),
      totalPending: photos.length + coordinateRequests.length,
    };
  }

  private async assertCustomerExists(customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (customer === null) {
      throw new NotFoundException(`El cliente "${customerId}" no existe`);
    }
  }
}
