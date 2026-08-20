# Nuelifi API

The local API runs on `http://localhost:8787` with `npm run backend`. Data is stored in `data/nuelifi.json` for the prototype. Set `NUELIFI_DATA_FILE` to use a different file.

## Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health check. |
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

The current analysis is intentionally deterministic and local so the UI can be developed immediately. A production analysis worker can replace `mealAssessment` while preserving the response shape. Authentication, object storage, payment provider webhooks, and a managed relational database should be added before handling real user health data.
