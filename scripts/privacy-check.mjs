import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LOCAL_DENYLIST = ".privacy-denylist.local";
const PUBLIC_BINARY_ROOTS = ["docs/screenshots/"];
const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".bin",
  ".bmp",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".tar",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);
const FIXTURE_PATH =
  /(?:^|\/)(?:fixtures?|mocks?|seed(?:-data)?|tests?|support)(?:[./_-]|$)|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/i;
const EMAIL = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const E164_LITERAL = /(["'`])(\+[1-9][0-9]{7,14})\1/g;
const SECRET_KEY =
  /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|(?:^|[._-])credential(?:$|[._-]))/i;
const QUOTED_ASSIGNMENT =
  /(?<!["'`A-Za-z0-9_.-])(?:(?:["'`])([^"'`\n]+)(?:["'`])|([A-Za-z][A-Za-z0-9_.-]*))[ \t]*[:=][ \t]*(["'`])([^"'`\n]+)\3/gi;
const ENV_ASSIGNMENT =
  /^[ \t]*([A-Za-z][A-Za-z0-9_.-]*)[ \t]*[:=][ \t]*(["'][^"']*["']|[^\s#,"']+)/gim;
const SAFE_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "example.invalid",
]);

function issue(path, rule, message, line) {
  return { path, rule, message, ...(line === undefined ? {} : { line }) };
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function cleanAssignedValue(value) {
  return value
    .trim()
    .replace(/^(["'`])|(["'`],?;?)$/g, "")
    .replace(/[,;]$/, "")
    .trim();
}

function safeSecretValue(value) {
  const normalized = cleanAssignedValue(value).toLowerCase();
  return (
    normalized === "replace_me" ||
    normalized === "undefined" ||
    normalized === "null" ||
    normalized === "sandbox" ||
    normalized === "secret-key" ||
    normalized === "live-api-key" ||
    normalized === "test-webhook-secret" ||
    normalized === "wrong-secret" ||
    normalized.startsWith("${") ||
    normalized.startsWith("development-") ||
    normalized.startsWith("test-") ||
    normalized.startsWith("unit-") ||
    normalized.startsWith("runtime-smoke-") ||
    normalized.startsWith("fictional-") ||
    normalized.startsWith("a-session-") ||
    normalized.startsWith("an-otp-") ||
    normalized.includes("sentinel") ||
    normalized.includes("long-enough") ||
    normalized.includes("at-least-") ||
    normalized === "too-short"
  );
}

function isEnvironmentExample(path) {
  return (
    path === ".env.example" ||
    path === "compose.yaml" ||
    path === "compose.yml" ||
    path === "README.md" ||
    path.startsWith("docs/") ||
    path.endsWith(".example")
  );
}

function supportsUnquotedEnvironmentAssignments(path) {
  return (
    path.startsWith(".env") ||
    path.endsWith(".env") ||
    path.endsWith(".example") ||
    path.endsWith(".yaml") ||
    path.endsWith(".yml") ||
    path.endsWith(".md")
  );
}

function isAllowedFictionPhone(phone) {
  return /^\+1[0-9]{3}55501[0-9]{2}$/.test(phone);
}

function isAllowedFictionEmailDomain(domain) {
  return (
    [...SAFE_EMAIL_DOMAINS].some(
      (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
    ) || domain.endsWith(".test")
  );
}

function hasNullByte(content) {
  return content.includes(0);
}

export function scanFile({ path, content, denylist }) {
  const findings = [];
  const extension = extname(path).toLowerCase();
  const binary = BINARY_EXTENSIONS.has(extension) || hasNullByte(content);
  const allowedBinary = PUBLIC_BINARY_ROOTS.some((root) => path.startsWith(root));
  if (binary && !allowedBinary) {
    findings.push(
      issue(path, "binary-location", "binary assets are allowed only in docs/screenshots"),
    );
  }
  if (binary) return findings;

  const text = content.toString("utf8");
  const folded = text.toLocaleLowerCase("en-US");
  if (
    denylist.some((term) => term.length > 0 && folded.includes(term.toLocaleLowerCase("en-US")))
  ) {
    findings.push(
      issue(path, "local-denylist", "file contains a locally denied private identifier"),
    );
  }

  const assignments = [];
  for (const match of text.matchAll(QUOTED_ASSIGNMENT)) {
    assignments.push({
      key: match[1] ?? match[2] ?? "",
      value: match[4] ?? "",
      index: match.index,
    });
  }
  if (supportsUnquotedEnvironmentAssignments(path)) {
    for (const match of text.matchAll(ENV_ASSIGNMENT)) {
      assignments.push({ key: match[1] ?? "", value: match[2] ?? "", index: match.index });
    }
  }
  const uniqueAssignments = new Set();
  for (const assignment of assignments) {
    const signature = `${String(assignment.index)}:${assignment.key}:${assignment.value}`;
    if (uniqueAssignments.has(signature)) continue;
    uniqueAssignments.add(signature);
    const value = cleanAssignedValue(assignment.value);
    if (assignment.key.toUpperCase() === "UNISMS_API_KEY" && isEnvironmentExample(path)) {
      if (value !== "replace_me" && !(value.includes("replace_me") && value.startsWith("${"))) {
        findings.push(
          issue(
            path,
            "unisms-example",
            "UniSMS examples must use the replace_me placeholder",
            lineNumber(text, assignment.index ?? 0),
          ),
        );
      }
      continue;
    }
    if (!SECRET_KEY.test(assignment.key) || safeSecretValue(value)) continue;
    findings.push(
      issue(
        path,
        "secret-assignment",
        "possible non-placeholder secret assignment",
        lineNumber(text, assignment.index ?? 0),
      ),
    );
  }

  if (FIXTURE_PATH.test(path)) {
    for (const match of text.matchAll(EMAIL)) {
      const domain = (match[1] ?? "").toLowerCase();
      if (!isAllowedFictionEmailDomain(domain)) {
        findings.push(
          issue(
            path,
            "fixture-email",
            "fixture email must use an IANA-reserved example domain",
            lineNumber(text, match.index ?? 0),
          ),
        );
      }
    }
    for (const match of text.matchAll(E164_LITERAL)) {
      const phone = match[2] ?? "";
      if (!isAllowedFictionPhone(phone)) {
        findings.push(
          issue(
            path,
            "fixture-phone",
            "fixture phone must use the reserved North American 555-01xx range",
            lineNumber(text, match.index ?? 0),
          ),
        );
      }
    }
  }

  return findings;
}

function repositoryFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: REPOSITORY_ROOT },
  ).toString("utf8");
  return output.split("\0").filter(Boolean);
}

function localDenylist() {
  const path = resolve(REPOSITORY_ROOT, LOCAL_DENYLIST);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function scanRepository() {
  const denylist = localDenylist();
  return repositoryFiles().flatMap((path) =>
    scanFile({
      path,
      content: readFileSync(resolve(REPOSITORY_ROOT, path)),
      denylist,
    }),
  );
}

function main() {
  const findings = scanRepository();
  if (findings.length === 0) {
    process.stdout.write("Privacy check PASS: tracked and pending repository files are clean.\n");
    return;
  }
  for (const finding of findings) {
    const location = finding.line ? `${finding.path}:${String(finding.line)}` : finding.path;
    process.stderr.write(`${location} [${finding.rule}] ${finding.message}\n`);
  }
  process.stderr.write(`Privacy check FAIL: ${String(findings.length)} issue(s) found.\n`);
  process.exitCode = 1;
}

const executedPath = process.argv[1];
if (executedPath && fileURLToPath(import.meta.url) === resolve(executedPath)) main();
