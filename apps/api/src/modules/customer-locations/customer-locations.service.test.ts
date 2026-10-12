import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CoordinateRequestStatus, LocationPhotoStatus, Prisma, UserRole } from "@prisma/client";
import { afterEach, jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { CustomerLocationsService } from "./customer-locations.service.js";
import { GoogleMapsLinkRequester } from "./google-maps-link-requester.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";

function buildLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: LOCATION_ID,
    customerId: CUSTOMER_ID,
    name: "Principal",
    address: "Av. Los Alamos 452",
    addressReference: "Portón azul",
    phone: "987654321",
    contactName: null,
    latitude: null,
    longitude: null,
    isPrimary: true,
    active: true,
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    customer: { findUnique: jest.fn<() => Promise<unknown>>() },
    customerLocation: {
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
      findFirstOrThrow: jest.fn<() => Promise<unknown>>(),
    },
    customerLocationPhoto: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    customerLocationCoordinateRequest: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    routeStop: {
      findFirst: jest.fn<() => Promise<unknown>>(),
    },
    $transaction: jest.fn<(operations: Promise<unknown>[]) => Promise<unknown[]>>(),
  };
}

describe("CustomerLocationsService", () => {
  let service: CustomerLocationsService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let googleMapsLinkRequester: {
    getRedirect: jest.Mock<GoogleMapsLinkRequester["getRedirect"]>;
  };
  let storageService: {
    isConfigured: jest.Mock<() => boolean>;
    upload: jest.Mock<() => Promise<void>>;
    get: jest.Mock<() => Promise<unknown>>;
    ensureBucket: jest.Mock<() => Promise<void>>;
  };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction.mockImplementation((operations) => Promise.all(operations));
    googleMapsLinkRequester = { getRedirect: jest.fn<GoogleMapsLinkRequester["getRedirect"]>() };
    storageService = {
      isConfigured: jest.fn<() => boolean>().mockReturnValue(true),
      upload: jest.fn<() => Promise<void>>().mockResolvedValue(),
      get: jest.fn<() => Promise<unknown>>(),
      ensureBucket: jest.fn<() => Promise<void>>().mockResolvedValue(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomerLocationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: GoogleMapsLinkRequester, useValue: googleMapsLinkRequester },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    service = moduleRef.get(CustomerLocationsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the customer's locations as-is", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([buildLocation()]);

    const result = await service.findAll(CUSTOMER_ID, {});

    expect(result).toEqual([buildLocation()]);
  });

  it("serializes stored coordinates with exactly six decimals", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([
      buildLocation({
        latitude: { toFixed: () => "-12.000000" },
        longitude: { toFixed: () => "-77.500000" },
      }),
    ]);

    await expect(service.findAll(CUSTOMER_ID, {})).resolves.toEqual([
      expect.objectContaining({ latitude: "-12.000000", longitude: "-77.500000" }),
    ]);
  });

  it("selects externalCode, read-only: the loader writes it, this route only reads it", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([]);

    await service.findAll(CUSTOMER_ID, {});

    expect(prisma.customerLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ externalCode: true }) }),
    );
  });

  it("selects the contact and coordinates needed by the customer record and route", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([]);

    await service.findAll(CUSTOMER_ID, {});

    expect(prisma.customerLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          contactName: true,
          latitude: true,
          longitude: true,
        }),
      }),
    );
  });

  it("scopes the query to this customer and defaults to active-only", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([]);

    await service.findAll(CUSTOMER_ID, {});

    expect(prisma.customerLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: CUSTOMER_ID, active: true } }),
    );
  });

  it("passes an explicit active:false through instead of defaulting it", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([]);

    await service.findAll(CUSTOMER_ID, { active: false });

    expect(prisma.customerLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: CUSTOMER_ID, active: false } }),
    );
  });

  it("rejects a customer id that does not exist", async () => {
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(service.findAll(CUSTOMER_ID, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerLocation.findMany).not.toHaveBeenCalled();
  });

  it("updates a location scoped to its customer and normalizes the contact", async () => {
    prisma.customerLocation.updateMany.mockResolvedValue({ count: 1 });
    prisma.customerLocation.findFirstOrThrow.mockResolvedValue(
      buildLocation({
        contactName: "Rosa Quispe",
        latitude: { toFixed: () => "-12.046374" },
        longitude: { toFixed: () => "-77.042793" },
      }),
    );

    const result = await service.update(CUSTOMER_ID, LOCATION_ID, {
      contactName: "  Rosa Quispe  ",
      latitude: "-12.046374",
      longitude: "-77.042793",
    });

    expect(prisma.customerLocation.updateMany).toHaveBeenCalledWith({
      where: { id: LOCATION_ID, customerId: CUSTOMER_ID },
      data: {
        contactName: "Rosa Quispe",
        latitude: expect.objectContaining({ toString: expect.any(Function) }),
        longitude: expect.objectContaining({ toString: expect.any(Function) }),
      },
    });
    expect(result).toMatchObject({
      contactName: "Rosa Quispe",
      latitude: "-12.046374",
      longitude: "-77.042793",
    });
  });

  it("rejects a location that does not belong to the customer", async () => {
    prisma.customerLocation.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.update(CUSTOMER_ID, LOCATION_ID, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.customerLocation.findFirstOrThrow).not.toHaveBeenCalled();
  });

  it("normalizes a blank contact to null and can clear coordinates", async () => {
    prisma.customerLocation.updateMany.mockResolvedValue({ count: 1 });
    prisma.customerLocation.findFirstOrThrow.mockResolvedValue(buildLocation());

    await service.update(CUSTOMER_ID, LOCATION_ID, {
      contactName: "   ",
      latitude: null,
      longitude: null,
    });

    expect(prisma.customerLocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { contactName: null, latitude: null, longitude: null },
      }),
    );
  });

  it("resolves only allowlisted Google Maps short links", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    googleMapsLinkRequester.getRedirect.mockResolvedValueOnce({
      status: 302,
      location: "https://www.google.com/maps/place/Local/data=!3d-12.046374!4d-77.042793",
    });

    await expect(
      service.resolveGoogleMapsLink(CUSTOMER_ID, "https://maps.app.goo.gl/AbC123"),
    ).resolves.toEqual({
      url: "https://www.google.com/maps/place/Local/data=!3d-12.046374!4d-77.042793",
    });
    expect(googleMapsLinkRequester.getRedirect).toHaveBeenCalledWith("/AbC123");
    await expect(
      service.resolveGoogleMapsLink(CUSTOMER_ID, "https://example.com/private"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    "no-es-url",
    "http://maps.app.goo.gl/AbC123",
    "https://maps.app.goo.gl:444/AbC123",
    "https://example.com/private",
  ])("rejects a non-allowlisted short link without fetching it: %s", async (url) => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });

    await expect(service.resolveGoogleMapsLink(CUSTOMER_ID, url)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(googleMapsLinkRequester.getRedirect).not.toHaveBeenCalled();
  });

  it("rejects a short link whose redirect leaves Google Maps", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    googleMapsLinkRequester.getRedirect.mockResolvedValueOnce({
      status: 302,
      location: "https://example.com/private",
    });

    await expect(
      service.resolveGoogleMapsLink(CUSTOMER_ID, "https://maps.app.goo.gl/AbC123"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("explains an unreachable or non-redirecting short link", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    googleMapsLinkRequester.getRedirect.mockRejectedValueOnce(new Error("offline"));
    await expect(
      service.resolveGoogleMapsLink(CUSTOMER_ID, "https://maps.app.goo.gl/Offline"),
    ).rejects.toBeInstanceOf(BadRequestException);

    googleMapsLinkRequester.getRedirect.mockResolvedValueOnce({ status: 200, location: null });
    await expect(
      service.resolveGoogleMapsLink(CUSTOMER_ID, "https://maps.app.goo.gl/NoRedirect"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stops a redirect loop after five hops", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    googleMapsLinkRequester.getRedirect.mockResolvedValue({
      status: 302,
      location: "https://maps.app.goo.gl/StillShort",
    });

    await expect(
      service.resolveGoogleMapsLink(CUSTOMER_ID, "https://maps.app.goo.gl/Loop"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe("photos (Fase 3, Fila 4)", () => {
    const adminUser = { sub: "admin-1", roles: [UserRole.ADMIN] };
    const driverUser = { sub: "driver-1", roles: [UserRole.DRIVER] };
    const validJpeg = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    };

    it("admin upload approves photo immediately and stores it in S3", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue(buildLocation());
      prisma.customerLocationPhoto.count.mockResolvedValue(2);
      prisma.customerLocationPhoto.create.mockResolvedValue({
        id: "photo-1",
        locationId: LOCATION_ID,
        objectKey: "customer-locations/22222222-2222-4222-8222-222222222222/abc.jpg",
        contentType: "image/jpeg",
        sizeBytes: validJpeg.buffer.length,
        status: LocationPhotoStatus.APPROVED,
        uploadedById: adminUser.sub,
        createdAt: new Date(),
        reviewedById: adminUser.sub,
        reviewedAt: new Date(),
        rejectionReason: null,
        hiddenById: null,
        hiddenAt: null,
        hiddenReason: null,
      });

      const result = await service.uploadPhoto(LOCATION_ID, validJpeg, adminUser);

      expect(result.status).toBe(LocationPhotoStatus.APPROVED);
      expect(result.reviewedById).toBe(adminUser.sub);
      expect(storageService.upload).toHaveBeenCalled();
    });

    it("rejects 11th visible photo when 10 already approved and visible", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue(buildLocation());
      prisma.customerLocationPhoto.count.mockResolvedValue(10); // 10 visible

      await expect(service.uploadPhoto(LOCATION_ID, validJpeg, adminUser)).rejects.toThrow(
        "El local ya tiene el máximo de 10 fotos visibles",
      );
    });

    it("allows 11th photo when one of existing 10 is hidden (count query filters hiddenAt: null)", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue(buildLocation());
      prisma.customerLocationPhoto.count.mockResolvedValue(9); // 9 visible (1 hidden)
      prisma.customerLocationPhoto.create.mockResolvedValue({
        id: "photo-11",
        locationId: LOCATION_ID,
        objectKey: "key.jpg",
        contentType: "image/jpeg",
        sizeBytes: validJpeg.buffer.length,
        status: LocationPhotoStatus.APPROVED,
        uploadedById: adminUser.sub,
        createdAt: new Date(),
        reviewedById: adminUser.sub,
        reviewedAt: new Date(),
        rejectionReason: null,
        hiddenById: null,
        hiddenAt: null,
        hiddenReason: null,
      });

      const result = await service.uploadPhoto(LOCATION_ID, validJpeg, adminUser);
      expect(result.id).toBe("photo-11");
    });

    it("driver upload creates PENDING photo request", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue(buildLocation());
      prisma.routeStop.findFirst.mockResolvedValue({ id: "stop-1" }); // on route
      prisma.customerLocationPhoto.create.mockResolvedValue({
        id: "photo-pending",
        locationId: LOCATION_ID,
        objectKey: "key.jpg",
        contentType: "image/jpeg",
        sizeBytes: validJpeg.buffer.length,
        status: LocationPhotoStatus.PENDING,
        uploadedById: driverUser.sub,
        createdAt: new Date(),
        reviewedById: null,
        reviewedAt: null,
        rejectionReason: null,
        hiddenById: null,
        hiddenAt: null,
        hiddenReason: null,
      });

      const result = await service.uploadPhoto(LOCATION_ID, validJpeg, driverUser);

      expect(result.status).toBe(LocationPhotoStatus.PENDING);
      expect(result.reviewedById).toBeNull();
    });

    it("driver upload fails with 403 when location is not on driver's routes", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue(buildLocation());
      prisma.routeStop.findFirst.mockResolvedValue(null); // not on route

      await expect(service.uploadPhoto(LOCATION_ID, validJpeg, driverUser)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("driver findPhotos returns only APPROVED photos and excludes PENDING", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue(buildLocation());
      prisma.routeStop.findFirst.mockResolvedValue({ id: "stop-1" });
      prisma.customerLocationPhoto.findMany.mockResolvedValue([
        {
          id: "photo-approved",
          locationId: LOCATION_ID,
          objectKey: "k1.jpg",
          contentType: "image/jpeg",
          sizeBytes: 100,
          status: LocationPhotoStatus.APPROVED,
          uploadedById: "u1",
          createdAt: new Date(),
          reviewedById: "u1",
          reviewedAt: new Date(),
          rejectionReason: null,
          hiddenById: null,
          hiddenAt: null,
          hiddenReason: null,
        },
      ]);

      const photos = await service.findPhotos(LOCATION_ID, driverUser);

      expect(photos).toHaveLength(1);
      expect(photos[0]!.status).toBe(LocationPhotoStatus.APPROVED);
      // verify query filtered status: APPROVED
      expect(prisma.customerLocationPhoto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: LocationPhotoStatus.APPROVED }),
        }),
      );
    });

    it("hidePhoto hides approved photo with mandatory reason and audit fields", async () => {
      prisma.customerLocationPhoto.findUnique.mockResolvedValue({ id: "photo-1" });
      const now = new Date();
      prisma.customerLocationPhoto.update.mockResolvedValue({
        id: "photo-1",
        locationId: LOCATION_ID,
        objectKey: "k1.jpg",
        contentType: "image/jpeg",
        sizeBytes: 100,
        status: LocationPhotoStatus.APPROVED,
        uploadedById: "u1",
        createdAt: new Date(),
        reviewedById: "u1",
        reviewedAt: new Date(),
        rejectionReason: null,
        hiddenById: adminUser.sub,
        hiddenAt: now,
        hiddenReason: "Local remodelado",
      });

      const result = await service.hidePhoto("photo-1", "Local remodelado", adminUser.sub);

      expect(result.hiddenById).toBe(adminUser.sub);
      expect(result.hiddenReason).toBe("Local remodelado");
    });

    it("reviewPhoto rejects photo when status is REJECTED and reason is provided", async () => {
      prisma.customerLocationPhoto.findUnique.mockResolvedValue({
        id: "photo-pending",
        locationId: LOCATION_ID,
      });
      prisma.customerLocationPhoto.update.mockResolvedValue({
        id: "photo-pending",
        locationId: LOCATION_ID,
        objectKey: "k.jpg",
        contentType: "image/jpeg",
        sizeBytes: 100,
        status: LocationPhotoStatus.REJECTED,
        uploadedById: "u1",
        createdAt: new Date(),
        reviewedById: adminUser.sub,
        reviewedAt: new Date(),
        rejectionReason: "Foto no muestra la entrada",
        hiddenById: null,
        hiddenAt: null,
        hiddenReason: null,
      });

      const result = await service.reviewPhoto(
        "photo-pending",
        { status: "REJECTED", rejectionReason: "Foto no muestra la entrada" },
        adminUser.sub,
      );

      expect(result.status).toBe(LocationPhotoStatus.REJECTED);
      expect(result.rejectionReason).toBe("Foto no muestra la entrada");
    });

    it("reviewPhoto throws 400 when rejected without reason", async () => {
      prisma.customerLocationPhoto.findUnique.mockResolvedValue({
        id: "photo-pending",
        locationId: LOCATION_ID,
      });

      await expect(
        service.reviewPhoto("photo-pending", { status: "REJECTED" }, adminUser.sub),
      ).rejects.toThrow("El motivo de rechazo es obligatorio");
    });
  });

  describe("coordinate requests (Fase 3, Fila 4)", () => {
    const driverUser = { sub: "driver-1", roles: [UserRole.DRIVER] };
    const adminUser = { sub: "admin-1", roles: [UserRole.ADMIN] };

    it("driver creates coordinate request with PENDING status and previous coordinates", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue(
        buildLocation({
          latitude: new Prisma.Decimal("-12.046000"),
          longitude: new Prisma.Decimal("-77.042000"),
        }),
      );
      prisma.routeStop.findFirst.mockResolvedValue({ id: "stop-1" });
      prisma.customerLocationCoordinateRequest.create.mockResolvedValue({
        id: "req-1",
        locationId: LOCATION_ID,
        latitude: new Prisma.Decimal("-12.046374"),
        longitude: new Prisma.Decimal("-77.042793"),
        accuracyM: new Prisma.Decimal("5.50"),
        previousLatitude: new Prisma.Decimal("-12.046000"),
        previousLongitude: new Prisma.Decimal("-77.042000"),
        status: CoordinateRequestStatus.PENDING,
        requestedById: driverUser.sub,
        createdAt: new Date(),
        reviewedById: null,
        reviewedAt: null,
        rejectionReason: null,
      });

      const result = await service.createCoordinateRequest(
        LOCATION_ID,
        { latitude: "-12.046374", longitude: "-77.042793", accuracyM: "5.50" },
        driverUser,
      );

      expect(result.status).toBe(CoordinateRequestStatus.PENDING);
      expect(result.previousLatitude).toBe("-12.046000");
      expect(result.latitude).toBe("-12.046374");
      // Location update was NOT called
      expect(prisma.customerLocation.update).not.toHaveBeenCalled();
    });

    it("driver proposing coordinates for location not on their routes throws 403", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue(buildLocation());
      prisma.routeStop.findFirst.mockResolvedValue(null);

      await expect(
        service.createCoordinateRequest(
          LOCATION_ID,
          { latitude: "-12.046374", longitude: "-77.042793" },
          driverUser,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("admin approving coordinate request updates request AND location coordinates in transaction", async () => {
      prisma.customerLocationCoordinateRequest.findUnique.mockResolvedValue({
        id: "req-1",
        locationId: LOCATION_ID,
        latitude: new Prisma.Decimal("-12.046374"),
        longitude: new Prisma.Decimal("-77.042793"),
        previousLatitude: new Prisma.Decimal("-12.046000"),
        previousLongitude: new Prisma.Decimal("-77.042000"),
      });
      prisma.customerLocationCoordinateRequest.update.mockResolvedValue({
        id: "req-1",
        locationId: LOCATION_ID,
        latitude: new Prisma.Decimal("-12.046374"),
        longitude: new Prisma.Decimal("-77.042793"),
        accuracyM: null,
        previousLatitude: new Prisma.Decimal("-12.046000"),
        previousLongitude: new Prisma.Decimal("-77.042000"),
        status: CoordinateRequestStatus.APPROVED,
        requestedById: driverUser.sub,
        createdAt: new Date(),
        reviewedById: adminUser.sub,
        reviewedAt: new Date(),
        rejectionReason: null,
      });
      prisma.customerLocation.update.mockResolvedValue(buildLocation());

      const result = await service.reviewCoordinateRequest(
        "req-1",
        { status: "APPROVED" },
        adminUser.sub,
      );

      expect(result.status).toBe(CoordinateRequestStatus.APPROVED);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.customerLocation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: LOCATION_ID },
          data: {
            latitude: new Prisma.Decimal("-12.046374"),
            longitude: new Prisma.Decimal("-77.042793"),
          },
        }),
      );
    });

    it("admin rejecting coordinate request requires rejection reason", async () => {
      prisma.customerLocationCoordinateRequest.findUnique.mockResolvedValue({
        id: "req-1",
        locationId: LOCATION_ID,
      });

      await expect(
        service.reviewCoordinateRequest("req-1", { status: "REJECTED" }, adminUser.sub),
      ).rejects.toThrow("El motivo de rechazo es obligatorio");
    });
  });

  describe("pending approvals inbox (Fase 3, Fila 4)", () => {
    it("returns all pending photos and coordinate requests", async () => {
      prisma.customerLocationPhoto.findMany.mockResolvedValue([
        {
          id: "photo-p1",
          locationId: LOCATION_ID,
          objectKey: "k.jpg",
          contentType: "image/jpeg",
          sizeBytes: 100,
          status: LocationPhotoStatus.PENDING,
          uploadedById: "u1",
          createdAt: new Date(),
          reviewedById: null,
          reviewedAt: null,
          rejectionReason: null,
          hiddenById: null,
          hiddenAt: null,
          hiddenReason: null,
        },
      ]);
      prisma.customerLocationCoordinateRequest.findMany.mockResolvedValue([
        {
          id: "req-p1",
          locationId: LOCATION_ID,
          latitude: new Prisma.Decimal("-12.046374"),
          longitude: new Prisma.Decimal("-77.042793"),
          accuracyM: null,
          previousLatitude: null,
          previousLongitude: null,
          status: CoordinateRequestStatus.PENDING,
          requestedById: "u1",
          createdAt: new Date(),
          reviewedById: null,
          reviewedAt: null,
          rejectionReason: null,
        },
      ]);

      const result = await service.getPendingApprovals();

      expect(result.photos).toHaveLength(1);
      expect(result.coordinateRequests).toHaveLength(1);
      expect(result.totalPending).toBe(2);
    });
  });
});
