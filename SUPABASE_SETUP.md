# Supabase and Gemini setup

## 1. Apply the database schema

Open the Supabase project dashboard, go to **SQL Editor**, create a new query, paste the contents of `supabase/migrations/202608210001_nuelifi_core.sql`, and run it. This creates profiles, meals, meal analyses, actions, subscriptions, indexes, timestamps, a new-user trigger, and owner-only Row Level Security policies.

The migration expects Supabase Auth users. It automatically creates a profile and free subscription when a new Auth user is created.

## 2. Configure local environment variables

Copy `.env.example` to `.env.local` and fill in the values. The frontend may use only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_API_URL`. Keep `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` server-side only.

Start the local services with:

```sh
pnpm install
pnpm run backend:seed
pnpm run backend
pnpm run dev
```

## 3. Configure authentication

In Supabase, open **Authentication → Providers** and enable the sign-in methods needed by Nuelifi. Email/password or magic-link authentication is the simplest first option. Once selected, the current demo-user flow can be replaced with `supabase.auth.signInWithPassword`, `supabase.auth.signInWithOtp`, and `supabase.auth.onAuthStateChange`.

## 4. Configure Gemini

The backend uses Google's `generateContent` REST endpoint with the `gemini-3.7-flash` model by default. The model accepts image input and structured JSON output. Set `GEMINI_API_KEY` in the server environment. If the key is absent or the request fails, the backend keeps the current deterministic analysis so preview development remains available.

## 5. Storage

When real uploads are enabled, create a private Storage bucket named `meal-images`. Uploads should be associated with the authenticated user's ID, and the server should issue signed URLs for analysis and display. Do not make meal images public if they may contain personal or health-related information.

## Security notes

Never place a Supabase service-role key or Gemini key in `src/`, `VITE_*` variables, browser code, or committed files. The publishable Supabase key is designed for browser use with Row Level Security enabled. Rotate any credential that has been shared outside the intended secret-management workflow.
