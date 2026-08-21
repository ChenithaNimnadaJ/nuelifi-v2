# Nuelifi UI and integration audit

## Responsive layout

The current app uses a fixed mobile-first shell with layered media queries. It caps the shell at 540px on small screens, 900px on tablets, and 1440px on desktop, with a two-column desktop rail. Several components still use fixed heights (`upload-zone`, `preview-image-wrap`, `result-hero`, `analysing-screen`) and hard-coded grid columns that can become cramped at very narrow widths or overly sparse at wide widths. The desktop layout also uses absolute positioning for the navigation rail, which needs careful containment and min-width handling.

## Theme and color system

The stylesheet is almost entirely hard-coded light-theme colors. There is no `.dark` token set, no root theme class, no `prefers-color-scheme` handling, and the Profile Appearance row is display-only. White text, dark cards, border colors, badges, chart strokes, inputs, and empty-state text are not semantic, so dark mode would create contrast failures if added without a token migration.

## Auth and persistence

Supabase PKCE auth and the frontend/backend API contract are already isolated and should remain unchanged. `profiles.preferences` is a JSON-compatible object and can persist an `appearance` preference without a database migration. The current profile editor updates preferences through `updateProfile`, but the Appearance row does not invoke it.

## User flows to preserve

The auth screen supports email sign-up, email sign-in, Google OAuth, and explicit preview mode. Authenticated users load profiles, meals, actions, and subscriptions from Supabase. Meal analysis goes through `/api/analyze` with a bearer token and saves the returned meal and recommendations. Recommendations are added through one consolidated Add to tasks action. Actions toggle completion through Supabase. The app has five main screens plus the meal-flow states and onboarding.

## Implementation direction

Introduce semantic CSS variables for light and dark themes, a small theme hook in `App.tsx` or a dedicated `ThemeContext`, and persist `appearance: light | dark | system` through existing profile preferences for authenticated users while using localStorage for immediate startup. Replace fixed layout constraints with `clamp()`, `minmax()`, `min-height`, `aspect-ratio`, and container-aware max widths. Add accessible labels and explicit button types where needed, then test at narrow mobile, tablet, desktop, and wide desktop sizes plus light/dark modes.
