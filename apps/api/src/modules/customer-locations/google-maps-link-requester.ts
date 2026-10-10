import { Inject, Injectable } from "@nestjs/common";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";

export const GOOGLE_MAPS_HTTPS_REQUEST = Symbol("GOOGLE_MAPS_HTTPS_REQUEST");

export type GoogleMapsHttpsRequest = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export interface GoogleMapsRedirectResponse {
  status: number;
  location: string | null;
}

@Injectable()
export class GoogleMapsLinkRequester {
  constructor(
    @Inject(GOOGLE_MAPS_HTTPS_REQUEST)
    private readonly httpsRequest: GoogleMapsHttpsRequest,
  ) {}

  getRedirect(pathAndSearch: string): Promise<GoogleMapsRedirectResponse> {
    return new Promise((resolve, reject) => {
      const request = this.httpsRequest(
        {
          protocol: "https:",
          hostname: "maps.app.goo.gl",
          port: 443,
          method: "GET",
          path: pathAndSearch,
          headers: { "user-agent": "Yacco Google Maps link resolver" },
        },
        (response) => {
          const rawLocation = response.headers.location;
          response.resume();
          resolve({
            status: response.statusCode ?? 0,
            location: Array.isArray(rawLocation) ? (rawLocation[0] ?? null) : (rawLocation ?? null),
          });
        },
      );
      request.setTimeout(5_000, () => {
        request.destroy(new Error("Google Maps link request timed out"));
      });
      request.once("error", reject);
      request.end();
    });
  }
}
