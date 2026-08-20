# Nuelifi API

The local API runs on `http://localhost:8787` with `npm run backend`. Data is stored in `data/nuelifi.json` for the prototype. Set `NUELIFI_DATA_FILE` to use a different file.

## Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health check. |
| `POST` | `/api/analyze` | Analyze an image with Groq-first AI routing; returns validated analysis without writing data. The authenticated frontend then persists the meal and analysis to Supabase. |
| `POST` | `/api/users` | Create a user and free subscription. Body: `{ email, name?, goals? }`. |
| `GET` | `/api/users/:id/dashboard` | Dashboard summary with meal and action progress. |
| `GET` | `/api/users/:id/profile` | Read profile and preferences. |
| `PATCH` | `/api/users/:id/profile` | Update `name`, `goals`, `preferences`. |
| `GET` | `/api/users/:id/meals` | List analysed meals. |
| `POST` | `/api/users/:id/meals` | Create a meal analysis. Body requires `imageUrl`; optional `mealName` and `analysis` indicator inputs are supported. |
| `GET` | `/api/meals/:id` | Read one meal analysis. |
| `GET` | `/api/users/:id/actions` | List recommended actions. |
| `POST` | `/api/users/:id/actions` | Create an action. Body: `{ title, mealId? }`. |
| `PATCH` | `/api/actions/:id` | Complete or reopen an action. Body: `{ completed: boolean }`. |
| `GET` | `/api/users/:id/insights` | Return trend-ready meal score and rating summaries. |
| `GET` | `/api/users/:id/subscription` | Read current plan and subscription status. |

## Example flow

```sh
npm run backend:seed
curl http://localhost:8787/api/users/demo-user/dashboard
curl -X PATCH http://localhost:8787/api/actions/demo-action-2 \
  -H 'content-type: application/json' \
  -d '{"completed":true}'
```

Meal analysis now uses Groq Qwen 3.6 27B when configured, with Gemini as a fallback and the deterministic local assessment as a final fallback. The AI provider never writes to the database directly. The server validates the returned shape, the frontend persists the meal and analysis to Supabase for the signed-in user, and the shared Add to tasks action inserts recommendation tasks only after explicit user selection.
