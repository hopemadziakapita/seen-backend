# Seen — AI & data flow backend

Backend-only implementation of the "Developer 2: AI and data flow" role: AI
follow-up questions, AI daily summaries/reflections, and rule-based pattern
detection. No frontend, no illustrated scene — this is an API only, deployed
as an Azure Functions app.

**Architecture principle: the backend is only called for things that
actually need it** — a real AI call, persisting a day, or reading back saved
history/patterns. Signal interpretation (`interpretSignals`) and clue
scoring/scene composition (`scoreClue`/`selectDisplayClues`) are pure,
deterministic, zero-AI logic operating only on data the phone already has —
there is no reason to pay a network round-trip for them. That logic runs
**on-device**; see "On-device logic" below for the exact rules to port.

- **Compute**: Azure Functions (Node.js 22, v4 programming model). Dev: Linux Consumption plan. Production: Elastic Premium EP1 with VNet Integration.
- **AI**: Azure OpenAI (chat completions + function calling for structured output)
- **Secrets**: Azure Key Vault, read via a Key Vault reference resolved by the
  Function App's system-assigned managed identity — the API key is never in
  app settings, code, or logs in plaintext
- **Persistence**: Azure Cosmos DB (NoSQL API), partitioned by `/userId` for
  per-user data isolation
- **Network (production)**: VNet with private endpoints for Cosmos DB, Key
  Vault, and Storage. Application Gateway with WAF v2 as the single public
  entry point. Function App is not publicly accessible.

## Project layout

```
src/
  types.ts               DailyContext / Clue / DailyEntry / FollowUpQuestion / PatternObservation
  data/
    clues.json            20-clue starter library — canonical data, mirror this on-device
    profiles.ts            Demo profiles A (overloaded) / B (active) / C (quiet recovery)
  lib/
    signals.ts             interpretSignals() — reference implementation only; runs on-device in the real app (see "On-device logic")
    scoring.ts              scoreClue() + selectDisplayClues() — same: reference implementation, runs on-device in the real app
    azureOpenAIClient.ts    Azure OpenAI client, reads endpoint/key/deployment from env
    followUpEngine.ts       AI follow-up question + safety validation + category fallback
    summaryEngine.ts        AI daily summary, confirmed-info-only, no causal language
    reflectionEngine.ts     AI whole-day reflection (generate + user-steered refine), same safety rules
    textSafety.ts           shared causal/diagnostic phrase matching used by all three AI-text engines
    patterns.ts             calculateCoOccurrence() + associative-only text
    cosmosClient.ts         Shared Cosmos DB client factory
    store.ts                Cosmos DB-backed DailyEntry persistence (per-user partitioned)
    recentClues.ts          recent-clue lookup for the scoring repeat penalty
    dayPreview.ts           signals+scoring pipeline, used internally by seed-demo only (no longer HTTP-exposed)
    fallbacks.ts            category-based fallback questions
    httpHelpers.ts          small JSON response helpers
  functions/                one file per HTTP-triggered Azure Function (see API below)
```

## API

