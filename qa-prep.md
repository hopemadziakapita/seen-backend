# Seen — Anticipated Q&A

*Organized by category, roughly in order of how likely each is to come up. Each answer is grounded in what's actually built — no hand-waving further than the codebase currently supports.*

---

## 1. "Is this just another mental health app?" (positioning)

**Q: How is this different from Daylio, Reflectly, or a mood-tracking app?**
A: Those ask you to self-report a mood on a scale and then chart it. We never ask "how do you feel, 1-10." We surface a *scene* built from your actual day — objects that represent what genuinely happened (a packed calendar, poor sleep, low movement) — and ask you to attach meaning to *specific moments*, not a mood score. The output is a narrative grounded in things you actually did, not a number you guessed at.

**Q: Is this a diagnostic or clinical tool?**
A: No, explicitly not. Every AI prompt is instructed never to diagnose or suggest a clinical conclusion, and there's a second-pass filter that strips any response containing diagnostic language ("you have," "disorder," "clinical") even if the model tries. This is a self-reflection and pattern-awareness tool, not a screening instrument.

**Q: Who is the user — general wellness, or something more targeted?**
A: *(Answer based on your actual target market — this is a product decision, not a technical one. Have a one-sentence answer ready: e.g. "young professionals experiencing everyday overwhelm" or whatever your actual thesis is.)*

---

## 2. AI behavior & safety

**Q: What stops the AI from hallucinating a cause for how someone feels?**
A: Two layers. First, the prompt itself forbids causal language ("caused," "led to," "because of"). Second — and more importantly — we don't trust the prompt alone: every AI response is scanned afterward for causal/diagnostic phrases with a hard-coded phrase list, and if any slip through, we discard the whole response and use a hand-written fallback instead. The model doesn't get the final word on anything that sounds clinical.

**Q: What happens if someone writes something indicating self-harm or crisis?**
A: That's checked *before* any AI call happens — a plain-string scan for crisis phrases ("kill myself," "suicid," "self-harm," etc.) runs first. If it matches, we skip the model entirely and immediately return crisis-line resources (988 Suicide & Crisis Lifeline). This doesn't depend on the model behaving correctly — it's a deterministic gate upstream of the AI, not a prompt instruction we're hoping it follows.

**Q: Could someone bypass that with phrasing your keyword list doesn't catch?**
A: Yes, honestly — it's a narrow, literal pre-check, not a clinical screening tool, and we say that in our own code comments. False negatives fall through to the model's own safety instructions as a second line of defense. This is a real limitation to name proactively: a production version would need a more robust classifier, not a fixed phrase list.

**Q: Why not just use a general-purpose chatbot (ChatGPT, etc.) instead of building this?**
A: A general chatbot has no structure — it'll happily free-write anything, including diagnosis-flavored language, causal claims, or answers based on data it was never given. We deliberately constrain the model with forced structured output (it can only return a fixed JSON shape — question, options, purpose) and a minimum-necessary-data policy, so there's no surface for it to improvise on. That constraint is the product, not a limitation.

**Q: What model are you using, and why that one?**
A: Azure OpenAI's `gpt-5-mini`. Chosen for cost/latency at this data volume — each call is small (one clue, a few signals, short output) so a larger reasoning model would add cost without adding value here.

---

## 3. Data & privacy

**Q: What data do you actually collect from my phone?**
A: Sleep and step count (via Apple HealthKit / Android Health Connect), calendar event count and load (via `device_calendar`), and approximate weather (via location + a free weather API). All of it stays on-device by default.

**Q: Does any of that raw data get sent to the AI?**
A: No — this is the core design decision. The AI never receives raw sleep hours, exact step counts, or your calendar's actual text. It only receives category-level signals (e.g. "calendar load: high") and, critically, only what *you* typed yourself when you tapped an object. We call it keyword-gated filtering: your own words are the key that unlocks a related passive-data signal being included; without that key, the data simply never leaves the device.

**Q: Where is my data stored, and is it encrypted?**
A: Completed daily entries are stored in Azure Blob Storage, encrypted at rest by Azure's platform-level default. Right now — and this is a real gap I'll name rather than dodge — all users' entries currently write to a single shared blob file, with no per-user partitioning. That's acceptable for a prototype with a handful of test users; it is the first thing that needs to change before this handles real users' data.

**Q: Is there a way for me to delete my data?**
A: Not yet, and that's a known gap for a production version — no user-facing deletion flow currently exists. Worth stating plainly if asked rather than implying otherwise.

**Q: How do you handle the API keys / secrets?**
A: The Azure OpenAI key lives in Azure Key Vault. The Function App has no copy of it in its own configuration — it holds a Key Vault *reference* that Azure resolves at runtime using the app's managed identity. The key is never in source control, never in a deployment artifact, never visible in logs.

