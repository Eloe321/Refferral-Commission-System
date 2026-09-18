/* eslint-disable @typescript-eslint/no-extraneous-class -- Nest module token classes are required. */
import { Module } from "@nestjs/common";
import { SandboxSessionGuard } from "../auth/sandbox-session.guard.js";
import { DemoController } from "./demo.controller.js";
import { DemoService } from "./demo.service.js";

@Module({ controllers: [DemoController], providers: [DemoService, SandboxSessionGuard] })
export class DemoModule {}
