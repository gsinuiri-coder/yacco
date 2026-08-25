import { Module } from "@nestjs/common";
import { ContainerBalancesController } from "./container-balances.controller.js";
import { ContainerBalancesService } from "./container-balances.service.js";

@Module({
  controllers: [ContainerBalancesController],
  providers: [ContainerBalancesService],
})
export class ContainerBalancesModule {}