All routes are under `/api` and require a function key (`?code=...` or
`x-functions-key` header) except `/api/health`.

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness + whether Azure OpenAI is configured |
| `/api/profiles` | GET | The 3 demo `DailyContext` profiles — reference data; mirror it on-device, don't fetch it live in production |
| `/api/clues` | GET | The full clue library — same: reference data, mirror on-device |
| `/api/follow-up-question` | POST | `{ clue, context, interpretedSignals, previousMeaning? }` → schema-validated `FollowUpQuestion` (Azure OpenAI call with fallback) |
| `/api/day/complete` | POST | `{ date, context, interpretedSignals, displayedClueIds, selectedClues }` → generates the summary and saves a `DailyEntry` |
| `/api/day/reflection` | POST | `{ context, interpretedSignals, moments: [{clueId, clueTitle, text}] }` → `{ reflection }`, a warm 3–5 sentence narrative built only from free-text moments (no multiple-choice `answerOption` needed). `context`/`interpretedSignals` are accepted for request consistency but not sent to the AI — only the user-confirmed moments are, per the minimum-necessary-data rule. If a moment's text mentions immediate danger/self-harm/harm to others (checked by a pre-AI-call phrase scan), the standard reflection is skipped and `reflection` is a fixed message pointing to the 988 Suicide & Crisis Lifeline instead. Additive alongside `/api/day/complete` — doesn't touch `generatedSummary` or persistence. |
| `/api/day/reflection/refine` | POST | `{ originalReflection, moments, steeringText }` → `{ reflection }`, regenerated to match the user's own steering note ("make it sound more like you") without inventing new facts. Falls back to `originalReflection` unchanged if the AI call fails, so "restore original" always has something coherent. |
| `/api/entries?userId=` | GET | All saved `DailyEntry` records for a user |
| `/api/patterns?userId=&clueA=&clueB=` | GET | Co-occurrence + associative-language text for two clues (for a user) |
| `/api/seed-demo` | POST | Runs all 3 demo profiles end-to-end and saves them (useful before calling `/api/patterns`) |
| `/api/week/insights` | POST | `{ days: WeeklyDay[] }` (up to 7 days of sleep/movement/weather/calendar + reflection content) → `{ patternWorthNoticing, whatMayBeHelping, themes }`. One Azure OpenAI call, schema-forced via tool-calling like `/api/follow-up-question`. The passive-context timeline and reflection-completion stats shown alongside this are calculated client-side directly from the same dataset — this endpoint only produces the three AI-generated sections. Quotes in `themes` are server-verified as exact substrings of the submitted `reflection.finalText` values; unmatched quotes are dropped. Falls back to a static "not enough data" response (same shape, `confidence: "low"`) if Azure OpenAI isn't configured, times out, or returns something that fails validation. |

## On-device logic (not a backend call)

Before any of the endpoints above get involved, the phone already has
everything it needs to turn passive data into the scene: the day's
`DailyContext` and the clue catalog. Port these two pure functions from
`src/lib/signals.ts` and `src/lib/scoring.ts` — they take plain data in and
return plain data out, no I/O, so they translate directly to any language:

- **`interpretSignals(context)`** — a handful of threshold checks (e.g.
  `sleepHours < 6.5` → tag `short_sleep`) that turn raw numbers into semantic
  tags. Never produces a psychological label, only observational tags.
- **`scoreClue(clue, signals, recentClueIds)`** and
  **`selectDisplayClues(...)`** — scores every clue in the catalog against
  the day's signals, then picks the displayed set (aiming for ~4
  signal-informed + 3 possible-explanation + 2 helpful + several neutral
  distractors).

Both need the same clue catalog as input — `src/data/clues.json` is the
canonical copy; bundle an equivalent list on-device (this is exactly what
the Flutter build earlier in this project did: `signal_engine.dart` +
`scoring_engine.dart` + a local `clue_catalog.dart`, ported line-for-line).

`GET /api/clues` and `GET /api/profiles` still exist and are handy for
pulling that canonical data during development, but nothing in the live app
should call them at runtime — they're reference/testing endpoints, not part
of the real request flow.

## Typical usage flow

The endpoints are steps in one sequence, not independent calls. Set these
once:

```bash
BASE="https://<your-function-app>.azurewebsites.net/api"
CODE=$(az functionapp keys list --name <your-function-app> --resource-group <your-resource-group> --query "functionKeys.default" -o tsv)
```

**1. Pick a day** — either a demo profile or the real passive-data context —
and compute signals + the ranked clue list **on-device**, using the ported
`interpretSignals`/`selectDisplayClues` logic (see "On-device logic" above).
No backend call happens here at all.

**2. The user picks up to 3 clues.** For each one picked, ask for its
follow-up question — pass the *full* clue object (from `/api/clues` or your
own copy), the same `context`, and the `interpretedSignals` from step 1:

