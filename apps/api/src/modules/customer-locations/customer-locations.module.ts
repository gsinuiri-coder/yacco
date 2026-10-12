import { Module } from "@nestjs/common";
import { request } from "node:https";
import { CustomerLocationOperationsController } from "./customer-location-operations.controller.js";
import { CustomerLocationsController } from "./customer-locations.controller.js";
import { CustomerLocationsService } from "./customer-locations.service.js";
import {
  GOOGLE_MAPS_HTTPS_REQUEST,
  GoogleMapsLinkRequester,
  type GoogleMapsHttpsRequest,
} from "./google-maps-link-requester.js";
import { PendingApprovalsController } from "./pending-approvals.controller.js";

@Module({
  controllers: [
    CustomerLocationsController,
    CustomerLocationOperationsController,
    PendingApprovalsController,
  ],
  providers: [
    CustomerLocationsService,
    GoogleMapsLinkRequester,
    {
      provide: GOOGLE_MAPS_HTTPS_REQUEST,
      useValue: request as GoogleMapsHttpsRequest,
    },
  ],
  exports: [CustomerLocationsService],
})
export class CustomerLocationsModule {}
