# Tiered release validation notes

Validated on 2026-08-22 in production at https://nuelifi.chenithanimnadaj.workers.dev/.

- Pricing route serves the current bundle and shows Free, Pro, and Premium benefits plus $10/year and $30/year annual prices.
- Public pricing cards no longer show the internal daily AI allowance numbers.
- Login route retains the explicit sign-in form, Google sign-in button, and Continue with preview data path.
- Preview dashboard remains intact with the existing desktop rail and authenticated product layout.
- Profile shows `AI usage today`, Free daily allowance `0/2`, and `2 analyses remaining today · resets at midnight`.
- The local preview Insights route shows basic Free analytics plus locked Pro and Premium value cards.
- The local preview Premium analytics card opens the modern upgrade modal with Pro and Premium value framing, Premium marked BEST VALUE, annual prices, and checkout actions.
- Live smoke tests: `/health` 200, unauthenticated `/api/usage` 401, unauthenticated `/api/checkout` 401, unsigned `/api/stripe/webhook` 400.

The first production deployment after the code change used a stale Cloudflare manifest and served the previous pricing bundle. The manifest was regenerated from the current `dist` output, three current asset buckets were uploaded successfully, and the corrected deployment was then verified by the live pricing page above.

The corrected live build also serves the tiered Insights screen in preview mode: Free shows the basic score/history view, while Pro and Premium show distinct locked-value cards with separate upgrade actions. The Premium action is visible as the preferred value path.

The live Premium analytics modal was opened successfully. It presents Pro at $10/year and Premium at $30/year, marks Premium as BEST VALUE, explains main-meal and snack coverage, and includes verified-payment language. Clicking Choose Premium in preview mode correctly shows `Sign in to Nuelifi before choosing a paid plan` rather than pretending to start checkout.
