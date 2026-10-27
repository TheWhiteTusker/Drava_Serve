import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuditController } from './access/audit.js';
import { OutletsController } from './access/outlets.js';
import { RolesController } from './access/roles.js';
import { SettingsController } from './access/settings.js';
import { UsersController } from './access/users.js';
import { ActivityController } from './activity.js';
import { ApprovalsController } from './approvals.js';
import { AuthController } from './auth.controller.js';
import { BrandsController, CategoriesController, DiningTablesController, MenuItemsController, TaxClassesController } from './catalog.controller.js';
import { LiquorTreeController } from './catalog/liquor-tree.js';
import { StockItemsController } from './catalog/stock-items.js';
import { AuthGuard, ErrorFilter, Public } from './common.js';
import { LiveGateway } from './events.js';
import { DataController } from './data.js';
import { InventoryCountsController } from './inventory/counts.controller.js';
import { JobsController } from './jobs.js';
import { InventoryController } from './inventory/stock.controller.js';
import { PosController } from './pos/controller.js';
import { DayCloseController } from './pos/day-close.js';
import { GuestOrdersController } from './pos/guest-orders.js';
import { KitchenController } from './pos/kitchen.js';
import { ReportsController } from './reports/controller.js';
import { PricingController } from './pricing/recipes.js';
import { PricingRulesController } from './pricing/rules.js';
import { PublicMenuController } from './public/controller.js';
import { IndentsController } from './purchasing/indents.controller.js';
import { VendorItemsController, VendorRatesController, VendorsController } from './purchasing/vendors.js';
import { AttachmentsController } from './receiving/attachments.js';
import { DeliveriesController } from './receiving/deliveries.js';
import { GrnsController } from './receiving/grns.js';
import { jwtSecret } from './secrets.js';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  ok() {
    return { ok: true };
  }
}

@Module({
  imports: [JwtModule.register({ secret: jwtSecret(), signOptions: { expiresIn: '12h' } })],
  controllers: [
    HealthController, AuthController, UsersController, RolesController, OutletsController, SettingsController,
    AuditController, CategoriesController, BrandsController, TaxClassesController, StockItemsController,
    MenuItemsController, DiningTablesController, LiquorTreeController, ApprovalsController, InventoryController, InventoryCountsController,
    VendorsController, VendorItemsController, VendorRatesController, IndentsController,
    DeliveriesController, GrnsController, AttachmentsController, PricingController, PricingRulesController, PublicMenuController,
    PosController, GuestOrdersController, KitchenController, DayCloseController, ReportsController, DataController, ActivityController, JobsController,
  ],
  providers: [
    LiveGateway,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
