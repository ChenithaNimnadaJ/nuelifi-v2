# Neulifi Final Release Report

## Executive result

The production release is served from the official Neulifi domain, `https://neulifi.online`. The frontend’s production configuration now uses the canonical origin for authentication returns, checkout success handling, Paddle configuration, and referral links. The obsolete Cloudflare default hostname is no longer enabled as a public Worker subdomain, and it is not used as a customer-facing alias.

The latest frontend asset bundle is `index-BsZM_3vL.js` with `index-BCKQrhJ1.css`. The Worker source contains a narrow defense-in-depth guard that recognizes only the exact obsolete hostname; legitimate future subdomains of `neulifi.online` are not redirected by that guard.

## Production deployment

The primary `neulifi` Worker deployment was accepted successfully after the canonical-domain source changes were regenerated and deployed. The custom-domain attachment is production-bound to `neulifi.online`, and the existing private Worker bindings were preserved.

| Item | Result |
|---|---|
| Official public URL | `https://neulifi.online/` |
| Official Plans URL | `https://neulifi.online/plans` |
| Official checkout route | `https://neulifi.online/checkout` |
| Frontend JavaScript | `index-BsZM_3vL.js` |
| Frontend CSS | `index-BCKQrhJ1.css` |
| Cloudflare custom domain | `neulifi.online` → `neulifi` production service |
| Default-subdomain exposure | Disabled for both `neulifi` and `nuelifi`; previews disabled |
| Repository | `ChenithaNimnadaJ/nuelifi-v2` |

The release does not delete the Worker scripts because the primary script remains the service behind the official custom domain. Instead, Cloudflare’s dedicated default-subdomain control was disabled for both scripts, preventing the obsolete host from acting as public product infrastructure.

## Canonical-domain behavior

All public product links, authentication return URLs, Paddle success URLs, and referral URLs use `https://neulifi.online`. A stale browser session that happens to load at the exact obsolete hostname is redirected to the official origin only for safe browser requests; non-browser requests to that obsolete host are rejected by the Worker guard. This fallback does not make the obsolete hostname a supported product domain.

The application continues to permit legitimate future `*.neulifi.online` subdomains because the Worker no longer treats every non-root hostname as legacy. Cloudflare currently has the production custom-domain attachment for `neulifi.online`; no extra subdomain has been created as part of this release.

## Public pricing and checkout validation

The Plans page renders annual-only billing. Free remains free; Pro is shown as `$10.00 / year`; Premium is shown as `$30.00 / year`. The page states that there are no free trials, shows the current daily analysis allowances, and explains that final totals, taxes, and currency are shown at checkout.

The live Premium Subscribe control opened the Paddle one-page overlay with `Neulifi Premium`, `$30.00/year`, and `$30.00 now`. No email address, card details, discount code, or payment submission was entered. The authorized temporary discount `NEULIFIQA100` was not applied or consumed.

## Authentication validation

The official login route rendered at `https://neulifi.online/login`. Starting Google sign-in reached Google’s account page without entering credentials. The OAuth request used the Supabase callback endpoint and encoded `redirect_to=https://neulifi.online/app`, confirming that new OAuth initiation returns to the official domain.

An anonymous visit to `https://neulifi.online/app` remained on the official `/app` route and showed the sign-in screen. It did not redirect to any non-canonical host or silently open a legacy dashboard. The browser console reported no runtime errors during this check.

## HTTP and build checks

The canonical root, `/app`, `/login`, `/plans`, `/checkout`, and `/api/paddle/config` routes returned successful responses in the production smoke test. The root and SPA routes returned HTML content types, while Paddle configuration returned JSON. The intended frontend bundle hashes were present in the live HTML, and no obsolete non-canonical URL literal was found in the deployed JavaScript bundle.

TypeScript validation, Worker syntax validation, and `git diff --check` passed after the final source changes. Cloudflare’s custom-domain inspection showed `neulifi.online` attached to the `neulifi` production service. The zone route list was empty, consistent with the custom-domain attachment being the active public binding.

## Scope and remaining audit work

This release completes the canonical-domain, auth-return, checkout-origin, and Workers.dev exposure changes. It does not claim that every item in the broader master production audit is complete. Preview-data UX, onboarding edge cases, responsive feature sections, PWA behavior, support-email routing, task/history interactivity, affiliate accounting, and additional accessibility/performance review remain separate audit items.
