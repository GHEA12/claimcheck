// ClaimCheck — deterministic mock model.
//
// Implements the exact interface the app uses against Firebase AI Logic
// ({ generateContent(prompt) -> { response: { text(), inferenceSource } } }),
// backed by the deterministic heuristic engine instead of a neural model.
// It powers:
//   - DEMO MODE in the browser, when no Firebase project config exists yet;
//   - the Node test suites and the scripted end-to-end demo.
// It is never hidden: the UI labels demo mode, and receipts minted in demo
// mode record inferenceSource 'DEMO' instead of a real routing result.

import { buildHeuristicReport, verdictForScore } from './analyze.js';

function extractInput(prompt) {
  const marker = 'INPUT:\n';
  const i = prompt.indexOf(marker);
  return i === -1 ? prompt : prompt.slice(i + marker.length);
}

function extractCategory(prompt) {
  const m = prompt.match(/Category: (.+)/);
  return m ? m[1].trim() : 'Other';
}

export class MockGenerativeModel {
  // mode mirrors Firebase AI Logic's InferenceMode values as strings.
  // nanoAvailable=false simulates a browser without Gemini Nano: a
  // PREFER_ON_DEVICE model then reports IN_CLOUD, like the real SDK.
  constructor({ mode = 'prefer_on_device', nanoAvailable = true } = {}) {
    this.mode = mode;
    this.nanoAvailable = nanoAvailable;
  }

  inferenceSource() {
    if (this.mode === 'only_in_cloud' || this.mode === 'prefer_in_cloud') return 'IN_CLOUD';
    if (this.mode === 'only_on_device') return 'ON_DEVICE';
    return this.nanoAvailable ? 'ON_DEVICE' : 'IN_CLOUD'; // prefer_on_device
  }

  async generateContent(prompt) {
    const text = extractInput(String(prompt));
    const category = extractCategory(String(prompt));
    const report = buildHeuristicReport(text, category);
    let payload;
    if (String(prompt).startsWith('TASK: QUICK_SCREEN')) {
      payload = {
        verdict: report.verdict,
        riskScore: report.riskScore,
        topFlags: report.redFlags.slice(0, 3).map((f) => f.title),
        summary: report.summary,
      };
    } else {
      payload = {
        verdict: report.verdict,
        riskScore: report.riskScore,
        summary: report.summary,
        redFlags: report.redFlags.map(({ title, evidence, severity }) => ({ title, evidence, severity })),
        positives: report.positives,
        missingInfo: report.missingInfo,
        questionsToAsk: report.questionsToAsk,
      };
      payload.verdict = verdictForScore(payload.riskScore);
    }
    const source = this.inferenceSource();
    return {
      response: {
        text: () => JSON.stringify(payload),
        inferenceSource: source,
      },
    };
  }
}

// A client with the same shape as the live Firebase client (see ai.js).
// labelSources: 'demo' (default) stamps every stage DEMO — the honest label
// for the browser's demo mode. 'simulated' keeps the model's simulated
// ON_DEVICE / IN_CLOUD routing, used by the scripted demo and tests, which
// always print that the run is a simulation.
export function createMockClient({ nanoAvailable = true, labelSources = 'demo' } = {}) {
  const quickModel = new MockGenerativeModel({ mode: 'prefer_on_device', nanoAvailable });
  const deviceModel = new MockGenerativeModel({ mode: 'prefer_on_device', nanoAvailable });
  const cloudModel = new MockGenerativeModel({ mode: 'prefer_in_cloud' });
  const label = (simulated) => (labelSources === 'simulated' ? simulated : 'DEMO');
  return {
    kind: 'demo',
    async quickScreen(prompt) {
      const r = await quickModel.generateContent(prompt);
      return { raw: r.response.text(), inferenceSource: label(r.response.inferenceSource) };
    },
    async deepCheck(prompt, route) {
      const model = route === 'cloud' ? cloudModel : deviceModel;
      const r = await model.generateContent(prompt);
      return { raw: r.response.text(), inferenceSource: label(r.response.inferenceSource) };
    },
  };
}
