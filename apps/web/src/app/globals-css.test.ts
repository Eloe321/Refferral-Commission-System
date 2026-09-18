// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "globals.css"), "utf8");

const desktopMedia = "(min-width: 48rem)";

// Scoped to this stylesheet's flat rules and single-level media/keyframe blocks.
// Read authored text only; these contracts deliberately do not implement a CSS cascade.
function authoredDeclarationsFor(selector: string, source = css, media: string | null = "all") {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const atRules = /(@[^{}]+)\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  const scoped =
    media === "all"
      ? clean
      : media === null
        ? clean.replace(atRules, "")
        : [...clean.matchAll(atRules)]
            .filter((match) => match[1]?.trim() === `@media ${media}`)
            .map((match) => match[2] ?? "")
            .join("\n");
  return [...scoped.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1]?.split(",").some((part) => part.trim() === selector))
    .map((match) => match[2] ?? "")
    .join("\n");
}

function declarationsFor(selector: string, source = css, media: string | null = null) {
  const authored = authoredDeclarationsFor(selector, source, media);
  if (/!\s*important\b/i.test(authored)) throw new Error("Unsupported !important in scoped CSS");
  const properties = new Set<string>();
  let boundaries = 0;
  return authored
    .split(";")
    .filter((entry) => entry.trim())
    .map((entry) => {
      const colon = entry.indexOf(":");
      if (colon < 0) throw new Error("Unsupported scoped declaration");
      const property = entry.slice(0, colon).trim().toLowerCase();
      const value = entry.slice(colon + 1).trim();
      if (properties.has(property)) throw new Error(`Duplicate scoped declaration: ${property}`);
      properties.add(property);
      if (/^border(?:$|-(?!radius)[\w-]+)/.test(property) && ++boundaries > 1) {
        throw new Error("Conflicting boundary declarations in scoped CSS");
      }
      return `${property}: ${value};`;
    })
    .join("\n");
}

function hasFullBoundary(declarations: string, token: string) {
  return declarations.includes(`border: 1px solid var(--${token});`);
}

function hasSideStripe(declarations: string) {
  return [...declarations.matchAll(/\bborder-left(?:-width)?:\s*([^;]+)/g)].some(([, value]) => {
    if (!value || /\bnone\b/.test(value)) return false;
    const width = value.split(/\s+/).find((part) => /^(?:\d*\.)?\d+(?:[a-z%]+)?$/i.test(part));
    // Width keywords, omitted widths, and variables cannot establish a zero-width boundary.
    return width === undefined || Number.parseFloat(width) > 0;
  });
}

