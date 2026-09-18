/* eslint-disable @typescript-eslint/no-extraneous-class -- Nest module token. */
import { Module } from "@nestjs/common";
import { ClaimRepository } from "./claim.repository.js";
import { ClaimsController } from "./claims.controller.js";
import { ClaimsService } from "./claims.service.js";
@Module({
  controllers: [ClaimsController],
  providers: [ClaimsService, ClaimRepository],
  exports: [ClaimsService],
})
export class ClaimsModule {}
