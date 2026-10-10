import { Module } from "@nestjs/common";
import { request } from "node:https";
import { CustomerLocationsController } from "./customer-locations.controller.js";
import { CustomerLocationsService } from "./customer-locations.service.js";
import {
  GOOGLE_MAPS_HTTPS_REQUEST,
  GoogleMapsLinkRequester,
  type GoogleMapsHttpsRequest,
} from "./google-maps-link-requester.js";

@Module({
  controllers: [CustomerLocationsController],
  providers: [
    CustomerLocationsService,
    GoogleMapsLinkRequester,
    {
      provide: GOOGLE_MAPS_HTTPS_REQUEST,
      useValue: request as GoogleMapsHttpsRequest,
    },
  ],
})
export class CustomerLocationsModule {}
