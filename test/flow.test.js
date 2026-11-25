import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from '../src/flow.js';
import { createMockClient, MockGenerativeModel } from '../src/mock-ai.js';
import { MemoryStore } from '../src/store.js';
import { verifyChain, verifyReceipt } from '../src/receipts.js';
import { SAMPLE_SCAM, SAMPLE_RENTAL } from './samples.js';

test('mock model simulates hybrid routing honestly', async () => {
  const device = new MockGenerativeModel({ mode: 'prefer_on_device', nanoAvailable: true });
  const noNano = new MockGenerativeModel({ mode: 'prefer_on_device', nanoAvailable: false });
  const cloud = new MockGenerativeModel({ mode: 'prefer_in_cloud' });
  const prompt = 'TASK: QUICK_SCREEN\nCategory: Other\nINPUT:\nhello';
  assert.equal((await device.generateContent(prompt)).response.inferenceSource, 'ON_DEVICE');
  assert.equal((await noNano.generateContent(prompt)).response.inferenceSource, 'IN_CLOUD');
  assert.equal((await cloud.generateContent(prompt)).response.inferenceSource, 'IN_CLOUD');
});

test('end-to-end (simulated sources): scam text -> high-risk report + verifiable receipt', async () => {
  const store = new MemoryStore();
  const client = createMockClient({ labelSources: 'simulated' });
  const { quick, route, report, receipt } = await runCheck({
    client,
    store,
    text: SAMPLE_SCAM,
    category: 'Investment / crypto pitch',
  });
  assert.equal(quick.verdict, 'high_risk');
  assert.equal(route.route, 'cloud'); // high-risk quick screen escalates to cloud
  assert.equal(report.verdict, 'high_risk');
  assert.ok(report.redFlags.length >= 3);
  assert.equal(receipt.stages[0].inferenceSource, 'ON_DEVICE');
  assert.equal(receipt.stages[1].inferenceSource, 'IN_CLOUD');
  const v = await verifyReceipt(receipt);
  assert.ok(v.ok, v.errors.join('; '));
});

test('end-to-end: clean rental text -> likely_ok, deep check stays on device', async () => {
  const store = new MemoryStore();
  const client = createMockClient({ labelSources: 'simulated' });
  const { route, report, receipt } = await runCheck({
    client,
    store,
    text: SAMPLE_RENTAL,
    category: 'Rental / housing ad',
  });
  assert.equal(route.route, 'on_device');
  assert.equal(report.verdict, 'likely_ok');
  assert.equal(receipt.stages[1].inferenceSource, 'ON_DEVICE');
});

test('two sequential checks form a verifiable chain in the store', async () => {
  const store = new MemoryStore();
  const client = createMockClient();
  await runCheck({ client, store, text: SAMPLE_SCAM, category: 'Other' });
  await runCheck({ client, store, text: SAMPLE_RENTAL, category: 'Rental / housing ad' });
  const items = await store.list();
  assert.equal(items.length, 2);
  assert.equal(items[1].prevHash, items[0].hash);
  const chain = await verifyChain(items);
  assert.ok(chain.ok, chain.errors.join('; '));
  // demo-mode labelling: stages must be stamped DEMO, never a fake routing claim
  assert.ok(items.every((r) => r.stages.every((s) => s.inferenceSource === 'DEMO')));
});

test('a client that returns garbage still yields a valid report (heuristic fallback)', async () => {
  const garbageClient = {
    kind: 'demo',
    async quickScreen() {
      return { raw: 'not json at all', inferenceSource: 'DEMO' };
    },
    async deepCheck() {
      return { raw: '{"broken": true', inferenceSource: 'DEMO' };
    },
  };
  const store = new MemoryStore();
  const { report, receipt } = await runCheck({ client: garbageClient, store, text: SAMPLE_SCAM, category: 'Other' });
  assert.equal(report.verdict, 'high_risk');
  const v = await verifyReceipt(receipt);
  assert.ok(v.ok);
});
