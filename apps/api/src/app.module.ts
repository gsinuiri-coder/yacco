import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env.validation.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { ContainerMovementsModule } from "./modules/container-movements/container-movements.module.js";
import { ContainerBalancesModule } from "./modules/container-balances/container-balances.module.js";
import { ContainerCountsModule } from "./modules/container-counts/container-counts.module.js";
import { ContainerReconciliationModule } from "./modules/container-reconciliation/container-reconciliation.module.js";
import { ContainerTypesModule } from "./modules/container-types/container-types.module.js";
import { CustomerLocationsModule } from "./modules/customer-locations/customer-locations.module.js";
import { CustomerPricesModule } from "./modules/customer-prices/customer-prices.module.js";
import { CustomersModule } from "./modules/customers/customers.module.js";
import { OrdersModule } from "./modules/orders/orders.module.js";
import { ProductsModule } from "./modules/products/products.module.js";
import { ProductionBatchesModule } from "./modules/production-batches/production-batches.module.js";
import { RosterLoaderModule } from "./modules/roster-loader/roster-loader.module.js";
import { SalesModule } from "./modules/sales/sales.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { ZonesModule } from "./modules/zones/zones.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CustomersModule,
    CustomerLocationsModule,
    CustomerPricesModule,
    OrdersModule,
    ProductsModule,
    ContainerTypesModule,
    ContainerMovementsModule,
    ContainerBalancesModule,
    ContainerCountsModule,
    ContainerReconciliationModule,
    ProductionBatchesModule,
    RosterLoaderModule,
    SalesModule,
    HealthModule,
    ZonesModule,
  ],
})
export class AppModule {}
