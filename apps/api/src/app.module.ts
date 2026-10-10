import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import {
  AuditController, OutletsController, RolesController, SettingsController, UsersController,
} from './access.controller.js';
import { AuthController } from './auth.controller.js';
import {
  BrandsController, CategoriesController, LiquorTreeController, MenuItemsController, StockItemsController,
  TaxClassesController,
} from './catalog.controller.js';
import { AuthGuard, ErrorFilter, Public } from './common.js';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  ok() {
    return { ok: true };
  }
}

export function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  return s ?? 'dev-only-secret-change-me';
}

@Module({
  imports: [JwtModule.register({ secret: jwtSecret(), signOptions: { expiresIn: '12h' } })],
  controllers: [
    HealthController, AuthController, UsersController, RolesController, OutletsController, SettingsController,
    AuditController, CategoriesController, BrandsController, TaxClassesController, StockItemsController,
    MenuItemsController, LiquorTreeController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