describe("CSS contract regression fixtures", () => {
  it.each([
    ".record { border-width: 4px !important; border: 1px solid var(--border); }",
    ".record { border: 1px solid var(--border) !important; border-width: 4px; }",
    ".record { border-width: 4px !important; } .record { border: 1px solid var(--border); }",
    ".record { border: 1px solid var(--border) !important; } .record { border-width: 4px; }",
  ])("rejects unsupported importance conflicts: %s", (fixture) => {
    expect(() => declarationsFor(".record", fixture)).toThrow(/unsupported.*important/i);
  });

  it("preserves authored colors without restoring tokens over #010201", () => {
    const fixture =
      ".other { border: 1px solid var(--border); } .record { border: 1px solid #010201; }";
    expect(declarationsFor(".record", fixture)).toBe("border: 1px solid #010201;");
  });

  it("does not let a desktop-only declaration satisfy the mobile contract", () => {
    const fixture =
      ".route-page { display: block; } @media (min-width: 48rem) { .route-page { display: grid; } }";
    expect(declarationsFor(".route-page", fixture)).not.toMatch(/display:\s*grid/);
    expect(declarationsFor(".route-page", fixture, desktopMedia)).toBe("display: grid;");
  });

  it("rejects duplicate declarations across grouped rules", () => {
    const fixture = ".route-page { display: grid; } .other, .route-page { display: block; }";
    expect(() => declarationsFor(".route-page", fixture)).toThrow(/duplicate/i);
  });

  it("rejects importance on non-boundary declarations too", () => {
    const fixture = ".route-page { display: block !important; } .route-page { display: grid; }";
    expect(() => declarationsFor(".route-page", fixture)).toThrow(/unsupported.*important/i);
  });

  it.each([
    ".record { border: 1px solid var(--border); border-width: 4px; }",
    ".record { border: 1px solid var(--border); } .record { border-width: 4px; }",
    ".record { border: 1px solid var(--border); border: 1px solid var(--border); }",
    ".record { border: 1px solid var(--border); } .other, .record { border: 1px solid red; }",
  ])("rejects duplicate or conflicting boundaries: %s", (fixture) => {
    expect(() => declarationsFor(".record", fixture)).toThrow(/duplicate|conflicting/i);
  });

  it.each([
    "border-left: 10px solid red",
    "border-left: .25rem solid red",
    "border-left: 0.5em solid red",
    "border-left-width: 4px",
    "border-left-width: .25rem",
    "border-left: 1px solid red",
    "border-left: solid red",
  ])("rejects the side stripe fixture %s", (declaration) => {
    expect(hasSideStripe(authoredDeclarationsFor(".record", `.record { ${declaration}; }`))).toBe(
      true,
    );
  });

  it.each([
    "border: 1px solid red",
    "border-left: none",
    "border-left: 0 solid red",
    "border-left-width: 0px",
    "border-left: solid 0.0rem red",
  ])("allows the full boundary or disabled side fixture %s", (declaration) => {
    expect(hasSideStripe(authoredDeclarationsFor(".record", `.record { ${declaration}; }`))).toBe(
      false,
    );
  });
});

describe("routed workbench styles", () => {
  it.each([
    ".route-page",
    ".workbench-page-heading",
    ".workbench-snapshot",
    ".route-inline-action",
    ".program-record",
    ".partner-record",
    ".conversion-record",
    ".claim-record",
    ".earning-card",
    ".partner-next-action",
    ".partner-earning-card",
    ".otp-work-order",
    ".partner-history-record",
    ".partner-history-record--ledger",
  ])("keeps %s declarations unambiguous within each responsive context", (selector) => {
    for (const media of [null, desktopMedia]) {
      expect(() => declarationsFor(selector, css, media)).not.toThrow();
    }
  });

  it("lays out route pages with mobile spacing and a full heading boundary", () => {
    const route = declarationsFor(".route-page");
    expect(route).toMatch(/display:\s*grid;/);
    expect(route).toMatch(/gap:\s*1rem;/);
    expect(route).toMatch(/min-width:\s*0;/);
    expect(hasFullBoundary(declarationsFor(".workbench-page-heading"), "border-strong")).toBe(true);
  });

  it.each([
    "program-record",
    "partner-record",
    "conversion-record",
    "claim-record",
    "earning-card",
    "partner-next-action",
    "partner-earning-card",
    "otp-work-order",
    "partner-history-record",
  ])(
    "keeps .%s free of side stripes in every media context, including grouped rules",
    (selector) => {
      const declarations = authoredDeclarationsFor(`.${selector}`);
      expect(declarations).not.toBe("");
      expect(hasSideStripe(declarations)).toBe(false);
    },
  );

  it.each([
    ["program-record", "border"],
    ["partner-record", "border"],
    ["conversion-record", "border"],
    ["claim-record", "border"],
    ["earning-card", "border"],
    ["partner-next-action", "accent-border"],
    ["otp-work-order", "accent-border"],
    ["partner-earning-card", "success-border"],
    ["partner-history-record", "warning-border"],
  ])("preserves the full semantic boundary on .%s", (selector, token) => {
    expect(hasFullBoundary(declarationsFor(`.${selector}`), token)).toBe(true);
  });

  it("gives reversal history an accent boundary on every side", () => {
    expect(declarationsFor(".partner-history-record--ledger")).toContain(
      "border-color: var(--accent-border);",
    );
  });

  it.each([".route-inline-action", ".route-inline-actions > a"])(
    "gives %s a 44px target, including grouped rules",
    (selector) => {
      expect(declarationsFor(selector)).toMatch(/min-height:\s*44px;/);
    },
  );

  it("expands heading layout at the desktop breakpoint", () => {
    const heading = declarationsFor(".workbench-page-heading", css, desktopMedia);
    expect(heading).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
    expect(heading).toMatch(/align-items:\s*end;/);
    expect(heading).toMatch(/padding:\s*1\.5rem;/);
    expect(declarationsFor(".route-page", css, desktopMedia)).toMatch(/gap:\s*1\.25rem;/);
  });

  it("computes the base layout and action size without desktop media rules", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = css;
    const route = document.createElement("section");
    route.className = "route-page";
    const heading = document.createElement("header");
    heading.className = "workbench-page-heading";
    const action = document.createElement("a");
    action.className = "route-inline-action";
    route.append(heading, action);
    document.head.append(stylesheet);
    document.body.append(route);
    try {
      expect(getComputedStyle(route).display).toBe("grid");
      expect(getComputedStyle(route).gap).toBe("1rem");
      expect(getComputedStyle(route).minWidth).toBe("0px");
      expect(getComputedStyle(heading).padding).toBe("16px");
      expect(getComputedStyle(action).minHeight).toBe("44px");
    } finally {
      route.remove();
      stylesheet.remove();
    }
  });
});

