# 誰かの充電

This is an independent Next.js application. Keep all changes inside this repository.

Read the relevant installed Next.js guides in `node_modules/next/dist/docs/` before changing application code. Use the stable version pinned in `package-lock.json`.

- Never access the Battery Status API, geolocation, or device fingerprinting APIs.
- Firestore post documents contain only `percentage`, `createdAt`, `expiresAt`, `anonymousName`.
- Demo content is allowed only when Firebase is unconfigured, and must always be labeled.
- Never fall back to demo data after a Firebase runtime error.
- Do not add credentials or administrative SDKs to browser code.
- Run lint, typecheck, unit tests, Firestore rules tests, build, and secret scan before release.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
