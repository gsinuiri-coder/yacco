import { describe, expect, it, jest } from "@jest/globals";
import { PendingApprovalsController } from "./pending-approvals.controller.js";
import type { CustomerLocationsService } from "./customer-locations.service.js";

describe("PendingApprovalsController", () => {
  it("delegates getPendingApprovals to service", async () => {
    const getPendingApprovals = jest.fn<() => Promise<unknown>>();
    getPendingApprovals.mockResolvedValueOnce({
      photos: [],
      coordinateRequests: [],
    });
    const service = {
      getPendingApprovals,
    } as unknown as CustomerLocationsService;

    const controller = new PendingApprovalsController(service);
    const result = await controller.getPendingApprovals();

    expect(getPendingApprovals).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ photos: [], coordinateRequests: [] });
  });
});
