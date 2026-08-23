# Feature: Serve the AirSense podcast from the main domain

## Feature Description

Serve the podcast RSS feed, cover art, and episode audio below
`https://airsenseenvironmental.com/podcast/` while preserving the existing WordPress landing page.
Cloudflare R2 stores the immutable media objects and a read-only Worker exposes them through the
main-domain URL space.

## User Story

As Air Sense Environmental, I want podcast directories and media URLs to use our main domain so
that listener traffic and links reinforce `airsenseenvironmental.com` instead of a podcast
subdomain.

## Problem Statement

An R2 custom domain maps a hostname, not a path. Attaching R2 directly to a podcast subdomain would
separate the feed and media URLs from the primary domain. Routing all of `/podcast/*` without an
origin fallback could also replace the existing WordPress landing page.

## Solution Statement

Create an R2 bucket and a narrowly scoped Cloudflare Worker route at
`airsenseenvironmental.com/podcast/*`. The Worker reads an object whose key is the path after
`/podcast/`, streams it with correct metadata and range support, and passes missing objects plus the
landing-page request through to the existing origin. Configure podcast-kit to publish to R2 while
emitting main-domain URLs.

## Out of Scope / Non-Goals

- Do not publish or submit the demo episode.
- Do not create directory accounts until a real AirSense episode and valid live feed exist.
- Do not replace or redesign the WordPress landing page in this task.
- Do not expose write or delete operations through the public Worker.

## Feature Metadata

**Feature Type**: New capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: podcast-kit hosting configuration, Cloudflare Workers, Cloudflare R2
**Dependencies**: Cloudflare account access, Wrangler 4, R2 S3 credentials for the local publisher

## Related Work

This is the hosting foundation for the AirSense podcast launch and directory-submission work.

## CONTEXT REFERENCES

### Relevant Codebase Files

- `hosts/r2.py:1` - Existing S3-compatible R2 upload backend and public URL construction.
- `publish.py:38` - Upload order, object keys, and feed self-URL persistence.
- `show.config.example.json:29` - Canonical feed, audio, image, and host settings.
- `setup-check.mjs:93` - Environment validation for the selected hosting provider.
- `preflight.mjs` - Live HTTP checks that must pass before directory submission.
- `AGENTS.md` - Prohibits publishing scripts that fail the episode-writing gate.

### New Files to Create

- `worker/src/index.js` - Read-only R2-to-main-domain Worker with origin fallback.
- `worker/test/index.test.mjs` - Routing, streaming, HEAD, range, and fallback tests.
- `worker/wrangler.example.jsonc` - Reusable non-secret Worker/R2 configuration example.
- `worker/package.json` - Isolated validation scripts and development dependencies.
- `worker/README.md` - Deployment and binding instructions.

### Relevant Documentation

- https://developers.cloudflare.com/workers/configuration/routing/routes/#matching-behavior
  - Route wildcards match zero or more characters and a Worker route may fetch the configured origin.
- https://developers.cloudflare.com/r2/api/workers/workers-api-usage/
  - R2 binding reads, metadata propagation, streaming, and conditional/range inputs.
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
  - Binding-first architecture, streaming, observability, and promise handling.

### Patterns to Follow

- Keep all show-specific values in ignored runtime configuration, not generic implementation code.
- Stream `R2ObjectBody.body`; never buffer podcast audio.
- Use an R2 binding inside the Worker, not Cloudflare's REST API.
- Forward `/podcast/` and missing object paths with `fetch(request)` so WordPress remains authoritative.
- Only allow `GET` and `HEAD` for stored objects.

## IMPLEMENTATION PLAN

### Phase 1: Worker foundation

- Add the isolated Worker package and generic configuration example.
- Implement prefix-to-key routing, read-only object access, origin fallback, HTTP metadata, ETag,
  byte-range responses, and cache policy.

### Phase 2: Tests and local configuration

- Add deterministic tests with an in-memory R2 stub and an injected origin-fetch seam.
- Point the ignored AirSense show configuration at the main-domain feed, audio, and cover URLs.
- Configure R2 environment values without exposing credentials.

