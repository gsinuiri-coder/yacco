import { jest } from "@jest/globals";
import { BadRequestException } from "@nestjs/common";
import type { Response } from "express";
import { Readable } from "node:stream";
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import type { ReceiptFilesService } from "./receipt-files.service.js";
import { ReceiptsController } from "./receipts.controller.js";
import type { ReceiptsService } from "./receipts.service.js";

type MockAsync = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
const USER_ID = "33333333-3333-4333-8333-333333333333";
const authenticatedRequest = { user: { sub: USER_ID } } as AuthenticatedRequest;

describe("ReceiptsController files", () => {
  let files: { upload: MockAsync; get: MockAsync };
  let controller: ReceiptsController;

  beforeEach(() => {
    files = {
      upload: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      get: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    controller = new ReceiptsController(
      {} as ReceiptsService,
      files as unknown as ReceiptFilesService,
    );
  });

  it("rejects an upload without a file", () => {
    expect(() => controller.uploadFile("receipt-1", undefined, authenticatedRequest)).toThrow(
      BadRequestException,
    );
  });

  it("delegates an authenticated upload", async () => {
    const file = { buffer: Buffer.from("%PDF-1.7") };
    files.upload.mockResolvedValue({ fileName: "document.pdf", contentType: "application/pdf" });

    await controller.uploadFile("receipt-1", file, authenticatedRequest);

    expect(files.upload).toHaveBeenCalledWith("receipt-1", file, USER_ID);
  });

  it("streams a private file with its stored content metadata", async () => {
    const pipe = jest.fn();
    files.get.mockResolvedValue({
      stream: { pipe } as unknown as Readable,
      contentType: "application/pdf",
      contentLength: 123,
    });
    const response = { setHeader: jest.fn() } as unknown as Response;

    await controller.getRawFile("receipt-1", "document.pdf", response);

    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(response.setHeader).toHaveBeenCalledWith("Content-Length", 123);
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-cache");
    expect(pipe).toHaveBeenCalledWith(response);
  });
});
