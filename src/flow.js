// ClaimCheck — the end-to-end check flow, shared verbatim by the browser
// app, the scripted demo, and the test suites. Given any client with the
// Firebase-AI-Logic-shaped interface ({ quickScreen, deepCheck }) and any
// receipt store, runCheck performs:
//
//   1. Quick Screen  — hybrid model, PREFER_ON_DEVICE
//   2. Routing       — decide whether the deep check belongs on-device or
//                      in the cloud, and say why
//   3. Deep Check    — full structured report from the chosen route
//   4. Cross-check   — deterministic pattern scan merged into the report
//   5. Receipt       — hash-chained receipt written to the store

import {
  buildQuickScreenPrompt,
  buildDeepCheckPrompt,
  buildHeuristicReport,
  parseModelJson,
  validateQuick,
  validateReport,
  mergeCrossCheck,
  decideDeepRoute,
} from './analyze.js';
import { createReceipt } from './receipts.js';

export async function runCheck({ client, store, text, category = 'Other', onQuick = null }) {
  const quickPrompt = buildQuickScreenPrompt(text, category);
  const quickRes = await client.quickScreen(quickPrompt);
  const quick =
    validateQuick(parseModelJson(quickRes.raw)) ||
    (() => {
      const r = buildHeuristicReport(text, category);
      return { verdict: r.verdict, riskScore: r.riskScore, topFlags: r.redFlags.slice(0, 3).map((f) => f.title), summary: r.summary };
    })();

  const route = decideDeepRoute({ text, quick });
  if (onQuick) onQuick({ quick, route });

  const deepPrompt = buildDeepCheckPrompt(text, category, quick);
  const deepRes = await client.deepCheck(deepPrompt, route.route);
  let report = validateReport(parseModelJson(deepRes.raw), category) || buildHeuristicReport(text, category);
  report = mergeCrossCheck(report, text);

  const stages = [
    { stage: 'quick_screen', requestedRoute: 'prefer_on_device', inferenceSource: quickRes.inferenceSource },
    { stage: 'deep_check', requestedRoute: route.route, routeReason: route.reason, inferenceSource: deepRes.inferenceSource },
  ];

  const prev = await store.last();
  const receipt = await createReceipt({
    inputText: text,
    category,
    stages,
    report,
    prevHash: prev ? prev.hash : undefined,
  });
  await store.append(receipt);

  return { quick, route, report, receipt };
}
