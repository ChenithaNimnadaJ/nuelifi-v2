# Cloudflare deployment notes

Cloudflare official direct upload documentation: https://developers.cloudflare.com/pages/get-started/direct-upload/ (retrieved 2026-08-21). It states that Pages Direct Upload accepts a prebuilt assets folder, can include a `_worker.js` file, and Pages Functions are supported with Wrangler; `_worker.js` is supported for direct deployments. Cloudflare official Pages Create Deployment API: https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/create/ (retrieved 2026-08-21). The API accepts multipart form data with a manifest and `_worker.js` and returns deployment status and URL.

Cloudflare Workers static assets direct upload documentation: https://developers.cloudflare.com/workers/static-assets/direct-upload/ (retrieved 2026-08-21). It describes manifest registration, asset upload, and script deployment using an assets binding.

Cloudflare account: account ID is handled by the connector. Existing Pages projects were `bolt` and `studyly`; none matched Nuelifi. A new Pages project was created: `nuelifi`, project ID `b4857da5-8e14-4229-8fc7-5a48a953a919`, production branch `main`, domain `https://nuelifi.pages.dev`.

Successful production deployment: deployment ID `e0ddfd05-d8ad-41f0-bc8b-c177f40a690d`, short ID `e0ddfd05`, URL `https://e0ddfd05.nuelifi.pages.dev`, created 2026-08-21T14:31:54Z, status accepted and queued. It contains the frontend assets and `_worker.js`.

Production env vars configured on the Pages project include VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_AUTH_REDIRECT_URL, FRONTEND_ORIGIN, REQUIRE_AUTH=true, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, GROQ_API_KEY secret, GROQ_MODEL=qwen/qwen3.6-27b, GEMINI_API_KEY secret, GEMINI_MODEL=gemini-3.7-flash, and GEMINI_FALLBACK_MODELS=gemini-3.5-flash,gemini-2.5-flash. Secret values are not recorded here.

## Final deployment outcome

The working production deployment is the standalone Cloudflare Worker at `https://nuelifi.chenithanimnadaj.workers.dev/`. Worker deployment `77e706be6ec14cbc9170025b2a439146` was accepted at 2026-08-21T15:05:25Z with `has_assets: true`; the Worker subdomain was enabled at the account’s existing `chenithanimnadaj.workers.dev` subdomain.

The Worker serves the Nuelifi frontend and `/health`, `/api/analyze`, and CORS preflight routes. Server-side Worker secrets were configured for Supabase authentication, Groq, Gemini, and `REQUIRE_AUTH=true`. The unauthenticated analysis check returns HTTP 401, and CORS preflight returns HTTP 204.

The Cloudflare Pages project deployments remain HTTP 500 even after static-only direct-upload attempts. The Worker deployment is therefore the canonical live URL for this release; the Pages project was left intact for later cleanup or repair.

The production frontend build was generated with `VITE_API_URL=https://nuelifi.chenithanimnadaj.workers.dev` and `VITE_AUTH_REDIRECT_URL=https://nuelifi.chenithanimnadaj.workers.dev`. The bundle was verified to contain the live Worker API URL. Browser verification confirmed the authentication screen, preview dashboard, Analyse, Actions, Insights, and Profile screens render on the Worker URL.
