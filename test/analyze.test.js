import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  heuristicScan,
  buildHeuristicReport,
  parseModelJson,
  validateQuick,
  validateReport,
  mergeCrossCheck,
  decideDeepRoute,
} from '../src/analyze.js';
import { SAMPLE_SCAM, SAMPLE_RENTAL, SAMPLE_JOB } from './samples.js';

test('heuristic scan flags the crypto doubling scam hard', () => {
  const scan = heuristicScan(SAMPLE_SCAM);
  const ids = scan.flags.map((f) => f.id);
  assert.ok(ids.includes('guaranteed-profit'));
  assert.ok(ids.includes('money-doubling'));
  assert.ok(ids.includes('gift-card-payment'));
  assert.ok(ids.includes('off-platform-contact'));
  assert.ok(scan.score >= 70, `score was ${scan.score}`);
});

test('heuristic scan leaves a normal rental listing clean', () => {
  const scan = heuristicScan(SAMPLE_RENTAL);
  assert.equal(scan.flags.length, 0);
  assert.equal(scan.score, 0);
});

test('heuristic report verdicts track the samples', () => {
  assert.equal(buildHeuristicReport(SAMPLE_SCAM, 'Investment / crypto pitch').verdict, 'high_risk');
  assert.equal(buildHeuristicReport(SAMPLE_RENTAL, 'Rental / housing ad').verdict, 'likely_ok');
  const job = buildHeuristicReport(SAMPLE_JOB, 'Job offer');
  assert.ok(job.riskScore >= 30, `job score was ${job.riskScore}`);
  assert.ok(job.redFlags.some((f) => f.id === 'credential-request' || f.id === 'advance-fee'));
});

test('every red flag carries a verbatim evidence quote from the input', () => {
  const report = buildHeuristicReport(SAMPLE_SCAM, 'Other');
  for (const f of report.redFlags) {
    assert.ok(f.evidence.length > 0);
    assert.ok(SAMPLE_SCAM.replace(/\s+/g, ' ').includes(f.evidence.replace(/\.\.\.$/, '')), `evidence not in input: ${f.evidence}`);
  }
});

test('parseModelJson tolerates markdown fences and surrounding prose', () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Here is the result: {"a":2} hope that helps'), { a: 2 });
  assert.equal(parseModelJson('no json here'), null);
  assert.equal(parseModelJson(''), null);
});

test('validateQuick / validateReport clamp and coerce', () => {
  const q = validateQuick({ verdict: 'nonsense', riskScore: 250, topFlags: ['a', 5, 'b'], summary: 's' });
  assert.equal(q.riskScore, 100);
  assert.equal(q.verdict, 'high_risk');
  assert.deepEqual(q.topFlags, ['a', 'b']);
  const r = validateReport({ riskScore: -4, redFlags: [{ title: 'T', evidence: 'E', severity: 9 }, { noTitle: true }] }, 'Job offer');
  assert.equal(r.riskScore, 0);
  assert.equal(r.verdict, 'likely_ok');
  assert.equal(r.redFlags.length, 1);
  assert.equal(r.redFlags[0].severity, 1);
  assert.equal(r.category, 'Job offer');
  assert.equal(validateReport(null), null);
  assert.equal(validateQuick(undefined), null);
});

test('mergeCrossCheck appends missed scam flags and can only raise the score', () => {
  const weakModelReport = {
    verdict: 'likely_ok',
    riskScore: 5,
    category: 'Other',
    summary: 'looks fine',
    redFlags: [],
    positives: [],
    missingInfo: [],
    questionsToAsk: [],
  };
  const merged = mergeCrossCheck(weakModelReport, SAMPLE_SCAM);
  assert.ok(merged.redFlags.length >= 3);
  assert.ok(merged.redFlags.every((f) => f.source === 'cross-check'));
  assert.ok(merged.riskScore >= 70);
  assert.equal(merged.verdict, 'high_risk');
});

test('routing: long input and high-risk quick screens go to cloud, short calm ones stay on device', () => {
  const longText = 'x'.repeat(4500);
  assert.equal(decideDeepRoute({ text: longText, quick: { riskScore: 0 } }).route, 'cloud');
  assert.equal(decideDeepRoute({ text: 'short', quick: { riskScore: 80 } }).route, 'cloud');
  assert.equal(decideDeepRoute({ text: 'short', quick: { riskScore: 10 } }).route, 'on_device');
});