```bash
curl -s -X POST "$BASE/follow-up-question?code=$CODE" -H 'Content-Type: application/json' \
  -d '{"clue": {...}, "context": {...}, "interpretedSignals": [...]}'
```
Returns `{ question, options, purpose, safetyCheck }`. Show the options as
buttons; capture which one the user picks (or "skip").

**3. Finish the day** — send every clue the user selected, each paired with
the question/answer from step 2:

```bash
curl -s -X POST "$BASE/day/complete?code=$CODE" -H 'Content-Type: application/json' -d '{
  "date": "2026-07-27",
  "context": {...},
  "interpretedSignals": [...],
  "displayedClueIds": ["quiet_corner_01", "..."],
  "selectedClues": [
    {"clueId":"quiet_corner_01","selectedAt":"2026-07-27T12:00:00Z","dailyContextDate":"2026-07-27",
     "userMeaning":"Felt restful","followUpQuestion":"...","answerOption":"Felt restful","confidence":"clear"}
  ]
}'
```
Saves a `DailyEntry` and returns it with `generatedSummary` filled in
(confirmed-info-only, no causal language). `selectedClues` can be `[]` —
that's a valid, saved day.

**Alternative to steps 2–3 — free-text moments + a whole-day reflection**
instead of per-clue multiple choice: skip `/follow-up-question` entirely,
capture a free-text string per clue tap client-side, then call
`/day/reflection` once with all of them to get one narrative paragraph. Let
the user edit it via `/day/reflection/refine` (pass a `steeringText` like
"make it sound more like you"); "restore original" just means re-showing the
first reflection text you got back, no extra call needed. Persist the final
entry through `/day/complete` as before, putting each moment's free text in
that clue's `answerOption`.

**4. Look for patterns across saved days**, once more than one entry exists:

```bash
curl -s "$BASE/patterns?code=$CODE&clueA=still_legs_01&clueB=quiet_corner_01"
```

**Shortcuts for testing without a real frontend**: `GET /api/profiles` and
`GET /api/clues` give you the exact objects to paste into the calls above;
`POST /api/seed-demo` runs the full pipeline (on-device steps included,
computed server-side just for this convenience endpoint) for all three demo
profiles automatically (using real AI calls) so `/api/patterns` has
something to read immediately.

## Local development

Requires the [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) (`func`) and a storage emulator ([Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)).

```bash
npm install
cp local.settings.json.example local.settings.json
# edit local.settings.json: fill in AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY,
# or leave them blank to exercise the fallback question/summary paths only

npx azurite --silent &     # local blob storage emulator
npm run build
func start
```

The app runs at `http://localhost:7071/api/...`; local runs don't enforce
function keys.

## Deploying to Azure

Two deployment scripts are provided. Both provision everything from scratch
and deploy the code in one run.

### `deploy-dev.sh` — Development / hackathon (near-zero cost)

Consumption plan, public endpoints, Cosmos DB with free tier. No VNet, no
private endpoints, no App Gateway. Suitable for demos and development.

### `deploy-production.sh` — HIPAA-compliant architecture

> **WARNING: The production deployment costs approximately $470/month.**
>
> - Elastic Premium EP1 Function App: ~$220/mo
> - Application Gateway WAF v2: ~$250/mo
> - Cosmos DB (400 RU/s): ~$25/mo (free tier not used in production)
> - Private endpoints + DNS zones: negligible
>
> **Do not run this script unless you understand the cost implications.**
> Use `deploy-dev.sh` for development and demos.

Production architecture:
- **VNet** with 3 subnets (gateway, function app, private endpoints)
- **Application Gateway with WAF v2** — the only public entry point,
  OWASP 3.2 ruleset
- **Function App** — VNet-integrated, not publicly accessible, traffic
  restricted to the App Gateway subnet only
- **Cosmos DB** — private endpoint, public access disabled
- **Key Vault** — private endpoint, public access disabled
- **Storage Account** — private endpoint, public access disabled

> **Note on HIPAA compliance**: Infrastructure alone does not make you
> HIPAA-compliant. You also need: a signed Business Associate Agreement
> (BAA) with Microsoft, per-user authentication (OAuth/JWT — not yet
> implemented), formal audit logging of PHI access, and a documented data
> handling policy. This architecture provides the network isolation and
> data partitioning foundation those requirements build on.

