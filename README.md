# ClaimCheck

**Trust checks for the texts strangers send you — with a tamper-evident receipt for every verdict.**

Paste a marketplace listing, a rental ad, a job offer, an investment pitch, or a suspicious message. ClaimCheck verifies it in two stages and seals the result into a hash-chained receipt that records *what the AI concluded and where the AI ran*.

Built for **#BuildHybridAI 2026** (Web / Chrome). All AI inference runs through **Firebase AI Logic** — Gemini Nano on-device and Gemini in the cloud — with App Check and Firestore.

## How it works

1. **Quick Screen — on-device first.** Firebase AI Logic with `InferenceMode.PREFER_ON_DEVICE`: Gemini Nano in Chrome answers instantly and privately (nothing leaves the laptop), with a cloud fallback when Nano is unavailable. You get a verdict, a risk score, and the top red flags.
2. **Deep Check — routed by the input.** Short, lower-risk texts are completed on-device; long documents and high-risk quick screens escalate to a cloud Gemini model with a JSON response schema, producing the full memo: red flags **with exact quoted evidence**, positives, missing information, and the questions to ask before paying. A deterministic local cross-check (a pattern bank of known scam signals) is merged into every report, so a model miss cannot hide a known scam phrase.
3. **Receipt — provenance for AI verdicts.** Each check mints a receipt: SHA-256 of the input, SHA-256 of the report, the **inference source of each stage** (`ON_DEVICE` / `IN_CLOUD`, read from the SDK's `response.inferenceSource`), a timestamp, and the previous receipt's hash — a hash chain stored in Firestore. Anyone can re-verify a receipt or the whole chain from the ledger: edit one word of a report afterwards and verification fails.

Why receipts? AI advice is easy to fake with a screenshot. A ClaimCheck receipt lets a seller, a moderator, or a family member confirm the exact report that was produced, unaltered — and whether it was produced privately on-device or in the cloud.

## Run it

No build step. You need any static file server and Chrome 139+ for on-device inference.

```bash
npm run serve        # or: python3 -m http.server 8080
# open http://localhost:8080
```

**Without any configuration the app boots in DEMO MODE** (header badge says so): a deterministic local engine stands in for the models, receipts are stamped `DEMO`, and the ledger lives in localStorage. The full product flow — screen, route, deep check, receipt, ledger, verify — works end to end.

### Go live (Firebase AI Logic)

1. In the [Firebase console](https://console.firebase.google.com), create a project (or use an existing one).
2. Add a **Web app** and copy its config: Project settings → General → Your apps.
3. Enable **AI Logic** (Gemini Developer API backend) and **Firestore Database**.
4. Copy `firebase-config.example.js` to `firebase-config.js` and paste the config values. Reload — the badge switches to **LIVE · Firebase AI Logic**.
5. App Check: add a reCAPTCHA v3 site key as `appCheckSiteKey` in the config, or leave it empty to use the debug provider (register the debug token printed in the browser console under App Check → Manage debug tokens — debug tokens are accepted for this contest).
6. Optional hosting: `firebase deploy` (config included; `firebase-config.js` is excluded from hosting uploads and stays local — for a public hosted build, paste the web config into a hosted copy; Firebase web configs are not secret keys, but keep real project identifiers out of public repos you do not control).

## Tests & scripted demo

```bash
npm test     # 18 tests: analysis engine, parsing/validation, routing,
             # receipt hashing + hash chain + tamper detection, full mock flow
npm run demo # scripted end-to-end run over 3 samples with simulated
             # routing: reports, receipts, chain verification, tamper test
```

## Project layout

```
index.html            the app (single page, ES modules, import map for the Firebase SDK)
styles.css
src/
  config.js           loads firebase-config.js if present; otherwise demo mode
  ai.js               Firebase AI Logic client (getAI, GoogleAIBackend,
                      InferenceMode.PREFER_ON_DEVICE / PREFER_IN_CLOUD, App Check, anon auth)
  mock-ai.js          deterministic model with the same interface (demo mode + tests)
  analyze.js          prompts, output parsing/validation, heuristic cross-check, routing
  flow.js             the end-to-end check flow shared by app, demo, and tests
  receipts.js         canonical JSON + SHA-256 receipts, hash chain, verification
  store.js            receipt stores: in-memory, localStorage
  store-firestore.js  Firestore receipt store (live mode)
  app.js              UI wiring
test/                 node:test suites + shared samples
scripts/              demo.mjs (scripted proof), serve.mjs (zero-dependency static server)
firestore.rules       public-read, authenticated-create, immutable receipts
```

## Notes for judges

- The Firebase AI Logic usage is real runtime code, not a README claim: see `src/ai.js` (`getAI`, `getGenerativeModel` with `InferenceMode`, `response.inferenceSource`).
- The app is fully usable in demo mode with zero setup; live mode is one config file away and is what the demo video shows.
- No API keys or secrets are in this repository. `firebase-config.js` is gitignored.

## License

Apache-2.0 — see [LICENSE](LICENSE). Copyright 2026 Indra Dwi Junianto.
