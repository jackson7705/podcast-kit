# Main-domain R2 Worker

This Worker exposes a private R2 bucket below an existing site's `/podcast/` path. Stored objects
are streamed from R2; the landing page and missing object paths continue to the existing origin.

## Configure

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

Edit the Worker name, route zone, and bucket name in `wrangler.jsonc`. The runtime config is ignored
because each show has different infrastructure; the reusable example stays tracked.

## Validate and deploy

```bash
npm install
npm test
npx -p node@22 node node_modules/wrangler/bin/wrangler.js deploy --dry-run
npx -p node@22 node node_modules/wrangler/bin/wrangler.js deploy
```

Current Wrangler releases require Node 22. The test/check scripts use an isolated Node 22 runtime
so podcast-kit's Node 18+ core remains unchanged.

The R2 binding is read-only in public behavior: the handler accepts only `GET` and `HEAD`. Uploads
continue through podcast-kit's S3-compatible R2 publisher and local credentials.
