/* eslint-disable @typescript-eslint/no-extraneous-class */
import { Module } from "@nestjs/common"; import { EarningsController } from "./earnings.controller.js"; import { EarningsService } from "./earnings.service.js"; @Module({controllers:[EarningsController],providers:[EarningsService]}) export class EarningsModule {}
