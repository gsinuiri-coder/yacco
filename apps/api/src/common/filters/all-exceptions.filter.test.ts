import { jest } from "@jest/globals";
import { BadRequestException, HttpStatus, Logger, NotFoundException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter.js";

function buildHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe("AllExceptionsFilter", () => {
  const filter = new AllExceptionsFilter();

  // The only branch integration tests can't reach: a real bug, not a client
  // error, must never leak its message/stack to the response.
  test("a non-HttpException logs the full error and responds 500 with the generic message", () => {
    const { host, json, status } = buildHost();
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const error = new Error("DB unreachable");

    try {
      filter.catch(error, host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: "Ocurrió un error inesperado. Vuelve a intentarlo.",
      });
      expect(errorSpy).toHaveBeenCalledWith("DB unreachable", error.stack);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("a thrown non-Error value is stringified instead of crashing the filter", () => {
    const { host, json, status } = buildHost();
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    try {
      filter.catch("boom", host);

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR }),
      );
      expect(errorSpy).toHaveBeenCalledWith("boom", undefined);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("translates ParseUUIDPipe's English message but keeps the 400 status", () => {
    const { host, json, status } = buildHost();

    filter.catch(new BadRequestException("Validation failed (uuid is expected)"), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "No encontramos lo que buscas. Revisa el enlace." }),
    );
  });

  test("translates the unmatched-route 404 message but keeps the 404 status", () => {
    const { host, json, status } = buildHost();

    filter.catch(new NotFoundException("Cannot GET /api/v1/no-existe"), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "No encontramos lo que buscas. Revisa el enlace." }),
    );
  });

  test("passes a Spanish domain HttpException through untouched", () => {
    const { host, json, status } = buildHost();

    filter.catch(new NotFoundException('El cliente "x" no existe'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'El cliente "x" no existe' }),
    );
  });

  test("passes a class-validator array message through untouched", () => {
    const { host, json, status } = buildHost();
    const messages = ["El nombre es obligatorio", "El teléfono es obligatorio"];

    filter.catch(new BadRequestException(messages), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: messages }));
  });
});
