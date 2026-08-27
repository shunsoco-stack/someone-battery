#!/usr/bin/env node

/**
 * Dependency-free, offline pre-publication secret guard.
 * Scans the working tree, Git index, and locally reachable Git history.
 * Findings contain a location and rule ID, never the matching value.
 * See docs/SECURITY.md for its deliberately limited assurance and scope.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

const PATTERNS = [
  ["private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ["google-service-account", /["']type["']\s*:\s*["']service_account["']/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ["gitlab-token", /\bglpat-[A-Za-z0-9_-]{20,}\b/g],
  ["aws-access-key-id", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ["google-oauth-token", /\bya29\.[A-Za-z0-9_-]{20,}\b/g],
  ["stripe-live-key", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g],
  ["ai-provider-key", /\bsk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{32,}\b/g],
  ["npm-token", /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ["vercel-token", /\b(?:vcp_|vercel_)[A-Za-z0-9_-]{24,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}\b/g],
  ["basic-auth-url", /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?):\/\/[^\s/@:]{1,64}:[A-Za-z0-9_+%=/.-]{12,}@/g],
];

const ASSIGNMENT = /(?:^|[\s{,])["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*[:=]\s*(?:(["'`])([^"'`\r\n]{8,})\2|([A-Za-z0-9_+/.=:-]{16,}))/gm;
const SENSITIVE_NAME = /(?:token|secret|password|passwd|private.?key|api.?key|access.?key|account.?key)$/i;
const PUBLIC_FIREBASE_NAME = "NEXT_PUBLIC_FIREBASE_API_KEY";

function entropy(value) {
  const frequencies = new Map();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }
  return [...frequencies.values()].reduce((sum, frequency) => {
    const probability = frequency / value.length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function isPlaceholder(value) {
  return /^(?:<[^>]+>|\$\{[^}]+\}|(?:your|replace|example|dummy|placeholder|test|demo)[-_][A-Za-z_-]+|(?:process\.env\.|import\.meta\.env\.)[A-Z0-9_]+)$/i.test(value);
}

/** Safe to import; importing this module does not run the repository scan. */
export function findSecrets(text) {
  const findings = [];
  const seen = new Set();
  function add(rule, index) {
    const line = text.slice(0, index).split("\n").length;
    const key = `${rule}:${line}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push({ rule, line });
    }
  }
  for (const [rule, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) add(rule, match.index);
  }
  ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(ASSIGNMENT)) {
    const name = match[1];
    const value = match[3] ?? match[4];
    if (
      SENSITIVE_NAME.test(name) &&
      name !== PUBLIC_FIREBASE_NAME &&
      !isPlaceholder(value) &&
      /^[A-Za-z0-9_+/.=:%@!-]+$/.test(value) &&
      entropy(value) >= 3
    ) {
      add("sensitive-assignment", match.index);
    }
  }
  return findings;
}

function safeLabel(value) {
  // Filenames may themselves contain a secret or terminal-control characters.
  return findSecrets(value).length ? "[redacted location]" : JSON.stringify(value);
}

function git(arguments_, input) {
  try {
    return execFileSync("git", ["-C", ROOT, ...arguments_], {
      // null keeps stdout as a Buffer. The pseudo-encoding "buffer" fails when
      // Node tries to encode string stdin (first exercised by history batches).
      encoding: null,
      input: typeof input === "string" ? Buffer.from(input, "utf8") : input,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      timeout: 60_000,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" },
    });
  } catch (error) {
    // Git's stderr/command can include private remote URLs or object content.
    // Identify only our fixed operation and process metadata, never raw output.
    const operation = ["rev-parse", "ls-files", "cat-file", "rev-list", "hash-object"].includes(arguments_[0])
      ? arguments_[0] : "unknown";
    const batch = arguments_.some((argument) => argument.startsWith("--batch")) ? "/batch" : "";
    const status = Number.isInteger(error?.status) ? String(error.status) : "unavailable";
    const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "unavailable";
    throw new Error(`Git inspection failed (operation=${operation}${batch}, status=${status}, code=${code}); no successful scan can be claimed.`);
  }
}

function isForbiddenPublicationPath(relativePath) {
  const basename = path.posix.basename(relativePath.replaceAll("\\", "/"));
  if (/^\.env(?:\.|$)/i.test(basename) && basename !== ".env.example") return true;
  return /(?:service[-_]?account|credentials).*\.json$/i.test(basename) || /\.(?:pem|key|p12|pfx)$/i.test(basename);
}

function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = Buffer.from(buffer.subarray(2, buffer.length - (buffer.length % 2)));
    return body.swap16().toString("utf16le");
  }
  // Binary files are not silently excluded: literal ASCII/UTF-8 signatures
  // in their raw bytes are checked too. Compressed content is not unpacked.
  return buffer.toString("utf8");
}

function runScan() {
  const actualRoot = realpathSync(git(["rev-parse", "--show-toplevel"]).toString("utf8").trim());
  if (actualRoot !== ROOT) {
    throw new Error("Run git init in this independent application first; refusing to inspect its parent repository.");
  }
  if (git(["rev-parse", "--is-shallow-repository"]).toString("utf8").trim() !== "false") {
    throw new Error("Shallow Git history is not enough. Fetch complete history, then repeat the scan.");
  }

  const findings = [];
  const contentCache = new Map();
  const counts = { worktree: 0, index: 0, history: 0 };

  function scanContent(buffer, location) {
    if (buffer.length > MAX_FILE_BYTES) {
      throw new Error(`Manual review required for oversized content at ${safeLabel(location)} (limit: 16 MiB).`);
    }
    const hash = createHash("sha256").update(buffer).digest("hex");
    let matches = contentCache.get(hash);
    if (!matches) {
      matches = findSecrets(decode(buffer));
      contentCache.set(hash, matches);
    }
    for (const finding of matches) findings.push({ location, ...finding });
  }

  const workingPaths = new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0").filter(Boolean));
  for (const relativePath of workingPaths) {
    if (isForbiddenPublicationPath(relativePath)) {
      findings.push({ location: `worktree:${relativePath}`, line: 1, rule: "forbidden-publish-path" });
    }
    const absolutePath = path.resolve(ROOT, relativePath);
    if (!absolutePath.startsWith(`${ROOT}${path.sep}`)) {
      throw new Error("A listed file resolved outside this repository.");
    }
    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch (error) {
      if (error.code === "ENOENT") continue; // Deleted locally; index/history still scanned.
      throw new Error(`Cannot inspect ${safeLabel(relativePath)}.`);
    }
    if (stat.isDirectory()) {
      throw new Error(`Nested repository/submodule requires separate review: ${safeLabel(relativePath)}.`);
    }
    if (stat.isSymbolicLink()) {
      scanContent(Buffer.from(readlinkSync(absolutePath)), `worktree:${relativePath} (symlink target)`);
    } else {
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        throw new Error(`Unsupported or oversized file requires manual review: ${safeLabel(relativePath)}.`);
      }
      const resolved = realpathSync(absolutePath);
      if (!resolved.startsWith(`${ROOT}${path.sep}`)) {
        throw new Error("A listed file traverses a link outside this repository.");
      }
      scanContent(readFileSync(absolutePath), `worktree:${relativePath}`);
    }
    counts.worktree++;
  }

  // Reading the index itself catches a secret staged before its local removal.
  const indexEntries = git(["ls-files", "--stage", "-z"]).toString("utf8").split("\0").filter(Boolean);
  const scannedObjects = new Set();
  for (const entry of indexEntries) {
    const match = /^(\d{6}) ([0-9a-f]{40,64}) [0-3]\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error("An unsupported Git index entry requires manual review.");
    const [, mode, objectId, relativePath] = match;
    if (mode === "160000") throw new Error("Git submodules require their own secret scan.");
    if (isForbiddenPublicationPath(relativePath)) {
      findings.push({ location: `index:${relativePath}`, line: 1, rule: "forbidden-publish-path" });
    }
    const size = Number(git(["cat-file", "-s", objectId]).toString("utf8").trim());
    if (!Number.isSafeInteger(size) || size > MAX_FILE_BYTES) throw new Error("Oversized Git index content requires manual review.");
    scanContent(git(["cat-file", "blob", objectId]), `index:${relativePath}`);
    scannedObjects.add(objectId);
    counts.index++;
  }

  // --all covers available branches, remote-tracking refs and tags. Commit/tag
  // messages are checked as well as every file blob reachable from those refs.
  const historyIds = [...new Set(git(["rev-list", "--objects", "--all", "--no-object-names"]).toString("utf8").split(/\r?\n/).filter(Boolean))];
  if (historyIds.length) {
    const objectInfo = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], `${historyIds.join("\n")}\n`).toString("utf8").trim().split(/\r?\n/);
    for (const line of objectInfo) {
      const match = /^([0-9a-f]{40,64}) (blob|tree|commit|tag) (\d+)$/.exec(line);
      if (!match) throw new Error("A reachable Git object could not be inspected.");
      const [, objectId, type, size] = match;
      if (type === "tree" || scannedObjects.has(objectId)) continue;
      if (Number(size) > MAX_FILE_BYTES) throw new Error("Oversized historical content requires manual review.");
      scanContent(git(["cat-file", type, objectId]), `history:${objectId}`);
      counts.history++;
    }
  }

  console.log(`Secret scan scope: ${counts.worktree} working files, ${counts.index} index entries, ${counts.history} additional reachable history objects.`);
  if (findings.length) {
    console.error(`FAIL: ${findings.length} possible secrets or forbidden publication paths; values are redacted.`);
    for (const { location, line, rule } of findings) {
      console.error(`  ${safeLabel(location)}:${line} [${rule}]`);
    }
    console.error("Do not publish. Review locally; revoke real credentials before cleaning files/history.");
    process.exitCode = 1;
    return;
  }
  console.log("PASS: no configured secret signatures found. This is a heuristic scan, not proof that no secret exists.");
  console.log("Excluded scope: ignored untracked files, unavailable/dangling history, archive decompression, OCR, and remote provider settings.");
}

function selfTest() {
  const suffix = "Ab9xQ2mK7vP4rT8nC1zY6uE3sD5fG0hJ";
  const positives = [
    ["private-key", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
    ["google-service-account", JSON.stringify({ type: ["service", "account"].join("_") })],
    ["github-token", ["gh", "p_", suffix, suffix].join("")],
    ["gitlab-token", ["gl", "pat-", suffix].join("")],
    ["aws-access-key-id", ["AK", "IA", "A1B2C3D4E5F6G7H8"].join("")],
    ["slack-token", ["xox", "b-", suffix].join("")],
    ["google-oauth-token", ["ya", "29.", suffix].join("")],
    ["stripe-live-key", ["sk", "_live_", suffix].join("")],
    ["ai-provider-key", ["sk", "-proj-", suffix, suffix].join("")],
    ["npm-token", ["np", "m_", suffix].join("")],
    ["vercel-token", ["vc", "p_", suffix].join("")],
    ["jwt", ["ey", "J", suffix, ".", suffix, ".", suffix].join("")],
    ["basic-auth-url", ["https://user:", suffix, "@example.invalid"].join("")],
    ["sensitive-assignment", ["CLOUD_CLIENT_", "SECRET=", suffix].join("")],
    ["sensitive-assignment", JSON.stringify({ accountKey: suffix })],
  ];
  for (const [rule, fixture] of positives) {
    assert(findSecrets(fixture).some((finding) => finding.rule === rule), `Missing rule: ${rule}`);
  }
  const negatives = [
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id",
    `${PUBLIC_FIREBASE_NAME}=${suffix}`,
    "API_TOKEN=your-api-token",
    "CLIENT_SECRET=process.env.CLIENT_SECRET",
    "The application stores percentage, createdAt, expiresAt and anonymousName.",
    "const value = { anonymousName: '充電を忘れたペンギン' };",
  ];
  for (const fixture of negatives) assert.equal(findSecrets(fixture).length, 0, "Unexpected false positive");
  assert.equal(findSecrets(`first\n${positives[2][1]}`)[0].line, 2);
  assert.deepEqual(Object.keys(findSecrets(positives[2][1])[0]).sort(), ["line", "rule"]);
  assert(isForbiddenPublicationPath(".env.local"));
  assert(isForbiddenPublicationPath("secrets/service-account.json"));
  assert(!isForbiddenPublicationPath(".env.example"));
  assert(!isForbiddenPublicationPath("docs/SECURITY.md"));
  // Regression: history uses string stdin for cat-file --batch-check. Exercise
  // that transport even before a repository has its first commit. hash-object
  // WITHOUT -w only computes a digest; it does not write objects or change Git.
  const harmlessInput = "scanner transport self-test\n";
  const stringDigest = git(["hash-object", "--stdin"], harmlessInput);
  const bufferDigest = git(["hash-object", "--stdin"], Buffer.from(harmlessInput, "utf8"));
  assert(Buffer.isBuffer(stringDigest));
  assert.deepEqual(stringDigest, bufferDigest);
  assert.match(stringDigest.toString("utf8").trim(), /^[0-9a-f]{40,64}$/);
  console.log(`PASS: secret scanner self-test (${positives.length} positive signatures, ${negatives.length} safe examples, location/redaction/path checks, Git string/Buffer stdin regression).`);
}

if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes("--self-test")) selfTest();
    else if (process.argv.length === 2) runScan();
    else throw new Error("Usage: node scripts/secret-scan.mjs [--self-test]");
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 2;
  }
}
