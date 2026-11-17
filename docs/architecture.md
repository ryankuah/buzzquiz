# Reuse and generation

The quiz reads "What ___ are you based on your favourite ___?". Both blanks are short categories. The first identifies an outcome set and the second a question set. Each blank resolves to a topic in three steps:

1. Deterministic normalization handles case, Unicode width, accents, spacing, punctuation, sentence wrappers, favorite/favourite, color/colour, and selected plurals. Meaningful modifiers such as "least favourite" are preserved.
2. Saved aliases map wording that has already been resolved to its topic, with no AI request.
3. Unfamiliar wording is embedded (`text-embedding-3-large`, both blanks in one request) and compared with saved topics of the same kind using Convex vector search. It reuses the nearest topic only when cosine similarity is at least 0.84. Otherwise it becomes a new topic. Different categories can score above many true synonyms (for example "Harry Potter character" and "house at Hogwarts" both score about 0.71 against "Harry Potter house"), so the threshold is deliberately conservative: a missed synonym only costs a fresh generation.

Topics and aliases are recorded only once a quiz for them is saved, so matching only ever targets content that exists. Embedding failures fall back to the normalized wording. Cache keys hash the topic name; the basis key keeps a "favorite" prefix so content saved when the basis was a free phrase is still reused. `npm run topics:backfill` registers the wording of quizzes saved before topic matching, each as its own topic.

An outcome set stores four named outcomes, their reusable introductions and personality profiles, and a transparent foreground atlas. A question set stores its questions, answer illustrations, scoring clues, and an atmospheric result background. Both refer to four shared personality archetypes: curious, bold, warm, and driven. Questions never need to know which character category they will be paired with.

A new pairing of two saved sets requires no AI request. The server validates the scoring, attaches the mobile templates, and saves a playable quiz with a stable UUID. The result page layers the winning foreground over the question theme's background in the browser. It does not generate another result image.

Generation streams six steps to the page: checking saved quizzes, preparing results, creating result artwork, preparing questions, creating question artwork, and getting the quiz ready. The progress bar counts completed steps, not estimated time. Reused content is marked "Saved", including text recovered for an artwork retry. The final step stays active until the browser has loaded the artwork and heading font. Opening a shared quiz has its own loading state.

Detailed progress requires `X-Quiz-Progress-Version: 1`. Requests without a supported version receive only the original completion/error events, so tabs left open across deployments can still open saved quizzes. Clients ignore unfamiliar progress stages while continuing to validate the completed quiz.

After the player answers, the reusable outcome introduction appears immediately. The answer-specific reading is generated separately from the saved quiz and the actual selected answers. The server supplies the exact choice quoted in the reading. That reading is cached by quiz UUID and ordered answer IDs. Retakes with identical answers and other players choosing the same answers reuse the saved reading. Share links contain only the quiz UUID, so recipients start with no answers selected.

## Spending controls

Convex mutations enforce a global allowance of five generation attempts per UTC day. An outcome set, question set, or new personal reading each counts as one attempt. An entirely new subject and basis therefore use two attempts; a new personal reading uses a third. Recombining two saved sets uses none.

Claims and the daily counter update in one transaction. A lease prevents concurrent Vercel instances from paying for the same content. Each attempt can issue at most one text request and one image request, plus one background-scene request for question sets, each recorded before contacting the provider. Readings use only their text request. Failed attempts remain counted and automatic SDK retries and provider fallbacks are disabled. Provider refusals are remembered for that content key, so repeating a refused request cannot trigger more paid calls. An administrator can import existing permitted artwork to complete a saved set.

Text is checkpointed before image generation, so an artwork retry can reuse completed copy. Leases expire after five minutes if a process is lost. The server request timeout is shorter than the lease, and a new attempt is charged if work must be retried.

Outcome text is capped at 3,800 output tokens, question text at 6,500, personal readings at 1,800, and chat image responses at 8,192. Foregrounds use one low-quality native image request with transparent output; there is no chat output-token allowance on that image endpoint. These are output-token caps, not a dollar budget: provider pricing, input tokens, and image costs still apply. Configure an account-level provider spending limit as an additional hard monetary ceiling if needed.

