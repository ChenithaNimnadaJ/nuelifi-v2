# Cloudflare deployment notes

Cloudflare’s official documentation for [Workers static assets direct upload](https://developers.cloudflare.com/workers/static-assets/direct-upload/) describes manifest registration, asset upload, and script deployment using an assets binding. The Neulifi release uses that Worker module and assets workflow rather than treating an unrelated Pages project as the public application.

## Current production attachment

The production service is the `neulifi` Worker with the custom domain `https://neulifi.online`. The custom-domain attachment is registered in the production environment, and the Worker serves the Neulifi frontend, `/health`, authenticated API routes, Paddle endpoints, and CORS preflight handling. Private Worker secrets remain configured outside the repository.

The older Pages experiments and default Cloudflare Worker subdomains are not public product URLs. They are not used in frontend configuration, Supabase Auth URL configuration, Paddle checkout URLs, OAuth returns, customer emails, or referral links.

## Current release behavior

The frontend is built with an empty production `VITE_API_URL` so same-origin API requests use `https://neulifi.online`, together with `VITE_AUTH_REDIRECT_URL=https://neulifi.online`. The live JavaScript and CSS assets are `index-BsZM_3vL.js` and `index-BCKQrhJ1.css`.

The Worker contains a defense-in-depth check for the exact obsolete default hostname. Safe browser requests from that hostname are forwarded to the official origin with supported authentication callback parameters preserved; legitimate future subdomains of `neulifi.online` are not caught by this guard. Cloudflare’s dedicated default-subdomain setting is disabled for both the primary and legacy script names, and preview subdomains are disabled as well.

## Verification status

The official root, `/app`, `/login`, `/plans`, `/checkout`, and `/api/paddle/config` routes have been smoke-tested on `https://neulifi.online`. The Google OAuth initiation encoded `https://neulifi.online/app` as its return target. The live Premium annual checkout overlay displayed `$30.00/year` and was closed without entering payment information or submitting a transaction.
