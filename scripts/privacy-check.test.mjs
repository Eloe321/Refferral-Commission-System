import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";

import { scanFile } from "./privacy-check.mjs";

import cases from "./privacy-fixtures/cases.json" with { type: "json" };

test("detects every neutral privacy rule with committed synthetic fixtures", () => {
  const denylistSentinel = cases.denylistParts.join("");
  const denylist = scanFile({
    path: "scripts/privacy-fixtures/denylist.txt",
    content: Buffer.from(denylistSentinel),
    denylist: [denylistSentinel],
  });
  const secret = scanFile({
    path: "scripts/privacy-fixtures/secret.env",
    content: Buffer.from(`${cases.secretKeyParts.join("")}=${cases.secretValueParts.join("_")}\n`),
    denylist: [],
  });
  const unisms = scanFile({
    path: "docs/example.env",
    content: Buffer.from(`UNISMS_API_KEY=${cases.unismsValueParts.join("_")}\n`),
    denylist: [],
  });
  const contacts = scanFile({
    path: "packages/database/src/fixtures/contacts.ts",
    content: Buffer.from(
      `email: "${cases.emailParts.join("@").replace("@customer-business@co", "@customer-business.co")}", phoneE164: "${cases.phoneParts.join("")}"`,
    ),
    denylist: [],
  });
  const binary = scanFile({
    path: "private-assets/copied.bin",
    content: Buffer.from(cases.binaryBytes),
    denylist: [],
  });

  assert.deepEqual(new Set(denylist.map((issue) => issue.rule)), new Set(["local-denylist"]));
  assert.deepEqual(new Set(secret.map((issue) => issue.rule)), new Set(["secret-assignment"]));
  assert.deepEqual(new Set(unisms.map((issue) => issue.rule)), new Set(["unisms-example"]));
  assert.deepEqual(
    new Set(contacts.map((issue) => issue.rule)),
    new Set(["fixture-email", "fixture-phone"]),
  );
  assert.deepEqual(new Set(binary.map((issue) => issue.rule)), new Set(["binary-location"]));
});

test("detects secrets with quoted JSON keys and lowercase YAML keys", () => {
  const json = scanFile({
    path: "config.json",
    content: Buffer.from(
      JSON.stringify({
        [cases.secretKeyParts.join("").toLowerCase()]: "nonplaceholder-secret-value",
      }),
    ),
    denylist: [],
  });
  const yaml = scanFile({
    path: "deployment.yaml",
    content: Buffer.from("service_secret: nonplaceholder-secret-value\n"),
    denylist: [],
  });

  assert.deepEqual(new Set(json.map((issue) => issue.rule)), new Set(["secret-assignment"]));
  assert.deepEqual(new Set(yaml.map((issue) => issue.rule)), new Set(["secret-assignment"]));
});

test("requires replace_me for quoted UniSMS example assignments", () => {
  const key = cases.unismsKeyParts.join("");
  const value = cases.unismsValueParts.join("-");
  for (const content of [
    `{${JSON.stringify(key)}:${JSON.stringify(value)}}`,
    `${JSON.stringify(key)}: ${JSON.stringify(value)}`,
    `'${key}': '${value}'`,
  ]) {
    const findings = scanFile({
      path: "docs/provider-example.md",
      content: Buffer.from(content),
      denylist: [],
    });

    assert.deepEqual(new Set(findings.map((issue) => issue.rule)), new Set(["unisms-example"]));
  }
});

test("treats tests and support helpers as fixture contact sources", () => {
  for (const path of [
    "apps/api/test/support/database.ts",
    "apps/web/src/features/partner/component.test.tsx",
  ]) {
    const findings = scanFile({
      path,
      content: Buffer.from(`phoneE164: "${cases.phoneParts.join("")}"`),
      denylist: [],
    });

    assert.deepEqual(new Set(findings.map((issue) => issue.rule)), new Set(["fixture-phone"]));
  }
});

test("accepts documented placeholders, reserved contacts, and public screenshots", () => {
  const safe = [
    ...scanFile({
      path: ".env.example",
      content: Buffer.from(
        "UNISMS_API_KEY=replace_me\nSESSION_SECRET=development-session-secret-at-least-32-characters\n",
      ),
      denylist: [],
    }),
    ...scanFile({
      path: "packages/database/src/seed-data.ts",
      content: Buffer.from(
        'email: "partner@example.com", databaseEmail: "safe@db.example.invalid", phoneE164: "+12025550101"',
      ),
      denylist: [],
    }),
    ...scanFile({
      path: "docs/screenshots/portfolio.png",
      content: Buffer.from([0, 1, 2, 3]),
      denylist: [],
    }),
  ];

  assert.deepEqual(safe, []);
});
