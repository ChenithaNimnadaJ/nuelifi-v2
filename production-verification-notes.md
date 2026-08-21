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
