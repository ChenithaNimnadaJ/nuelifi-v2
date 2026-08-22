# Nuelifi payment activation

The payment path is implemented server-side in `cloudflare/worker.mjs` and is intentionally inactive until the provider secrets and annual Stripe Price IDs are configured as Cloudflare Worker secrets.

## Required secrets

Configure these Worker secrets without committing them to GitHub:

| Secret | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Creates server-side Checkout Sessions and retrieves subscriptions for invoice events. |
| `STRIPE_WEBHOOK_SECRET` | Verifies the raw `Stripe-Signature` header on `/api/stripe/webhook`. |
| `STRIPE_PRICE_PRO` | Annual Stripe Price ID for the $10 Pro plan. |
| `STRIPE_PRICE_PREMIUM` | Annual Stripe Price ID for the $30 Premium plan. |
| `SUPABASE_SERVICE_ROLE_KEY` | Lets the webhook update subscriptions and its private payment-event ledger. This key must never reach the browser. |

The existing `SUPABASE_URL` and `FRONTEND_ORIGIN` Worker configuration must remain present. The public checkout entry point is `POST /api/checkout`, and the Stripe event destination is:

```text
https://nuelifi.chenithanimnadaj.workers.dev/api/stripe/webhook
```

## Stripe configuration

Create recurring annual Prices for Pro at $10 USD per year and Premium at $30 USD per year. Configure the webhook to send at least `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.

Nuelifi writes `user_id` and `plan` into Checkout and Subscription metadata. The Worker verifies the raw request body signature, records every event in `payment_events`, uses an atomic claim function to avoid concurrent duplicate processing, retries events previously marked `failed`, and updates the user’s `subscriptions` row only after a verified event. Stripe retries a delivery that does not receive a successful 2xx response; the ledger preserves the event state for safe retry handling.

## Activation checklist

After creating the Prices and webhook endpoint, set all five secrets, deploy the Worker, and test a Stripe test-mode checkout. Confirm that the webhook request returns 200, the event row is `processed`, the matching `subscriptions` row changes to `pro` or `premium` with `status = active`, and the next authenticated `/api/usage` response reflects the matching daily entitlement. Only after that test should live-mode keys and Prices be configured.

The UI remains honest when these values are missing: the upgrade modal reports that payments are not connected yet and does not claim that a plan was purchased.
