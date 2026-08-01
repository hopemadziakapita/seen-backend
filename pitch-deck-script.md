# Seen — Pitch Script: "What Happens When You Tap"

*A narration script for the technical/architecture portion of the pitch. Built to be read aloud over an animated diagram or live screen recording — cues in brackets tell you what should be on screen at that moment.*

---

## Cold open — the hook

> "Every health app on your phone already knows you slept five hours, walked
> 2,000 steps, and had six back-to-back meetings today. None of them know
> *why* that mattered to you. Seen is the first layer that asks."

**[Screen: phone home screen, then Seen opens to the illustrated bedroom scene]**

---

## Act 1 — The moment you tap something

> "This isn't a form. It's a room. Somewhere in it is a coffee mug, a
> laptop, a pair of shoes — and by the time you've even opened the scene,
> the app has already quietly asked itself a question for every single
> object in it."

**[Screen: scene loads, camera pulls back to show a diagram — the phone silently firing off parallel requests to a cloud icon the instant the scene renders, before any tap happens]**

> "That's the trick behind the 'instant' feel. We don't wait for you to tap
> and *then* go ask an AI what to say — every object's follow-up question is
> pre-fetched in parallel the moment the scene loads. By the time your
> finger lands on the mug, the question is already sitting in memory. Tap
> feels instant because, technically, it already happened."

**[Screen: user taps the mug → question appears with zero visible delay]**

---

## Act 2 — What actually leaves the phone

> "Here's the part most apps get wrong: they ship your entire life to the
> cloud and let the model figure out what's relevant. We do the opposite.
> We decide *before* anything leaves the device."

**[Screen: diagram — phone-side data (sleep, steps, calendar, weather, location) shown behind a filter wall; only a thin stream crosses to the cloud]**

> "Your phone knows your calendar had six meetings. It knows you slept
> five hours. But none of that crosses the wire unless *you* connect it to
> something yourself — by tapping an object and telling us what it meant.
> The AI never sees raw sleep data, raw calendar entries, or your location.
> It sees exactly three things: which object you tapped, what you typed,
> and — only if your own words already hint at a theme like sleep or
> workload — a small structured signal, never the raw number."

> "We call this keyword-gated context filtering. The passive data is the
> lock; your own words are the key. No key, no data crosses."

---

## Act 3 — Inside the cloud, for half a second

> "Once your words do cross, they land in an Azure Functions endpoint that
> talks to Azure OpenAI — but not in free conversation. We force the model
> into a structured tool call: it can *only* respond in a fixed JSON shape
> — a question, three or four options, a stated purpose. No open-ended
> text generation for the sensitive path. No room for the model to freelance
> into something we didn't design for."

**[Screen: JSON schema flashing briefly — question / options / purpose — then a checkmark]**

> "Then, before that response ever reaches your phone, it passes through a
> safety layer that scans for exactly two failure modes: causal language —
> 'this caused,' 'led to,' 'made you feel' — and diagnostic language —
> 'you have,' 'disorder,' 'clinical.' If either shows up, we throw the
> response away and use a hand-written fallback question instead. The model
> never gets the final word on anything that sounds clinical."

---

## Act 4 — The line we never let it cross

> "There's one more layer that runs before any of this — before the AI is
> even called. If anything you typed contains crisis language — phrases
> around self-harm or suicide — we intercept it immediately, skip the AI
> entirely, and show crisis-line resources instead. That check runs first,
> every time, with zero dependency on the model behaving correctly. It's
> not a prompt instruction we're hoping the model follows — it's a plain
> string match that happens before the network call is even made."

**[Screen: a red gate icon in the pipeline, positioned upstream of the AI call]**

---

## Act 5 — What happens when the internet doesn't

> "And if the network drops, the API key expires, the model times out —
> none of that breaks the experience. Every AI call has a local,
> deterministic fallback: a hand-written question for that exact object, a
> safe generic reflection, a static pattern summary. The demo — and the
> product — never shows an error screen. It just quietly gets a little less
> personalized and keeps going."

---

## Closing line — landing the theme

> "So the pitch isn't 'we added AI to a health app.' It's: we built a
> filter first, and only let a model see what earned its way through it.
> Fast because we prefetch. Private because we filter before we send.
> Safe because a human wrote the rules the model has to obey, not the other
> way around."

**[Screen: fade to logo]**

---

## Appendix — Security & Privacy, for Q&A

*Use this section if judges ask "how do you handle sensitive health data?" — pull specific lines from here rather than answering in generalities.*

**What's genuinely solid today:**

- **Minimum-necessary data to the model.** The AI never receives raw sleep hours, step counts, exact calendar text, or precise location — only category-level signals (`calendarLoad`, `weather`) and whatever the user typed themselves. This is enforced in code (`followUpEngine.ts`), not just prompted.
- **Keyword-gated passive-context filtering.** Passive signals are stripped from the request entirely unless the user's own reflection text already contains a matching theme keyword — the model can't go fishing for a "cause" in your health data that you didn't yourself connect.
- **Forced structured output.** The model can't free-write for the follow-up-question path — it must call a function with a fixed JSON schema (question, options, purpose). This closes off prompt-injection-style attempts to make the model say something arbitrary.
- **Post-generation safety filter.** Every AI response — follow-up questions, reflections, weekly insights — is scanned for causal and diagnostic language *after* generation and discarded (falling back to a safe static response) if it fails. Defense in depth: the prompt says not to diagnose, and the output is checked as if it will anyway.
- **Crisis-language pre-check runs before any AI call**, using a plain-string phrase match — no dependency on the model's own judgment, no network round trip in the critical path, immediate crisis-resources response.
- **Secrets never touch app code or config.** The Azure OpenAI key lives in Key Vault; the Function App reads it via a Key Vault reference resolved by its own managed identity at runtime. The key is never in `local.settings.json`, never in a deployment log, never in source control.
- **Offline-first fallback everywhere.** Every AI-backed feature has a local, deterministic equivalent, so a backend outage degrades gracefully to less-personalized static content instead of failing or falling back to some *other* unreviewed code path.

**What's intentionally out of scope for a hackathon build — say this proactively, don't wait to be asked:**

- **Single shared function key, no per-user auth.** Every client currently calls the API with one static function-level key (`authLevel: "function"`). There's no per-user identity, no OAuth, no rate limiting per user. Fine for a prototype demo; the first thing to fix before any real user's data touches this backend.
- **Single shared JSON blob for all entries.** `DailyEntry` records currently write to one shared blob (`entries.json`) with no per-user partitioning or encryption-at-rest beyond Azure Storage's default. A production version needs per-user containers or a real database with row-level access control.
- **No consent/audit trail yet.** There's no logged record of what data reached the model for which user, no user-facing data-deletion flow, and no explicit consent screen distinguishing "stored locally" from "sent to the AI." All necessary for anything beyond a demo.
- **Client-side trust boundary.** The keyword-gating and PII stripping happens correctly in code today, but a modified client could in principle send more than the intended contract — the backend doesn't currently re-validate that a request's `possibleMeanings`/context match what the UI is supposed to allow. Worth a server-side schema/allowlist check before wider release.

**How to say it in the room:** lead with what's solid (the filter-first architecture is a genuine, unusual design choice worth being proud of), then volunteer the gaps unprompted — it reads as engineering maturity, not a weakness, when you name your own biggest open risk before a judge does.
