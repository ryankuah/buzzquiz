# Reuse and generation

The first blank identifies an outcome set. The second identifies a question set. Both use deterministic prompt normalization: case, Unicode width, spacing, punctuation, common sentence wrappers, favorite/favourite, color/colour, and selected plural forms. Meaningful modifiers are preserved. Matching is conservative equivalence, not arbitrary semantic search.

An outcome set stores four named outcomes, their reusable introductions and personality profiles, and a transparent foreground atlas. A question set stores its questions, answer illustrations, scoring clues, and an atmospheric result background. Both refer to four shared personality archetypes: curious, bold, warm, and driven. Questions never need to know which character category they will be paired with.

A new pairing of two saved sets requires no AI request. The server validates the scoring, attaches the mobile templates, and saves a playable quiz with a stable UUID. The result page layers the winning foreground over the question theme's background in the browser. It does not generate another result image.

After the player answers, the reusable outcome introduction appears immediately. The answer-specific reading is generated separately from the saved quiz and the actual selected answers. The server supplies the exact choice quoted in the reading. That reading is cached by quiz UUID and ordered answer IDs. Retakes with identical answers and other players choosing the same answers reuse the saved reading. Share links contain only the quiz UUID, so recipients start with no answers selected.

## Spending controls

Convex mutations enforce a global allowance of five generation attempts per UTC day. An outcome set, question set, or new personal reading each counts as one attempt. An entirely new subject and basis therefore use two attempts; a new personal reading uses a third. Recombining two saved sets uses none.

Claims and the daily counter update in one transaction. A lease prevents concurrent Vercel instances from paying for the same content. Each attempt can issue at most one text request and one image request, recorded before contacting the provider. Readings use only their text request. Failed attempts remain counted and automatic SDK retries and provider fallbacks are disabled. Provider refusals are remembered for that content key, so repeating a refused request cannot trigger more paid calls. An administrator can import existing permitted artwork to complete a saved set.

Text is checkpointed before image generation, so an artwork retry can reuse completed copy. Leases expire after five minutes if a process is lost. The server request timeout is shorter than the lease, and a new attempt is charged if work must be retried.

Outcome text is capped at 3,800 output tokens, question text at 6,500, personal readings at 1,800, and chat image responses at 8,192. Foregrounds use one low-quality native image request with transparent output; there is no chat output-token allowance on that image endpoint. These are output-token caps, not a dollar budget: provider pricing, input tokens, and image costs still apply. Configure an account-level provider spending limit as an additional hard monetary ceiling if needed.

When the allowance is used up, saved quizzes and saved readings remain accessible. The saved result introduction and artwork remain visible even if a new personal reading cannot be made. The limit is configured in the Convex deployment with `DAILY_GENERATION_LIMIT`; invalid values disable new generation.

## Storage and access

Convex stores content sets, complete quizzes, artwork files, generation claims, and daily call counters. All library functions require a server-only random secret shared by Convex and the Next.js API. AI credentials and the Convex deployment key never reach the browser. Saved asset URLs use opaque UUIDs and are immutable.

Foreground generation uses a native image endpoint with transparent PNG output, one image per request, and low quality. Storage validates that the output has real transparency. A connected-background matte remover is retained for compatibility with matte images; it preserves enclosed colours. Question art and background scenes share a separate atlas. Existing local quiz assets can be migrated without any AI calls; a saved question still-life becomes the result background for migrated question sets.

The app retains legacy compressed quiz links for playback. The old local filesystem store is used only by the migration script and related compatibility tests. Production storage is Convex, so Vercel does not need a writable persistent filesystem.
