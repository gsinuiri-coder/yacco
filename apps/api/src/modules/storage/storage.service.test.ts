import { jest } from "@jest/globals";
import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Readable } from "node:stream";
import { StorageService } from "./storage.service.js";

describe("StorageService", () => {
  it("reports unconfigured when no endpoint or credentials are provided", () => {
    const config = {
      get: (key: string) => (key === "S3_BUCKET" ? "test-bucket" : undefined),
    } as unknown as ConfigService;
    const service = new StorageService(config);

    expect(service.isConfigured()).toBe(false);
  });

  it("throws ServiceUnavailableException on upload when unconfigured", async () => {
    const config = {
      get: () => undefined,
    } as unknown as ConfigService;
    const service = new StorageService(config);

    await expect(service.upload("test.jpg", Buffer.from("data"), "image/jpeg")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("throws ServiceUnavailableException on get when unconfigured", async () => {
    const config = {
      get: () => undefined,
    } as unknown as ConfigService;
    const service = new StorageService(config);

    await expect(service.get("test.jpg")).rejects.toThrow(ServiceUnavailableException);
  });

  it("configures S3 client when endpoint is provided", async () => {
    const config = {
      get: (key: string) => {
        if (key === "S3_ENDPOINT") return "http://localhost:9000";
        if (key === "S3_BUCKET") return "my-bucket";
        return undefined;
      },
    } as unknown as ConfigService;
    const service = new StorageService(config);

    expect(service.isConfigured()).toBe(true);

    const mockSend = jest.fn().mockImplementation(async (command: unknown) => {
      const cmdName = (command as { constructor: { name: string } }).constructor.name;
      if (cmdName === "HeadBucketCommand") {
        return {};
      }
      if (cmdName === "PutObjectCommand") {
        return {};
      }
      if (cmdName === "GetObjectCommand") {
        return {
          Body: Readable.from([Buffer.from("image-content")]),
          ContentType: "image/jpeg",
          ContentLength: 13,
        };
      }
      return {};
    });
    (service as unknown as { client: { send: typeof mockSend } }).client = { send: mockSend };

    await service.upload("test.jpg", Buffer.from("image-content"), "image/jpeg");
    expect(mockSend).toHaveBeenCalled();

    const obj = await service.get("test.jpg");
    expect(obj.contentType).toBe("image/jpeg");
    expect(obj.contentLength).toBe(13);
  });

  it("handles bucket creation when head bucket fails", async () => {
    const config = {
      get: (key: string) => {
        if (key === "S3_ENDPOINT") return "http://localhost:9000";
        if (key === "S3_BUCKET") return "my-bucket";
        return undefined;
      },
    } as unknown as ConfigService;
    const service = new StorageService(config);

    const mockSend = jest.fn().mockImplementation(async (command: unknown) => {
      const cmdName = (command as { constructor: { name: string } }).constructor.name;
      if (cmdName === "HeadBucketCommand") {
        throw new Error("Bucket not found");
      }
      if (cmdName === "CreateBucketCommand") {
        return {};
      }
      if (cmdName === "PutObjectCommand") {
        return {};
      }
      return {};
    });
    (service as unknown as { client: { send: typeof mockSend } }).client = { send: mockSend };

    await service.upload("test.jpg", Buffer.from("abc"), "image/jpeg");
    expect(mockSend).toHaveBeenCalled();
  });
});
