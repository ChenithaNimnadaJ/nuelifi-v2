# Nuelifi AI behavior specification

## Product rule

Nuelifi must distinguish between two different kinds of guidance:

> **Meal guidance** explains how the meal itself could be improved. It stays on the Meal analysis screen and is not automatically treated as a task.

> **Daily tasks** are simple, realistic behaviors the user can do during the day. The single **Add to tasks** button imports only these daily tasks into the Actions screen.

## AI response contract

The normalized analysis object is:

```json
{
  "rating": "Excellent | Good | Reasonable | Needs Adjustment",
  "score": 0,
  "indicators": {},
  "explanation": "",
  "mealGuidance": ["...", "..."],
  "dailyTasks": ["...", "..."]
}
```

`mealGuidance` contains two to four meal-specific observations or adjustments, such as adding vegetables, balancing a portion, or reducing a sauce next time. These items must refer to the meal or the next similar meal and must never be inserted into the persistent task list.

`dailyTasks` contains two to four short, doable, day-level actions. Examples include drinking water regularly, taking a short walk, choosing a realistic bedtime, or planning one supportive action for tomorrow. A daily task must be independently actionable and should not require changing the already photographed meal. It must not tell the user to add, remove, swap, reduce, include, or check a specific food, nutrient, ingredient, sauce, or portion. The backend applies a conservative sanitation pass as a defense-in-depth measure if a provider still misclassifies meal commentary as a daily task.

The frontend keeps backward compatibility with older saved `recommendations` arrays by treating them as meal guidance and deriving a conservative daily-task fallback only when no structured daily tasks exist. New AI responses always use the split fields.

## Condition-aware context

The user may provide optional context during onboarding and later in Profile:

- Known health conditions, entered only when previously identified by a qualified clinician.
- Food allergies or intolerances.
- Dietary preference.
- Activity level.
- Health goals.

The context is stored inside `profiles.preferences.healthContext` as JSON so no mandatory schema migration is required:

```json
{
  "healthContext": {
    "conditions": ["high blood pressure"],
    "allergies": ["peanuts"],
    "notes": "Optional context supplied by the user"
  }
}
```

The app sends only this minimal context, together with goals and dietary/activity preferences, to the authenticated analysis endpoint. The AI must treat it as user-provided context, not as a diagnosis. It must not infer a condition, prescribe treatment, advise medication changes, or present nutrition estimates as medical advice. When a condition creates a potentially consequential conflict, the response should stay conservative and direct the user to a clinician or registered dietitian.

## Prompt rules

The system prompt must explicitly require the model to:

1. Never diagnose, prescribe, or suggest medication changes.
2. Use known conditions and allergies only as constraints supplied by the user.
3. Avoid recommending a known allergen or contradicting an explicit dietary preference.
4. Keep meal guidance and daily tasks separate.
5. Make daily tasks achievable today, not plate-editing instructions; the backend will reject food-editing instructions from the task list.
6. Use cautious language because the values are estimates.
7. Return only schema-valid JSON.

## Profile behavior

The Profile screen must make the following controls real:

- Edit and persist the user name and health goals.
- Edit and persist known conditions, allergies/intolerances, dietary preference, and activity level.
- Persist appearance and the currently supported account preferences.
- Avoid presenting email reminders or notification services as active functionality until a notification provider and scheduler exist. Unsupported reminder controls should be labeled as planned or disabled rather than pretending to send email.
- Show a Pro preview with planned entitlements and an explicit “billing not connected yet” state. It must not pretend that a payment has been completed.

## Pro boundary for this iteration

This iteration introduces the plan model and honest UI copy only. It does not add checkout, payment collection, ads, or purchase claims. A later payment implementation should use a server-created Stripe Checkout session, webhook-verified subscription state, and the existing `subscriptions` table as the source of truth. Client-side plan badges must never be the authority for entitlements.

## Cloudflare budget guardrails

Keep the current compact static bundle, authenticated analysis route, bounded provider requests, and small JSON profile context. The current bundle is far below the documented static-asset limits. The main variable cost is AI inference, so a future production launch should add an application-level analysis quota before paid traffic or ads are introduced.
