/* eslint-disable @typescript-eslint/no-extraneous-class */
import { Module } from "@nestjs/common";
import { ConversionsController } from "./conversions.controller.js";
import { ConversionsService } from "./conversions.service.js";
import { ReversalService } from "../claims/reversal.service.js";
@Module({ controllers:[ConversionsController], providers:[ConversionsService, ReversalService], exports:[ConversionsService] }) export class ConversionsModule {}
