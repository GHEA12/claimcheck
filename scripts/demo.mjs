// ClaimCheck — scripted end-to-end demo (no credentials needed).
//
// Runs the real product flow (src/flow.js) against the deterministic mock
// model with SIMULATED routing labels, for three sample texts, then
// verifies every receipt and the whole chain, then demonstrates tamper
// detection. This is a simulation of the live Firebase flow — in the live
// app the same flow runs against Firebase AI Logic and the receipts carry
// the real inferenceSource of each stage.
//
// Usage: npm run demo

import { runCheck } from '../src/flow.js';
import { createMockClient } from '../src/mock-ai.js';
import { MemoryStore } from '../src/store.js';
import { verifyChain, verifyReceipt, shortHash } from '../src/receipts.js';
import { SAMPLE_SCAM, SAMPLE_RENTAL, SAMPLE_JOB } from '../test/samples.js';

const CASES = [
  { name: 'Crypto doubling DM', category: 'Investment / crypto pitch', text: SAMPLE_SCAM },
  { name: 'Jakarta rental ad', category: 'Rental / housing ad', text: SAMPLE_RENTAL },
  { name: 'Work-from-home job offer', category: 'Job offer', text: SAMPLE_JOB },
];

const store = new MemoryStore();
const client = createMockClient({ labelSources: 'simulated' });

console.log('=== ClaimCheck scripted demo (mock model, simulated routing) ===\n');

for (const c of CASES) {
  const { quick, route, report, receipt } = await runCheck({ client, store, text: c.text, category: c.category });
  console.log(`--- ${c.name} [${c.category}]`);
  console.log(`Quick Screen : ${quick.verdict} · risk ${quick.riskScore}/100 · ran ${receipt.stages[0].inferenceSource}`);
  console.log(`Route        : deep check -> ${route.route} (${route.reason})`);
  console.log(`Deep Check   : ${report.verdict} · risk ${report.riskScore}/100 · ran ${receipt.stages[1].inferenceSource}`);
  console.log(`Red flags    : ${report.redFlags.map((f) => `${f.title} [sev ${f.severity}, ${f.source}]`).join(' | ') || 'none'}`);
  console.log(`Positives    : ${report.positives.join(' | ') || 'none'}`);
  console.log(`Missing      : ${report.missingInfo.join(' | ') || 'none'}`);
  console.log(`Receipt      : ${receipt.id} · hash ${shortHash(receipt.hash)} · prev ${shortHash(receipt.prevHash)}`);
  const v = await verifyReceipt(receipt);
  console.log(`Verify       : ${v.ok ? 'OK' : 'FAILED ' + v.errors.join('; ')}`);
  console.log('');
}

const items = await store.list();
const chain = await verifyChain(items);
console.log(`Chain        : ${chain.count} receipts · ${chain.ok ? 'OK — all hashes and links intact' : 'FAILED ' + chain.errors.join('; ')}`);

// Tamper demonstration: rewrite history and show it fails.
const tampered = structuredClone(items[0]);
tampered.report.riskScore = 0;
tampered.report.verdict = 'likely_ok';
const tv = await verifyReceipt(tampered);
console.log(`Tamper test  : edited receipt ${tampered.id} (risk 100 -> 0) · verify ${tv.ok ? 'OK (BAD!)' : 'FAILED as expected — ' + tv.errors[0]}`);

if (!chain.ok || tv.ok) {
  console.error('\nDEMO FAILED');
  process.exit(1);
}
console.log('\n=== Demo complete: flow, routing, receipts, chain, and tamper detection all proven ===');
