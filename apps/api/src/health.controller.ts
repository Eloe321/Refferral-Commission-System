import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DATABASE_CLIENT } from "./database/database.module.js";
import { Inject } from "@nestjs/common";
import type { DatabaseClient } from "@referral-sandbox/database";
import { PublicRoute } from "./auth/sandbox-session.guard.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  @Get()
  @PublicRoute()
  async getHealth(): Promise<{ status: "ok" }> {
    try {
      await this.database.sql`select 1`;
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException({ status: "unavailable" });
    }
  }
}