### Phase 3: Cloudflare provisioning

- Verify no conflicting bucket or Worker route exists.
- Create the R2 bucket, deploy the Worker with an R2 binding, and attach the
  `airsenseenvironmental.com/podcast/*` route.
- Stop if Cloudflare requests a paid-plan change or payment authorization.

### Phase 4: Validation

- Run Worker tests, JavaScript checks, setup-check, secret scan, and Wrangler dry-run.
- Verify the existing landing page still returns its WordPress content.
- Verify an unknown `/podcast/...` path falls through to the origin.
- Do not upload the demo feed or submit directories.

## STEP-BY-STEP TASKS

### CREATE `worker/src/index.js`

- **IMPLEMENT**: Map `/podcast/<key>` to `PODCAST_BUCKET.get/head`, stream successful reads,
  support HEAD and byte ranges, and delegate landing/missing paths to origin.
- **GOTCHA**: A `/podcast/*` route also matches `/podcast/`; the explicit origin fallback is required.
- **VALIDATE**: `npm --prefix worker test`
- **SATISFIES**: Main-domain serving without replacing WordPress.

### CREATE `worker/test/index.test.mjs`

- **IMPLEMENT**: Cover landing fallback, missing-object fallback, GET, HEAD, unsupported methods,
  content metadata, and range status/headers.
- **VALIDATE**: `npm --prefix worker test`
- **SATISFIES**: Route behavior and podcast-client compatibility.

### CREATE `worker/wrangler.example.jsonc`, `worker/package.json`, and `worker/README.md`

- **IMPLEMENT**: Current compatibility date, `nodejs_compat`, R2 binding, route placeholder,
  disabled workers.dev endpoint, and observability.
- **VALIDATE**: `npm --prefix worker run check`
- **SATISFIES**: Reproducible production deployment.

### UPDATE ignored AirSense runtime configuration

- **IMPLEMENT**: Use `https://airsenseenvironmental.com/podcast/feed.xml`,
  `https://airsenseenvironmental.com/podcast`, and the versioned main-domain cover URL; select R2.
- **VALIDATE**: `node setup-check.mjs`
- **SATISFIES**: Every emitted public podcast URL uses the main domain.

### PROVISION Cloudflare resources

- **IMPLEMENT**: Create/verify the bucket, bind it to the Worker, deploy, and add the route.
- **VALIDATE**: Wrangler deployment output plus live HTTP checks.
- **SATISFIES**: Production infrastructure exists without a podcast subdomain.

## TESTING STRATEGY

Use Node's built-in test runner for handler behavior and Wrangler's dry-run for bundling/config
validation. Use live `curl` checks only after deployment. Real media publication remains blocked
until grounded AirSense episode scripts pass `gates/check.py`.

## VALIDATION COMMANDS

```bash
npm --prefix worker test
npm --prefix worker run check
node setup-check.mjs
bash scripts/check-secrets.sh
python3 gates/check.py
curl -I https://airsenseenvironmental.com/podcast/
```

## ACCEPTANCE CRITERIA

- [x] The existing WordPress page remains available at `/podcast/`.
- [ ] RSS and media URLs resolve below `/podcast/` on the main domain.
- [x] Audio responses stream and support byte-range requests.
- [x] The Worker has read-only public behavior and uses an R2 binding.
- [x] No demo episode or feed is published.
- [ ] Local validation and the deployed smoke checks pass.

## OPEN QUESTIONS / ASSUMPTIONS

- Assumption: `airsenseenvironmental.com` remains proxied through the connected Cloudflare zone.
- Assumption: Cloudflare R2 and Workers can be enabled without a paid-plan change. If payment is
  requested, provisioning pauses for explicit user authorization.

## AMENDMENTS

- 2026-08-22 - Replaced the earlier podcast-subdomain approach at the user's direction so traffic,
  directory links, feed, and media all remain on the main domain.
- 2026-08-22 - Provisioned `airsense-podcast`, deployed the main-domain Worker and route, disabled
  its `workers.dev` URL, created a bucket-scoped publisher token, and published only the approved
  cover. RSS publication and directory submission remain blocked on the first grounded episode.
