import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Actor } from "./actor.js";

type ActorRequest = { actor?: Actor };

/** Returns only the normalized authorization principal, never a persistence row. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const actor = (context.switchToHttp().getRequest<ActorRequest>()).actor;
    if (!actor) throw new Error("Authenticated actor was not attached");
    return actor;
  },
);
