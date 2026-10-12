import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { BadRequestException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Readable } from "node:stream";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import { CustomerLocationOperationsController } from "./customer-location-operations.controller.js";
import type { CustomerLocationsService } from "./customer-locations.service.js";

type MockAsyncFn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

interface MockService {
  findPhotos: MockAsyncFn;
  uploadPhoto: MockAsyncFn;
  getRawPhoto: MockAsyncFn;
  hidePhoto: MockAsyncFn;
  reviewPhoto: MockAsyncFn;
  findCoordinateRequests: MockAsyncFn;
  createCoordinateRequest: MockAsyncFn;
  reviewCoordinateRequest: MockAsyncFn;
}

describe("CustomerLocationOperationsController", () => {
  let controller: CustomerLocationOperationsController;
  let service: MockService;

  const mockAdminUser = {
    sub: "admin-id",
    username: "admin",
    roles: [UserRole.ADMIN],
  };

  const mockReq = {
    user: mockAdminUser,
  } as unknown as AuthenticatedRequest;

  beforeEach(() => {
    service = {
      findPhotos: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      uploadPhoto: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      getRawPhoto: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      hidePhoto: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      reviewPhoto: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      findCoordinateRequests: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      createCoordinateRequest: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      reviewCoordinateRequest: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    controller = new CustomerLocationOperationsController(
      service as unknown as CustomerLocationsService,
    );
  });

  it("delegates findPhotos to service", async () => {
    service.findPhotos.mockResolvedValueOnce([{ id: "p1" }]);
    const result = await controller.findPhotos("loc-1", mockReq);
    expect(service.findPhotos).toHaveBeenCalledWith("loc-1", mockAdminUser);
    expect(result).toEqual([{ id: "p1" }]);
  });

  it("throws BadRequestException when file is missing in uploadPhoto", () => {
    expect(() => controller.uploadPhoto("loc-1", undefined, mockReq)).toThrow(BadRequestException);
  });

  it("delegates uploadPhoto to service when file is present", async () => {
    const file = {
      buffer: Buffer.from("image"),
      originalname: "test.jpg",
      mimetype: "image/jpeg",
    };
    service.uploadPhoto.mockResolvedValueOnce({ id: "p1" });

    const result = await controller.uploadPhoto("loc-1", file, mockReq);
    expect(service.uploadPhoto).toHaveBeenCalledWith("loc-1", file, mockAdminUser);
    expect(result).toEqual({ id: "p1" });
  });

  it("sets headers and pipes stream in getRawPhoto", async () => {
    const pipeFn = jest.fn();
    const stream = { pipe: pipeFn } as unknown as Readable;
    service.getRawPhoto.mockResolvedValueOnce({
      stream,
      contentType: "image/jpeg",
      sizeBytes: 100,
    });

    const mockRes = {
      setHeader: jest.fn(),
    } as unknown as Response;

    await controller.getRawPhoto("photo-1", mockReq, mockRes);
    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "image/jpeg");
    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Length", 100);
    expect(pipeFn).toHaveBeenCalledWith(mockRes);
  });

  it("delegates hidePhoto to service", async () => {
    service.hidePhoto.mockResolvedValueOnce({ id: "p1" });
    const result = await controller.hidePhoto("p1", { reason: "Motivo" }, mockReq);
    expect(service.hidePhoto).toHaveBeenCalledWith("p1", "Motivo", "admin-id");
    expect(result).toEqual({ id: "p1" });
  });

  it("delegates reviewPhoto to service", async () => {
    service.reviewPhoto.mockResolvedValueOnce({ id: "p1" });
    const dto = { status: "APPROVED" as const };
    const result = await controller.reviewPhoto("p1", dto, mockReq);
    expect(service.reviewPhoto).toHaveBeenCalledWith("p1", dto, "admin-id");
    expect(result).toEqual({ id: "p1" });
  });

  it("delegates findCoordinateRequests to service", async () => {
    service.findCoordinateRequests.mockResolvedValueOnce([{ id: "cr1" }]);
    const result = await controller.findCoordinateRequests("loc-1");
    expect(service.findCoordinateRequests).toHaveBeenCalledWith("loc-1");
    expect(result).toEqual([{ id: "cr1" }]);
  });

  it("delegates createCoordinateRequest to service", async () => {
    service.createCoordinateRequest.mockResolvedValueOnce({ id: "cr1" });
    const dto = { latitude: "-12.0", longitude: "-77.0" };
    const result = await controller.createCoordinateRequest("loc-1", dto, mockReq);
    expect(service.createCoordinateRequest).toHaveBeenCalledWith("loc-1", dto, mockAdminUser);
    expect(result).toEqual({ id: "cr1" });
  });

  it("delegates reviewCoordinateRequest to service", async () => {
    service.reviewCoordinateRequest.mockResolvedValueOnce({ id: "cr1" });
    const dto = { status: "APPROVED" as const };
    const result = await controller.reviewCoordinateRequest("cr1", dto, mockReq);
    expect(service.reviewCoordinateRequest).toHaveBeenCalledWith("cr1", dto, "admin-id");
    expect(result).toEqual({ id: "cr1" });
  });
});
