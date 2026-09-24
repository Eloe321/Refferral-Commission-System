/* eslint-disable @typescript-eslint/no-extraneous-class -- Nest module token classes are required. */
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { AppEnv } from "./config/env.js";
import { SandboxSessionGuard } from "./auth/sandbox-session.guard.js";
import { DatabaseModule } from "./database/database.module.js";
import { DemoModule } from "./demo/demo.module.js";
import { HealthController } from "./health.controller.js";
import { CommonModule } from "./common/common.module.js";
import { ConversionsModule } from "./conversions/conversions.module.js";
import { EarningsModule } from "./earnings/earnings.module.js";
import { ProgramsModule } from "./programs/programs.module.js";
import { PartnersModule } from "./partners/partners.module.js";
import { OtpModule } from "./otp/otp.module.js";
import { ClaimsModule } from "./claims/claims.module.js";
import { BookingsModule } from "./bookings/bookings.module.js";

@Module({})
export class AppModule {
  static register(env: AppEnv) {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.register(env),
        CommonModule,
        DemoModule,
        ConversionsModule,
        EarningsModule,
        ProgramsModule,
        PartnersModule,
        OtpModule,
        ClaimsModule,
        BookingsModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: SandboxSessionGuard }],
    };
  }
}
