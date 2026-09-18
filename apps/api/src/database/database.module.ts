import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { createDatabaseClient, type DatabaseClient } from "@referral-sandbox/database";
import type { AppEnv } from "../config/env.js";

export const APP_ENV = Symbol("APP_ENV");
export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");

@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: DatabaseClient) {}

  static register(env: AppEnv) {
    return {
      module: DatabaseModule,
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: DATABASE_CLIENT, useFactory: () => createDatabaseClient(env.DATABASE_URL) },
      ],
      exports: [APP_ENV, DATABASE_CLIENT],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.sql.end({ timeout: 5 });
  }
}
