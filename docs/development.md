# Development and deployment

Requires Node.js 24 and a Convex account. Install dependencies, copy `.env.example` to `.env.local`, and run `npx convex dev` to create or select a development deployment.

Generate a random `BUZZQUIZ_SERVER_SECRET` and set the same value in `.env.local` and the Convex deployment. Configure a server-side OpenRouter or OpenAI key in `.env.local`; credentials are never public environment variables. Run `npm run dev` for the website and keep `npx convex dev` running when changing backend functions.

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
- `OPENROUTER_API_KEY` for OpenRouter. The optional overrides are `QUIZ_AI_MODEL` for planning and writing, `QUIZ_READING_MODEL` for personal readings, `QUIZ_IMAGE_MODEL` for backgrounds, and `QUIZ_FOREGROUND_MODEL` for cutouts. Direct OpenAI uses the `OPENAI_*` settings in `.env.example`.

Set `BUZZQUIZ_SERVER_SECRET` in the production Convex deployment too. Keep production credentials scoped to Production; previews need their own backend/credentials if enabled. Next.js API generation routes use a Node.js runtime and a 300-second maximum duration.

Add the desired custom domain to the Vercel project and verify its DNS and HTTPS separately from the deployment's Ready status.

## Migrating locally generated quizzes

Back up `.quiz-library/` and `.quiz-assets/`, configure the target Convex URL and server secret, then run:

```sh
npm run migrate:local
```

The script preserves old quiz UUIDs for compatibility and imports reusable question sets. It reuses saved question artwork and a saved still-life for the background without making an AI call. New subject foregrounds and reusable introductions are created on demand. Existing files remain on disk.

For a different target deployment, set `CONVEX_URL` to that deployment when running the migration. All environment files and local/generated caches are ignored by Git. Historical manually generated art is retained locally but excluded from the published repository.

## Stock artwork

The [stock catalogue](stock-art.md) lists the checked-in illustrations, their quiz subjects and their original sheets. Each library entry points to a cell of a WebP held in Convex file storage. The app can use that artwork as soon as its database entry is indexed.

Run `npm run library:stock -- --check` to validate the local sheets. Run `npm run library:stock` to sync the configured development database. A source prefix, such as `npm run library:stock -- question-bank/v1/hobbies/`, limits the import to that collection. To load production with the local credentials for this project, run `node --env-file=.env.local --env-file=.env.production --import tsx scripts/import-stock-art.ts`.

The importer computes text embeddings for new entries, uploads each unique sheet, downloads it again to verify its SHA-256 checksum, and reads back each indexed cell. Rerunning it verifies existing records and resumes incomplete imports. Published source paths and cell positions identify immutable artwork. Give replacement sheets a new source key.
