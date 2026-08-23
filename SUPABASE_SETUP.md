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
| `VITE_AUTH_REDIRECT_URL` | Supabase email verification callback | Public URL | Optional exact app/preview origin; otherwise the current browser origin is used |
| `REQUIRE_AUTH` | Backend route protection | Server configuration | Set `true` on the deployed backend; local preview can leave it unset for explicit preview analysis |
| `SUPABASE_URL` | Server-side Supabase client | Server configuration | Your Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Optional server-side Supabase client | Server configuration | Your Supabase publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server operations | **Private** | Replace only in the backend secret store |
| `GROQ_API_KEY` | Server-side meal analysis | **Private** | Replace only in the backend secret store |
| `GROQ_MODEL` | Server-side meal analysis | Configuration | `qwen/qwen3.6-27b` |
| `GEMINI_API_KEY` | Free-tier Gemini key 1 | **Private** | Replace only in the backend secret store |
| `GEMINI_API_KEY_2` | Free-tier Gemini key 2 / redundancy | **Private** | Replace only in the backend secret store |

The browser client supports both `VITE_*` and `NEXT_PUBLIC_*` Supabase public names. The Vite build maps the Next-style aliases when a deployment platform provides those names.

## 3. Deployment replacement locations

For the frontend preview or web deployment, add only the public variables to the platform’s **build environment variables**:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_API_URL
```

If the platform specifically provides Next-style names, use:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
VITE_API_URL
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

In Supabase, open **Authentication → Providers** and enable the sign-in methods needed by Nuelifi. Email/password is the simplest first option. The application uses `supabase.auth.signUp`, `supabase.auth.signInWithPassword`, `supabase.auth.signInWithOAuth`, `supabase.auth.signOut`, and `supabase.auth.onAuthStateChange`.

### Google sign-in

In **Authentication → Providers → Google**, enable the provider and enter the Google OAuth **Client ID** and **Client Secret** from Google Cloud Console. For this project, the Google OAuth client’s **Authorized redirect URI** must be exactly:

```text
https://mtfqktpfcwoigmpmdkwh.supabase.co/auth/v1/callback
```

This is the **Supabase callback**, not the Nuelifi preview URL. Copy the same value into Google Cloud Console under **APIs & Services → Credentials → OAuth 2.0 Client IDs → Authorized redirect URIs**. The Google client’s **Authorized JavaScript origins** should contain the public Nuelifi preview/app origin, for example `https://your-preview-domain.example.com`, with no path. The frontend’s **Continue with Google** button calls:

```ts
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: window.location.origin },
});
```

The app returns to the active preview origin after Google authentication. That origin must also be present in Supabase **Authentication → URL Configuration → Redirect URLs**.

### Fix email verification redirects

Supabase uses its Auth URL Configuration to decide where email verification links return. In the Supabase dashboard, open **Authentication → URL Configuration** and set:

| Setting | Value |
| --- | --- |
| **Site URL** | The public URL of the deployed Nuelifi app or preview, not `http://localhost:3000` unless you are actually testing there. |
| **Redirect URLs** | Add the exact public preview URL and, if supported by your workflow, its wildcard path such as `https://your-preview-domain.example/**`. |
| Local development | Add `http://localhost:5173/**` for Vite dev and `http://localhost:4173/**` for the usual Vite preview port. Add `http://localhost:3000/**` only if you truly run the app on port 3000. |

The frontend now sends `emailRedirectTo: window.location.origin` during signup, or uses `VITE_AUTH_REDIRECT_URL` if you set an explicit public origin. The origin used by the app must also be present in Supabase’s **Redirect URLs** allowlist. After changing these settings, create a new signup request; old verification emails retain their original redirect target.

## 6. Security notes

Never commit `.env.local` or any real server secret. Never place a service-role, Groq, or either Gemini key in `src/`, `VITE_*`, `NEXT_PUBLIC_*`, or browser code. Public Supabase values are designed for browser use only when Row Level Security is enabled. Rotate any credential that has been shared outside the intended secret-management workflow. Replacing either Gemini key requires only updating the corresponding Worker secret and redeploying; no source change is required.