**Q: Is the backend API itself secured?**
A: Every endpoint requires a function-level key, so it's not open to the internet — but today it's one static key shared by every client, not per-user authentication. There's no rate limiting per user either. Again, fine for a hackathon demo; not production-ready as-is, and we know that.

---

## 4. Accuracy & reliability of underlying data

**Q: How accurate is the passive data — what if HealthKit/Health Connect gives bad numbers?**
A: We treat passive data as directional, not precise — it feeds a three-level classification (Recovery / Activation / Load: low/medium/high) rather than being displayed or reasoned about as an exact number. A day doesn't need perfectly accurate step counts to correctly land in "high activation" vs "low."

**Q: What if a permission is denied — calendar, health, location?**
A: Each source degrades independently and falls back to a sensible default rather than blocking the app. Sleep/steps fall back to a demo value; if location is denied, weather falls back similarly. The app never hard-fails because one permission was declined.

**Q: What happens if the backend or the AI is completely down?**
A: Every AI-backed feature has a local, deterministic fallback computed entirely on-device — a hand-written question for that specific object, a safe generic reflection, a static pattern summary. There's no error screen; the experience just becomes less personalized and keeps going. This was a deliberate design principle from day one, not an afterthought.

---

## 5. Scale & engineering maturity

**Q: What happens with 10,000 users instead of 10?**
A: Two things would need to change first: (1) the single shared blob becomes a real per-user data store — a database with row-level access control, not a shared JSON file; (2) the single static function key becomes per-user authentication with rate limiting. Both are known, scoped gaps, not surprises — we didn't build multi-tenant infrastructure for a hackathon prototype, and said so upfront.

**Q: What's your actual infrastructure cost at scale?**
A: *(Have real numbers ready if possible: Azure OpenAI gpt-5-mini pricing per call, Functions Consumption-plan cost model, expected calls/user/day. If you haven't modeled this, say so honestly: "We haven't modeled unit economics yet — next step before scaling past a prototype.")*

**Q: Is the AI response fast enough to actually feel real-time?**
A: We don't make the user wait on it at all for the common path — every object's question is pre-fetched in parallel the instant the scene loads, before any tap happens, so by the time the user taps something the answer is usually already cached. The one thing we can't avoid is the very first AI call after a cold start (Azure Functions Consumption plan can have a few seconds of cold-start latency) — we mitigate that with generous client timeouts and an instant local fallback rather than a spinner.

**Q: Did you build the whole thing during the hackathon, or is some of this scaffolding from before?**
A: *(Be honest and specific to your actual timeline — judges respect precision here more than a blanket "yes, all of it.")*

---

## 6. Product depth / "is there really something here"

**Q: How do you know the weekly patterns/insights are actually meaningful and not just noise from 7 days of data?**
A: We're explicit about confidence — the weekly insights engine only surfaces a "pattern worth noticing" when it's backed by a stated number of supporting days/reflections, and falls back to an honest "not enough data yet" response rather than manufacturing a pattern from thin evidence. Confidence level is a first-class field in the response, not window dressing.

**Q: What stops this from just becoming another app people stop opening after a week?**
A: *(This is a genuine product/retention question, not a technical one — answer with your actual retention thesis: habit loop, notification design, whatever your plan is. Don't let the technical answer stand in for this.)*

**Q: What's the actual "aha" moment for a new user?**
A: *(Same — this is about your product narrative, have your own one-liner ready.)*

---

## 7. The hard/skeptical ones — expect at least one of these

**Q: Isn't there a risk that pattern-matching someone's sleep/calendar/mood creates a self-fulfilling narrative — telling people what to feel rather than reflecting what they actually felt?**
A: This is exactly why we never let the AI state a signal the user didn't personally connect themselves. The passive data can only appear in a reflection if the user's own words already gestured at that theme — the model isn't allowed to introduce "you slept badly so you probably felt X" on its own. The narrative is built from the user's own language, with passive data only ever confirming, never originating, a connection.

**Q: What if the AI is subtly biased in how it frames things — more negative for some phrasing, more positive for others?**
A: We haven't run a formal bias audit — that's a fair gap to name. What we do have is a hard content constraint (forced JSON schema, banned phrase categories) that bounds *what* the model can say, even if we haven't yet measured systematic tone bias in *how* it says it within those bounds. Good next step, not solved today.

**Q: Why should I trust an early-stage team with health-adjacent data over an established health app company?**
A: *(This is a trust/credibility question about your team, not the tech — answer with your actual team background/expertise, or your specific privacy commitments if the team is new. Don't answer this with architecture details; it doesn't land.)*

---

## Fast-reference: things to say *before* you're asked

Volunteering these unprompted reads as engineering maturity, not weakness:
- The single shared data blob and single API key are known prototype-scale shortcuts, not oversights.
- Crisis detection is a literal phrase match today, not a trained classifier — real but narrow.
- There's no user-facing data deletion flow yet.
- We haven't modeled unit economics / infra cost at scale yet *(only say this if true — replace with real numbers if you have them)*.
