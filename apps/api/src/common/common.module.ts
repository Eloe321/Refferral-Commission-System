/* eslint-disable @typescript-eslint/no-extraneous-class */
import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";
import { IdempotencyService } from "./idempotency.service.js";
import { ClaimReservationsService } from "./claim-reservations.service.js";
import { ClaimRecoveryService } from "./claim-recovery.service.js";
@Global()
@Module({
  providers: [AuditService, IdempotencyService, ClaimReservationsService, ClaimRecoveryService],
  exports: [AuditService, IdempotencyService, ClaimReservationsService, ClaimRecoveryService],
})
export class CommonModule {}