### Running either script

```bash
# 1. edit the variables at the top of the script
# 2. log in and pick the right subscription
az login
az account set --subscription "<subscription-name-or-id>"

# 3. run it
bash deploy-dev.sh          # or deploy-production.sh
```

The script prints the base URL and a function key at the end. If your
subscription doesn't have Azure OpenAI access yet, `az cognitiveservices
account create --kind OpenAI` will fail with an access/registration error —
request access at https://aka.ms/oai/access first.

**Two gotchas found the hard way while testing this script**, worth knowing
before you assume the defaults are still current (both drift as Microsoft
ships changes — re-verify rather than trusting this note indefinitely):

- **Node runtime version**: `az functionapp list-runtimes --os linux` may list
  a newer Node version (e.g. 24) than the Functions language worker actually
  runs reliably — in testing, Node 24 left the host permanently returning
  `ServiceUnavailable` with no functions loaded, while Node 22 (Active LTS)
  worked immediately. `deploy.sh` defaults to 22; if you bump it, verify with
  `curl https://<app>.azurewebsites.net/api/health` before assuming it's fine.
- **`gpt-5-mini` (and other reasoning-family models) need
  `max_completion_tokens`, not `max_tokens`**, and by default spend their
  *entire* token budget on hidden reasoning tokens before producing any
  visible output — with `reasoning_effort` unset or `"low"`, both
  `followUpEngine.ts` and `summaryEngine.ts` got back empty content and fell
  back to the fixed fallback question/summary every time, even though the
  Azure OpenAI call itself "succeeded". Both files set
  `reasoning_effort: "minimal"` to fix this (cast around the installed SDK's
  stale `ReasoningEffort` type, which doesn't list `"minimal"` yet). If you
  swap in a different model, check whether it has the same behavior.

**Redeploying code after the first run** (no need to recreate resources).
Order matters here: `npm run build` needs the TypeScript compiler, which is a
devDependency — pruning dev deps *before* building leaves `tsc` missing and
silently ships a stale/empty `dist/`. Build first, prune after:

```bash
npm install && npm run build
npm prune --omit=dev
rm -f release.zip
zip -rq release.zip dist host.json package.json package-lock.json node_modules -x '*.map'
az functionapp deployment source config-zip \
  --name <FUNCTION_APP> --resource-group <RESOURCE_GROUP> --src release.zip
npm install   # restore dev deps locally
```

**Tearing everything down**: `bash teardown.sh` — prompts you to pick the
resource group (dev or production) and deletes it after typed confirmation.
Production teardowns can take 5–10 minutes because the App Gateway
deprovisions slowly.

## Privacy & safety notes carried into the code

- Every place a `DailyContext` is returned or logged is paired with:
  "Simulated passive context for prototype demonstration."
- Raw calendar content (titles, attendees) is never modeled or stored — only
  `calendarEventCount` / `calendarLoad`.
- `followUpEngine.ts` sends Azure OpenAI only `clue`, `context` (calendar
  load + weather only), `interpretedSignals`, and `previousMeaning` — never
  full calendar data, names, or exact location.
- The Azure OpenAI key is read only from `process.env.AZURE_OPENAI_API_KEY`
  in `azureOpenAIClient.ts`, which in Azure resolves from a Key Vault
  reference — it's never in client-facing code or a response body.
- Safety validation in `followUpEngine.ts` rejects and falls back on:
  malformed/off-schema responses, wrong option count, an unprompted
  mental-health term, or diagnostic/causal phrasing.
- `textSafety.ts`'s phrase matching uses word boundaries, not plain substring
  search — a naive `.includes("you have")` also matches inside "you
  **haven't**", which was silently triggering the fallback on ordinary
  generated text containing that contraction. All three AI-text engines
  (`followUpEngine.ts`, `summaryEngine.ts`, `reflectionEngine.ts`) share this
  one matcher now specifically so this can't drift out of sync again.
