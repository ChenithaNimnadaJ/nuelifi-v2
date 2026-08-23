# Supabase and AI environment setup

## 1. Apply the database schema

Open the Supabase project dashboard, go to **SQL Editor**, create a new query, paste the contents of `supabase/migrations/202608210001_nuelifi_core.sql`, and run it. This creates `profiles`, `meals`, `meal_analyses`, `actions`, and `subscriptions`, together with indexes, timestamps, the new-user trigger, and owner-only Row Level Security policies.

The migration expects Supabase Auth users. It automatically creates a profile and free subscription when a new Auth user is created.

## 2. Local replacement file

For local development, copy the committed template to this ignored file:

```text
/home/ubuntu/nuelifi-v2/.env.local
```

Use:

```sh
cp .env.example .env.local
```

Then replace the placeholders in `.env.local`.

| Variable | Used by | Secret level | Replacement |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser Supabase client | Public | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser Supabase client | Public | Your Supabase publishable/anon key |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional deployment alias | Public | Same Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional deployment alias | Public | Same Supabase publishable/anon key |
| `VITE_API_URL` | Browser-to-backend requests | Public URL | The deployed backend URL, or `http://localhost:8787` locally |
| `VITE_AUTH_REDIRECT_URL` | Supabase OAuth, email verification, and recovery callback origin | Public URL | Set `https://neulifi.online` for an explicit production build; local builds may use their exact local origin |
| `REQUIRE_AUTH` | Backend route protection | Server configuration | Set `true` on the deployed backend; local preview can leave it unset for explicit preview analysis |
| `SUPABASE_URL` | Server-side Supabase client | Server configuration | Your Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Optional server-side Supabase client | Server configuration | Your Supabase publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server operations | **Private** | Replace only in the backend secret store |
| `GROQ_API_KEY` | Server-side meal analysis | **Private** | Replace only in the backend secret store |
| `GROQ_MODEL` | Server-side meal analysis | Configuration | `qwen/qwen3.6-27b` |
| `GEMINI_API_KEY` | Free-tier Gemini key 1 | **Private** | Replace only in the backend secret store |
| `GEMINI_API_KEY_2` | Free-tier Gemini key 2 / redundancy | **Private** | Replace only in the backend secret store |

The browser client supports both `VITE_*` and `NEXT_PUBLIC_*` Supabase public names. The Vite build maps the Next-style aliases when a deployment platform provides those names. The browser client intentionally has no hardcoded project URL or key fallback; provide the public values through the build environment.

## 3. Deployment replacement locations

For the frontend preview or web deployment, add only the public variables to the platform’s **build environment variables**:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_API_URL
VITE_AUTH_REDIRECT_URL
```

If the platform specifically provides Next-style names, use:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
VITE_API_URL
VITE_AUTH_REDIRECT_URL
```

For the backend service, add the server-only variables to the platform’s **runtime secret/environment settings**:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
GROQ_API_KEY
GROQ_MODEL=qwen/qwen3.6-27b
GEMINI_API_KEY
GEMINI_API_KEY_2
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-2.5-flash
```

The frontend and backend must use the same Supabase project. The frontend should never receive `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, or `GEMINI_API_KEY_2`. Both Gemini credentials are Free Tier credentials; this implementation does not configure or use a paid Gemini API.

## 4. Start locally

```sh
pnpm install
pnpm run backend:seed
pnpm run backend
pnpm run dev
```

The current application uses the backend for server-side meal analysis and Supabase for authenticated profile, meal, analysis, action, and subscription persistence. The frontend sends the Supabase access token to the backend. With `REQUIRE_AUTH=true`, the backend rejects unauthenticated user-scoped requests with HTTP 401 and verifies that the token user matches the requested user ID. Gemini requests are free-first and stay server-side: the Worker tries the configured model sequence with Free Tier key 1, then key 2, using bounded retries and short-lived model/key cooldowns. There is no paid Gemini fallback.

