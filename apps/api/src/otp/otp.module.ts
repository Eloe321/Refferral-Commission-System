/* eslint-disable @typescript-eslint/no-extraneous-class */
import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { OtpController } from "./otp.controller.js";
import {
  generateOtpCode,
  OTP_CLOCK,
  OTP_CODE_GENERATOR,
  OtpPolicy,
  OtpService,
} from "./otp.service.js";
@Module({
  imports: [NotificationsModule],
  controllers: [OtpController],
  providers: [
    OtpPolicy,
    OtpService,
    { provide: OTP_CLOCK, useValue: () => new Date() },
    { provide: OTP_CODE_GENERATOR, useValue: generateOtpCode },
  ],
  exports: [OtpService, OtpPolicy],
})
export class OtpModule {}
