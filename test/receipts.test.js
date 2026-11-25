import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReceipt, verifyReceipt, verifyChain, canonicalJson, GENESIS_HASH } from '../src/receipts.js';
import { buildHeuristicReport } from '../src/analyze.js';
import { SAMPLE_SCAM, SAMPLE_RENTAL } from './samples.js';

const stages = [
  { stage: 'quick_screen', requestedRoute: 'prefer_on_device', inferenceSource: 'ON_DEVICE' },
  { stage: 'deep_check', requestedRoute: 'cloud', inferenceSource: 'IN_CLOUD' },
];

async function mint(text, category, prevHash, minute) {
  return createReceipt({
    inputText: text,
    category,
    stages,
    report: buildHeuristicReport(text, category),
    prevHash,
    now: new Date(`2026-11-25T10:0${minute}:00.000Z`),
  });
}

test('canonicalJson is key-order independent', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 1 }));
});

test('a fresh receipt verifies, and its hash covers the report', async () => {
  const r = await mint(SAMPLE_SCAM, 'Investment / crypto pitch', undefined, 1);
  assert.equal(r.prevHash, GENESIS_HASH);
  const v = await verifyReceipt(r);
  assert.ok(v.ok, v.errors.join('; '));
});

test('tampering with the report breaks verification', async () => {
  const r = await mint(SAMPLE_SCAM, 'Investment / crypto pitch', undefined, 2);
  const tampered = structuredClone(r);
  tampered.report.riskScore = 0;
  tampered.report.verdict = 'likely_ok';
  const v = await verifyReceipt(tampered);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('reportHash')));
});

test('tampering with a stage inference source breaks verification', async () => {
  const r = await mint(SAMPLE_SCAM, 'Investment / crypto pitch', undefined, 3);
  const tampered = structuredClone(r);
  tampered.stages[0].inferenceSource = 'IN_CLOUD';
  const v = await verifyReceipt(tampered);
  assert.equal(v.ok, false);
});

test('a chain of receipts verifies; deleting or reordering breaks it', async () => {
  const r1 = await mint(SAMPLE_SCAM, 'Investment / crypto pitch', undefined, 4);
  const r2 = await mint(SAMPLE_RENTAL, 'Rental / housing ad', r1.hash, 5);
  const r3 = await mint(SAMPLE_SCAM, 'Other', r2.hash, 6);
  const ok = await verifyChain([r1, r2, r3]);
  assert.ok(ok.ok, ok.errors.join('; '));
  assert.equal(ok.count, 3);

  const deleted = await verifyChain([r1, r3]);
  assert.equal(deleted.ok, false);

  const reordered = await verifyChain([r2, r1, r3]);
  assert.equal(reordered.ok, false);
});
