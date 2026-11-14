# Development and deployment

Requires Node.js 24 and a Convex account. Install dependencies, copy `.env.example` to `.env.local`, and run `npx convex dev` to create or select a development deployment.

Generate a random `BUZZQUIZ_SERVER_SECRET` and set the same value in `.env.local` and the Convex deployment. Set `DAILY_GENERATION_LIMIT=5` in Convex. Configure a server-side OpenRouter or OpenAI key in `.env.local`; credentials are never public environment variables. Run `npm run dev` for the website and keep `npx convex dev` running when changing backend functions.

## Checks

```sh
npm test
npm run typecheck
npm run format:check
npm run build
npm run test:e2e
```

Unit tests use an in-memory Convex backend and mock provider responses. Browser tests disable AI credentials and backend access, covering mobile layouts, generation states, layered results, sharing, and legacy links. Tests never need a paid AI request. Mocked tests do not establish live provider availability or image quality.

## Production on Vercel

Connect the GitHub repository to a Vercel project and set the production branch to `main`. The checked-in `vercel.json` deploys Convex functions and builds Next.js together on each production push, following Convex's [Vercel deployment workflow](https://docs.convex.dev/production/hosting/vercel).

Set these production variables in Vercel:

- `CONVEX_DEPLOY_KEY`: a production deployment key for this Convex project.
- `CONVEX_URL`: the production Convex URL.
- `BUZZQUIZ_SERVER_SECRET`: matching the production Convex environment.
- `OPENROUTER_API_KEY` and optional `QUIZ_AI_MODEL` / `QUIZ_IMAGE_MODEL` / `QUIZ_FOREGROUND_MODEL`, or the direct OpenAI equivalents in `.env.example`.

Set `BUZZQUIZ_SERVER_SECRET` and `DAILY_GENERATION_LIMIT` in the production Convex deployment too. Keep production credentials scoped to Production; previews need their own backend/credentials if enabled. Next.js API generation routes use a Node.js runtime and a 300-second maximum duration.

Add the desired custom domain to the Vercel project and verify its DNS and HTTPS separately from the deployment's Ready status.

## Migrating locally generated quizzes

Back up `.quiz-library/` and `.quiz-assets/`, configure the target Convex URL and server secret, then run:

```sh
npm run migrate:local
```

The script preserves old quiz UUIDs for compatibility and imports reusable question sets. It reuses saved question artwork and a saved still-life for the background without making an AI call. New subject foregrounds and reusable introductions are created on demand under the normal allowance. Existing files remain on disk.

For a different target deployment, set `CONVEX_URL` to that deployment when running the migration. All environment files and local/generated caches are ignored by Git. Historical manually generated art is retained locally but excluded from the published repository.
