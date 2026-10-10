import { jest } from "@jest/globals";
import type { ClientRequest, IncomingMessage } from "node:http";
import {
  GoogleMapsLinkRequester,
  type GoogleMapsHttpsRequest,
} from "./google-maps-link-requester.js";

function response(statusCode: number, location: string | string[] | undefined): IncomingMessage {
  return {
    statusCode,
    headers: { location },
    resume: jest.fn(),
  } as unknown as IncomingMessage;
}

describe("GoogleMapsLinkRequester", () => {
  it("pins every request to the Google Maps short-link host and HTTPS port", async () => {
    let respond!: (value: IncomingMessage) => void;
    const clientRequest = {
      setTimeout: jest.fn(),
      once: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    } as unknown as ClientRequest;
    const httpsRequest = jest.fn<GoogleMapsHttpsRequest>((_options, callback) => {
      respond = callback;
      return clientRequest;
    });
    const requester = new GoogleMapsLinkRequester(httpsRequest);

    const result = requester.getRedirect("/AbC123?entry=ttu");
    respond(response(302, "https://www.google.com/maps/place/Local"));

    await expect(result).resolves.toEqual({
      status: 302,
      location: "https://www.google.com/maps/place/Local",
    });
    expect(httpsRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "https:",
        hostname: "maps.app.goo.gl",
        port: 443,
        path: "/AbC123?entry=ttu",
      }),
      expect.any(Function),
    );
    expect(clientRequest.end).toHaveBeenCalledTimes(1);
  });

  it("uses the first Location header when Node exposes several values", async () => {
    let respond!: (value: IncomingMessage) => void;
    const clientRequest = {
      setTimeout: jest.fn(),
      once: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    } as unknown as ClientRequest;
    const httpsRequest = jest.fn<GoogleMapsHttpsRequest>((_options, callback) => {
      respond = callback;
      return clientRequest;
    });
    const requester = new GoogleMapsLinkRequester(httpsRequest);

    const result = requester.getRedirect("/AbC123");
    respond(response(302, ["/first", "/second"]));

    await expect(result).resolves.toEqual({ status: 302, location: "/first" });
  });

  it("destroys a timed-out request and rejects on its transport error", async () => {
    let timeout!: () => void;
    let fail!: (error: Error) => void;
    const clientRequest = {
      setTimeout: jest.fn((_milliseconds: number, callback: () => void) => {
        timeout = callback;
      }),
      once: jest.fn((_event: string, callback: (error: Error) => void) => {
        fail = callback;
      }),
      end: jest.fn(),
      destroy: jest.fn((error: Error) => fail(error)),
    } as unknown as ClientRequest;
    const httpsRequest = jest.fn<GoogleMapsHttpsRequest>(() => clientRequest);
    const requester = new GoogleMapsLinkRequester(httpsRequest);

    const result = requester.getRedirect("/Slow");
    timeout();

    await expect(result).rejects.toThrow("timed out");
    expect(clientRequest.setTimeout).toHaveBeenCalledWith(5_000, expect.any(Function));
  });
});