When the allowance is used up, saved quizzes and saved readings remain accessible. The saved result introduction and artwork remain visible even if a new personal reading cannot be made. The limit is configured in the Convex deployment with `DAILY_GENERATION_LIMIT`; invalid values disable new generation.

## Storage and access

Convex stores content sets, complete quizzes, artwork files, generation claims, and daily call counters. All library functions require a server-only random secret shared by Convex and the Next.js API. AI credentials and the Convex deployment key never reach the browser. Saved asset URLs use opaque UUIDs and are immutable.

Question, answer and outcome art is drawn as transparent cutouts on one sprite sheet per set, using a native image endpoint with real alpha (low quality for portraits, medium for question sets). Image models never draw an exact grid, so the server repacks each sheet: it finds every object by its alpha channel, assigns it to the cell it was drawn for (splitting objects that straddle two wanted cells, and moving strays out of unused slots), and centres it with transparent padding in an exact 512px cell. Tiles therefore never show slivers of their neighbours and sit directly on the quiz theme. A question set's result background is a separate opaque image, so it has no grid to crop; it is stored at the start of an extra final row. Packed atlases are marked `packed`. Older opaque atlases are shown with each cell's outer 6.5% trimmed to hide neighbouring slivers.

Foreground generation uses one image per request. Storage validates that the output has real transparency. A connected-background matte remover is retained for compatibility with matte images; it preserves enclosed colours. Question art and background scenes share a separate atlas. Existing local quiz assets can be migrated without any AI calls; a saved question still-life becomes the result background for migrated question sets.

The app retains legacy compressed quiz links for playback. The old local filesystem store is used only by the migration script and related compatibility tests. Production storage is Convex, so Vercel does not need a writable persistent filesystem.

## Per-quiz style

Each quiz carries an optional `style`, so no two look alike, without extra AI requests:

- **Palette.** When a quiz is assembled, the server reads its question set's background scene (and, for packed atlases, the cutouts above it) and derives colours in OKLCH: a soft tint of the scene's main hue for the page, ink adjusted to at least 7:1 contrast, and the most vivid distinct hue for the accent. Dark scenes get a dark page. It is pure image maths, so new pairings of old sets get a palette too.
- **Typeface.** The outcome set's text request picks one heading face from a curated list (`typefaces` in `src/lib/quiz.ts`). The browser loads only that font from Google Fonts before showing the quiz, giving up after 1.5 seconds.
- **Stickers.** The question set's text request names four small themed decorations. They are drawn on the same sheet as the answers, in the row after the background scene, so they cost nothing extra. Two are stuck onto the corners of each question picture and the top corners of the result picture, a different pair per question. On phones, questions without a picture fill the spare bands above and below the question with a loose cluster of three each, sized to the room and hidden when it is tight. Wide screens also show them drifting in the side margins, and they burst from a chosen answer and from the result portrait (not under reduced motion). Only packed atlases use them, since stickers need clean cutouts.

Quizzes saved before this have no `style` and keep their preset theme and the default heading font.

## Sharing results

"Share my result" shares `/?quiz=<id>&got=<resultId>`. The link still opens the quiz unanswered; `got` only chooses the link preview. The home page's `generateMetadata` points Open Graph and Twitter tags at `/api/quizzes/<id>/card?result=<resultId>`, a 1200×630 PNG drawn with `next/og`: the result portrait on the quiz's scene, in its palette, heading typeface and stickers. Phones that can share files attach the card image itself.

## Suggesting existing topics

`/api/suggestions` groups the subjects and bases of every saved quiz by their canonical forms (`api.topics.savedQuizTopics`, cached for a minute) and records which pairs were drawn together. Any saved subject combined with any saved basis reuses existing artwork, so steering people towards them makes quizzes instant and free. The home page shows up to four matches for the focused blank as a quiet italic line under the sentence, ranking names paired with the other blank first. On devices with a keyboard and mouse, the best prefix match also shows faintly inside the blank; Tab or → accepts it in its saved casing.