On a fresh configured preview with no existing Supabase session, the application opens **Start your Nuelifi journey** and shows the sign-up form. After successful sign-up or sign-in, Supabase Auth establishes the session and the frontend loads the signed-in user’s private data. Demo data is available only through the explicit **Continue with preview data** link.

## 5. Configure authentication

In Supabase, open **Authentication → Providers** and enable the sign-in methods needed by Nuelifi. Email/password is the simplest first option. The application uses `supabase.auth.signUp`, `supabase.auth.signInWithPassword`, `supabase.auth.signInWithOtp` for passwordless email links, `supabase.auth.verifyOtp` or `supabase.auth.exchangeCodeForSession` on `/auth/confirm`, `supabase.auth.signOut`, and `supabase.auth.onAuthStateChange`.

### Google sign-in

In **Authentication → Providers → Google**, enable the provider and enter the Google OAuth **Client ID** and **Client Secret** from Google Cloud Console. Do not guess the callback URL: open the Google provider page in the Supabase Dashboard and copy the exact **Callback URL (for OAuth)** shown there. Add that exact value to Google Cloud Console under the Web application client’s **Authorized redirect URIs**. The Google client’s **Authorized JavaScript origins** should contain only the public origin `https://neulifi.online` for production, without a path.

The frontend’s **Continue with Google** button uses Supabase’s supported OAuth method and requests account selection:

```ts
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: "https://neulifi.online/app",
    queryParams: { prompt: "select_account" },
  },
});
```

The current source constructs the production redirect from `VITE_AUTH_REDIRECT_URL` when configured, otherwise it uses the canonical `https://neulifi.online` origin. Normal sign-in and sign-up return to `/app`, which is the application’s real protected destination; there is no `/dashboard` route. The checkout handoff intentionally uses `/welcome` instead. Both exact URLs must be allowed in Supabase **Authentication → URL Configuration → Redirect URLs** if the checkout handoff is enabled.

### Fix production URL and email redirects

Supabase uses **Authentication → URL Configuration** to decide the default destination for email confirmation and password-reset links. Supabase also validates every `redirectTo` value against the Redirect URLs allowlist. In the Supabase Dashboard, set:

| Setting | Production value |
| --- | --- |
| **Site URL** | `https://neulifi.online` |
| Redirect URL | `https://neulifi.online/app`, `https://neulifi.online/welcome`, and `https://neulifi.online/auth/confirm` |
| **Local development** | Add only the exact local callback paths you actually use, such as `http://localhost:5173/app` and `http://localhost:5173/welcome`. |

Avoid broad wildcards in production. If a temporary preview deployment must support OAuth, add its exact HTTPS callback paths separately and remove them when no longer needed. The frontend sends email confirmation and password-reset redirects based on the same configured auth origin; set `VITE_AUTH_REDIRECT_URL=https://neulifi.online` for an explicit production build, or omit it only when the canonical production fallback is acceptable. After changing these settings, create a new signup request because older verification emails retain their original redirect target.

The exact Supabase provider callback is different from the Nuelifi post-login redirect. The callback is the Google-to-Supabase handoff URI shown on **Authentication → Providers → Google**; `/auth/confirm` is the passwordless email-link confirmation screen; `/app` and `/welcome` are the final application destinations after Supabase establishes the session. The application sends magic-link emails to `/auth/confirm`, so that exact URL must be present in the Redirect URLs allowlist.

## 6. Security notes

Never commit `.env.local` or any real server secret. Never place a service-role, Groq, or either Gemini key in `src/`, `VITE_*`, `NEXT_PUBLIC_*`, or browser code. Public Supabase values are designed for browser use only when Row Level Security is enabled. Rotate any credential that has been shared outside the intended secret-management workflow. Replacing either Gemini key requires only updating the corresponding Worker secret and redeploying; no source change is required.