describe("sandbox design tokens", () => {
  it("defines reusable semantic state colors", () => {
    for (const token of [
      "--accent",
      "--accent-soft",
      "--accent-border",
      "--success-soft",
      "--success-border",
      "--success-text",
      "--warning-soft",
      "--warning-border",
      "--warning-text",
      "--danger-soft",
      "--danger-border",
      "--danger-text",
    ]) {
      expect(css).toContain(`${token}:`);
    }
    expect(css).toMatch(/\.simulation-notice\s*\{[^}]*var\(--success-soft\)/s);
    expect(css).toMatch(/\.ui-status--held[\s\S]*?var\(--warning-soft\)/);
    expect(css).toMatch(/\.ui-status--failed[\s\S]*?var\(--danger-soft\)/);
  });

  it("collapses only the text wordmark at the narrowest breakpoint", () => {
    expect(css).toMatch(
      /@media \(max-width: 22rem\)[\s\S]*?\.brand-lockup > \.brand-wordmark:last-child\s*\{\s*display:\s*none;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 22rem\)[\s\S]*?\.persona-name[\s\S]*?\.persona-separator\s*\{\s*display:\s*none;/,
    );
  });

  it("gives desktop rows explicit intrinsic guide and proof tracks", () => {
    expect(css).toMatch(
      /@media \(min-width: 48rem\)[\s\S]*?\.sandbox-shell\s*\{[^}]*grid-template-rows:\s*auto auto auto minmax\(0, 1fr\)/,
    );
  });

  it("uses readable mobile type and icon-over-label navigation", () => {
    expect(css).toMatch(/\.proof-strip\s*\{[^}]*0\.75rem/s);
    expect(css).toMatch(/\.simulation-notice\s*\{[^}]*font-size:\s*0\.8125rem/s);
    expect(css).toMatch(/\.orientation-copy\s*\{[^}]*font-size:\s*0\.9375rem/s);
    expect(css).toMatch(/\.primary-navigation a\s*\{[^}]*flex-direction:\s*column/s);
    expect(css).not.toMatch(/\.primary-navigation a span\s*\{[^}]*text-overflow:\s*ellipsis/s);
    expect(css).not.toMatch(/\.guide-row strong\s*\{[^}]*text-overflow:\s*ellipsis/s);
  });
});
