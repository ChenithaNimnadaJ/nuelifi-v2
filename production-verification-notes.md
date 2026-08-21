# Production verification notes

## 2026-08-21

The standalone Cloudflare Worker URL `https://nuelifi.chenithanimnadaj.workers.dev/` loads the Nuelifi authentication screen in Chromium. The UI includes Google sign-in, email sign-up, email sign-in, and an explicit “Continue with preview data” path.

After selecting preview data, the dashboard renders successfully with the responsive navigation, health score, meal analysis CTA, recent meal card, actions, insights, and profile navigation. The preview banner explicitly states that demo data is being shown. No authenticated production user flow was exercised because that would require user credentials.

The production Worker-hosted preview navigated successfully into the Analyse screen, showing capture/upload controls and example meals. It then navigated successfully into the Insights screen, showing the preview banner, score summary, meal history chart, and recent meal card.

The production Worker-hosted preview navigated successfully to Actions, showing the preview banner, completion count, and a task row. It also navigated successfully to Profile, showing the preview profile, health goals, plan label, preference toggles, appearance control, upgrade CTA, and sign-out control.

After the final Worker deployment, refreshing the production URL briefly showed the auth initialization state and then resolved to the interactive sign-up/sign-in screen. This confirms the rebuilt bundle and final redirect configuration are being served successfully.

Supabase dashboard verification: the project’s previous Site URL was a Netlify placeholder and the only redirect entry was `https://your-nuelifi-preview.example.com/**`. The Site URL was changed to `https://nuelifi.chenithanimnadaj.workers.dev` and submitted for saving. The redirect allowlist still needs the live Worker wildcard entry.

Supabase accepted the new Site URL and the redirect editor is open. The current allowlist contains only the old placeholder `https://your-nuelifi-preview.example.com/**`; the live Worker wildcard is being added now.

The live redirect entry `https://nuelifi.chenithanimnadaj.workers.dev/**` has been added to the Supabase redirect editor and is ready to save alongside the existing placeholder entry.

Supabase initially rejected the redirect-list save because the editor creates a blank extra row after adding an entry. The blank row was removed; the editor now contains the valid live Worker wildcard and is ready to save.

Supabase Auth URL Configuration is now persisted with Site URL `https://nuelifi.chenithanimnadaj.workers.dev` and two redirect URLs: the existing placeholder and `https://nuelifi.chenithanimnadaj.workers.dev/**`. The dashboard shows Total URLs: 2.

Supabase provider settings showed Email enabled and Google enabled. The provider page then reported that the dashboard session had expired, so the exact Google Cloud Console callback URI could not be inspected further without a renewed Supabase dashboard sign-in.

Supabase provider verification: Email is enabled and Google is enabled. The Google provider panel displays the OAuth callback URL `https://mtfqktpfcwoigmpmdkwh.supabase.co/auth/v1/callback`. The configured Google client ID and secret are present; credential values are not recorded in the repository notes.

## UI refactor browser tests

The local build rendered the auth screen at the default browser viewport and entered preview mode only through the explicit preview link. Preview navigation reached Profile successfully. The Profile screen now exposes an Appearance select with System, Light, and Dark options; selecting Dark updated the page background, navigation rail, surfaces, borders, and text to the dark palette without breaking the controls.

Responsive screenshot checks: at 390x844 the auth card fits without horizontal clipping, controls remain touch-sized, and body text wraps cleanly. At 768x1024 the card scales to a comfortable readable width and remains vertically centered with consistent spacing.

The updated auth screen exposes a pre-auth Appearance theme selector and retained the dark theme from localStorage after hot reload. Preview mode still clearly labels demo data. The dashboard reached Analyse through the sidebar, and the capture screen exposed camera/upload inputs plus three example buttons with accessible labels.

During local hot-reload testing, changing source reset the in-memory preview state back to the auth screen; this is expected development behavior, not a persisted-user failure. The auth screen remained interactive after the reset.

After rebuilding, the app repeatedly re-entered preview mode cleanly and navigated to the dark Analyse screen. The Analyse surface continued to show accessible camera/upload labels and sample buttons without layout errors.

A repeated sample-button click encountered a stale browser element index because Vite hot reload had reset the in-memory preview state to auth. Refreshing the element map confirmed the auth screen was healthy; no production runtime error was observed.

The protected preview behavior is now explicit: the Analyse screen displays “Preview mode uses sample data. Sign in to analyse and save your own meals.” This prevents an anonymous `/api/analyze` call and aligns the UI with `REQUIRE_AUTH=true`.

The browser automation again returned to auth when a cached sample-button index was used after Vite refreshed. This was a test harness/index-staleness issue in the local hot-reload session, not an application error; the app remained reachable and the protected-preview messaging was visible on the prior fresh Analyse render.

A DOM-based test entered preview mode successfully after cached browser indexes proved unreliable during Vite hot reload. The dashboard mounted with the preview banner and five navigation destinations. One malformed console expression was rejected by the browser evaluator and was corrected immediately; it did not affect the app.

A DOM navigation test ran after another Vite refresh and found no mounted navigation buttons because the app had reset to its auth gate. A fresh browser view confirmed the auth screen was healthy and retained the theme selector. This is a local hot-reload state-reset limitation, not an auth or UI rendering regression.

Refreshed screenshot results after the final UI changes: 390x844 mobile shows the theme selector, form, buttons, and preview link fitting without clipping; 768x1024 tablet scales the auth card and type comfortably while retaining balanced whitespace.

The refreshed 1440x1000 wide screenshot keeps the auth card centered and proportionate with generous whitespace; the theme selector remains aligned in the card header. Live Worker backend smoke checks returned `/health` HTTP 200, unauthenticated `/api/analyze` HTTP 401, and CORS OPTIONS HTTP 204 with the expected allowed origin, headers, and method.

## Production UI verification

The live Worker at `https://nuelifi.chenithanimnadaj.workers.dev/` rendered the updated auth screen with the Appearance theme selector. Selecting Dark mode in the production browser successfully updated the background, card, and text colors to the dark palette. The responsive layout remained centered and proportionate. The JavaScript bundle confirmed the presence of the new protected-preview handoff logic.
