import assert from "node:assert/strict";
import { test } from "node:test";

import { playwrightEnvironment } from "./run-playwright.mjs";

test("removes the database test override without mutating the parent environment", () => {
  const parent = {
    DATABASE_URL_TEST: "postgres://sandbox:sandbox@docker.example.invalid/postgres",
    KEEP_ME: "yes",
  };

  const child = playwrightEnvironment(parent);

  assert.deepEqual(child, { KEEP_ME: "yes" });
  assert.equal(
    parent.DATABASE_URL_TEST,
    "postgres://sandbox:sandbox@docker.example.invalid/postgres",
  );
});
