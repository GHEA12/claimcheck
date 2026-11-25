// ClaimCheck — pure analysis logic (shared by the browser app, the mock
// model, the scripted demo, and the Node test suites).
//
// Nothing in this file talks to a network or a model. It builds prompts,
// parses and validates model output, runs the deterministic red-flag
// cross-check, and decides how the deep check should be routed.

export const CATEGORIES = [
  'Marketplace listing',
  'Rental / housing ad',
  'Job offer',
  'Investment / crypto pitch',
  'Invoice / payment request',
  'Message from a stranger',
  'Other',
];

export const VERDICTS = ['likely_ok', 'caution', 'high_risk'];

export function verdictForScore(score) {
  if (score >= 60) return 'high_risk';
  if (score >= 30) return 'caution';
  return 'likely_ok';
}

// ---------------------------------------------------------------------------
// Deterministic red-flag cross-check
//
// A fixed pattern bank of well-known scam signals. This runs locally in
// every mode, alongside the LLM: if the model misses a known scam phrase,
// the cross-check still catches it, and the report says so. Patterns are
// deliberately specific (e.g. a bare "deposit" is fine; "deposit in gift
// cards" is not) so ordinary listings stay clean.
// ---------------------------------------------------------------------------

const FLAG_PATTERNS = [
  {
    id: 'guaranteed-profit',
    title: 'Guaranteed or risk-free profit promised',
    severity: 3,
    re: /guaranteed (profit|returns?|income)|risk[- ]free profit|100% profit|no risk/i,
    question: 'Can they show audited results and explain exactly where the profit comes from?',
  },
  {
    id: 'money-doubling',
    title: 'Money-doubling / send-first scheme',
    severity: 3,
    re: /double your (money|bitcoin|btc|crypto|investment)|send (us )?(0\.\d+|\d+) ?(btc|eth|bitcoin) and (receive|get)|turn \$\d+ into \$\d+/i,
    question: 'Why would anyone need your money first in order to give you more money back?',
  },
  {
    id: 'gift-card-payment',
    title: 'Payment demanded in gift cards or vouchers',
    severity: 3,
    re: /gift cards?|steam cards?|itunes cards?|google play cards?/i,
    question: 'Why can this fee not be paid by a normal, traceable bank transfer?',
  },
  {
    id: 'advance-fee',
    title: 'Upfront / activation / registration fee requested',
    severity: 3,
    re: /(registration|activation|processing|release|unlock) fee of|pay (a|an|the) (small )?(fee|deposit) (first|upfront|to activate|to unlock)|fee.{0,30}to activate your account/i,
    question: 'What exactly does this fee pay for, and can you verify the organisation charging it?',
  },
  {
    id: 'off-platform-contact',
    title: 'Pushes contact off the platform (Telegram/WhatsApp only)',
    severity: 2,
    re: /contact (us |me )?(only )?(on|via) (telegram|whatsapp)|telegram only|whatsapp only|do not (use|contact).{0,20}(app|platform|website)/i,
    question: 'Why do they refuse to keep the conversation inside the platform where it is recorded?',
  },
  {
    id: 'secrecy',
    title: 'Asks you to keep it secret from your bank or others',
    severity: 2,
    re: /do not tell (your bank|anyone|the bank)|don't tell (your bank|anyone)|keep this (a )?secret|between us/i,
    question: 'Why would a legitimate offer need to be hidden from your bank?',
  },
  {
    id: 'urgency',
    title: 'Artificial urgency / pressure to act fast',
    severity: 2,
    re: /urgent|act now|expires in \d|only \d+ spots? left|limited time|hurry|immediately or (you|the offer)/i,
    question: 'Can the offer wait 48 hours while you verify it? Real offers can.',
  },
  {
    id: 'too-good-salary',
    title: 'Salary or returns far above market for vague work',
    severity: 2,
    re: /\$\s?\d{1,3},?\d{3}\s*(per|\/)\s*(week|day)|earn \$\d{4,} (weekly|daily|per week)|no experience (needed|required).{0,40}\$\d/i,
    question: 'What work is actually being paid for, and which registered company pays it?',
  },
  {
    id: 'credential-request',
    title: 'Asks for credentials, OTP, or wallet seed phrase',
    severity: 3,
    re: /seed phrase|recovery phrase|private key|share your (password|otp|pin|code)|send (us )?the code (we|you)/i,
    question: 'No legitimate service ever needs your password, OTP, or seed phrase. Why do they?',
  },
  {
    id: 'unverifiable-identity',
    title: 'No verifiable company or personal identity given',
    severity: 1,
    re: /our team of (expert|professional)|secret (exchange|system|method)|trusted team/i,
    question: 'What is the legal name of the company, and where is it registered?',
  },
];

function splitSentences(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function evidenceFor(re, text) {
  const hit = splitSentences(text).find((s) => re.test(s));
  if (hit) return hit.length > 220 ? hit.slice(0, 217) + '...' : hit;
  const m = String(text).match(re);
  return m ? m[0] : '';
}

const SEVERITY_POINTS = { 3: 30, 2: 18, 1: 8 };

export function heuristicScan(text) {
  const flags = [];
  for (const p of FLAG_PATTERNS) {
    if (p.re.test(text)) {
      flags.push({
        id: p.id,
        title: p.title,
        severity: p.severity,
        evidence: evidenceFor(p.re, text),
        source: 'cross-check',
      });
    }
  }
  const raw = flags.reduce((sum, f) => sum + (SEVERITY_POINTS[f.severity] || 0), 0);
  return { flags, score: Math.min(100, raw) };
}

// ---------------------------------------------------------------------------
// Positives / missing information (deterministic, conservative)
// ---------------------------------------------------------------------------

const POSITIVE_CHECKS = [
  { re: /(\+\d[\d\s-]{7,}\d|\(\d{2,4}\)\s?\d{3,})/, text: 'Includes a phone number that can be called back' },
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/, text: 'Includes an email address' },
  { re: /licensed|licence|license no|registered (agent|company|broker)/i, text: 'Claims a licence or registration you can verify' },
  { re: /viewing|inspection|visit (the|our) (office|unit|property)|by appointment/i, text: 'Offers an in-person viewing or inspection' },
  { re: /notary|written (lease|contract|agreement)|signed (lease|contract|agreement)/i, text: 'Mentions a written contract or notary process' },
  { re: /office (phone|address)|head office|our office at/i, text: 'Gives an office contact point' },
];

export function findPositives(text) {
  return POSITIVE_CHECKS.filter((c) => c.re.test(text)).map((c) => c.text);
}

export function findMissingInfo(text, category) {
  const missing = [];
  if (!/(\$|€|£|rp\.?|usd|idr|price|rent|cost|salary|fee)\s?[\d.,]/i.test(text) && !/\d+\s?(per|\/)\s?(month|week|year)/i.test(text)) {
    missing.push('No concrete price or amount is stated');
  }
  if (!/(\+\d[\d\s-]{7,}\d|[\w.+-]+@[\w-]+\.[\w.]+|office|address)/i.test(text)) {
    missing.push('No verifiable contact channel or address is given');
  }
  if (!/(company|pt\.|ltd|llc|inc\.|gmbh|sdn|bhd)/i.test(text) && category !== 'Message from a stranger') {
    missing.push('No legal company name is given');
  }
  if (!/(http|www\.)/i.test(text)) {
    missing.push('No website or public profile is linked');
  }
  return missing;
}

export function questionsFor(flags, missing) {
  const qs = [];
  for (const f of flags) {
    const p = FLAG_PATTERNS.find((x) => x.id === f.id);
    if (p && p.question) qs.push(p.question);
  }
  if (missing.length) qs.push('Can they provide the missing details in writing before any payment?');
  qs.push('Can you verify the same offer on the organisation’s official website or office?');
  return [...new Set(qs)].slice(0, 5);
}

// A full report built from the deterministic engine alone. The mock model
// returns this (as JSON) so demo mode behaves like the real flow; it is
// also the fallback if a model response cannot be parsed.
export function buildHeuristicReport(text, category = 'Other') {
  const scan = heuristicScan(text);
  const positives = findPositives(text);
  const missing = findMissingInfo(text, category);
  let score = scan.score;
  if (positives.length >= 2) score = Math.max(0, score - 10);
  const verdict = verdictForScore(score);
  const summary =
    verdict === 'high_risk'
      ? 'This shows multiple well-known scam signals. Do not send money or personal details.'
      : verdict === 'caution'
        ? 'Some warning signs are present. Verify the missing details before you commit to anything.'
        : 'No strong scam signals were found in the text. Still confirm the details independently before paying.';
  return {
    verdict,
    riskScore: score,
    category,
    summary,
    redFlags: scan.flags.map(({ id, title, evidence, severity, source }) => ({ id, title, evidence, severity, source })),
    positives,
    missingInfo: missing,
    questionsToAsk: questionsFor(scan.flags, missing),
  };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export function buildQuickScreenPrompt(text, category) {
  return [
    'TASK: QUICK_SCREEN',
    'You are a trust-and-safety screener. In one pass, judge whether the text below looks like a scam, fraud, or misleading offer.',
    `Category: ${category}`,
    'Reply with ONLY a JSON object, no markdown fences, in exactly this shape:',
    '{"verdict":"likely_ok|caution|high_risk","riskScore":0-100,"topFlags":["short flag", "..."],"summary":"one sentence"}',
    'INPUT:',
    text,
  ].join('\n');
}

export function buildDeepCheckPrompt(text, category, quick) {
  const lines = [
    'TASK: DEEP_CHECK',
    'You are a verification analyst. Produce a careful trust-check report for the text below.',
    `Category: ${category}`,
  ];
  if (quick) lines.push(`A quick screen already found: verdict ${quick.verdict}, risk ${quick.riskScore}/100. Re-examine independently; do not just copy it.`);
  lines.push(
    'Reply with ONLY a JSON object, no markdown fences, in exactly this shape:',
    '{"verdict":"likely_ok|caution|high_risk","riskScore":0-100,',
    '"summary":"2-3 sentences",',
    '"redFlags":[{"title":"short title","evidence":"exact quote from the text","severity":1|2|3}],',
    '"positives":["verifiable good sign", "..."],',
    '"missingInfo":["important detail that is absent", "..."],',
    '"questionsToAsk":["question the reader should ask before paying", "..."]}',
    'Rules: evidence must be an exact quote from the text. If there are no red flags, use an empty array. Be specific, not generic.',
    'INPUT:',
    text,
  );
  return lines.join('\n');
}

// JSON Schema used as the cloud model's structured-output schema.
export const REPORT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    riskScore: { type: 'number' },
    summary: { type: 'string' },
    redFlags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          evidence: { type: 'string' },
          severity: { type: 'number' },
        },
        required: ['title', 'evidence', 'severity'],
      },
    },
    positives: { type: 'array', items: { type: 'string' } },
    missingInfo: { type: 'array', items: { type: 'string' } },
    questionsToAsk: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'riskScore', 'summary', 'redFlags', 'positives', 'missingInfo', 'questionsToAsk'],
};

// ---------------------------------------------------------------------------
// Model-output parsing and validation
// ---------------------------------------------------------------------------

export function parseModelJson(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

const clampScore = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const strList = (v, max = 8) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, max) : []);

export function validateQuick(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const riskScore = clampScore(obj.riskScore);
  return {
    verdict: VERDICTS.includes(obj.verdict) ? obj.verdict : verdictForScore(riskScore),
    riskScore,
    topFlags: strList(obj.topFlags, 5),
    summary: typeof obj.summary === 'string' ? obj.summary : '',
  };
}

export function validateReport(obj, category = 'Other') {
  if (!obj || typeof obj !== 'object') return null;
  const riskScore = clampScore(obj.riskScore);
  const redFlags = (Array.isArray(obj.redFlags) ? obj.redFlags : [])
    .filter((f) => f && typeof f.title === 'string')
    .slice(0, 10)
    .map((f) => ({
      title: f.title,
      evidence: typeof f.evidence === 'string' ? f.evidence : '',
      severity: [1, 2, 3].includes(f.severity) ? f.severity : 1,
      source: 'model',
    }));
  return {
    verdict: VERDICTS.includes(obj.verdict) ? obj.verdict : verdictForScore(riskScore),
    riskScore,
    category: typeof obj.category === 'string' ? obj.category : category,
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    redFlags,
    positives: strList(obj.positives),
    missingInfo: strList(obj.missingInfo),
    questionsToAsk: strList(obj.questionsToAsk),
  };
}

// Merge deterministic cross-check flags into a model report: any known
// scam pattern the model did not already quote is appended and marked,
// and the score can only be raised by the cross-check, never lowered.
export function mergeCrossCheck(report, text) {
  const scan = heuristicScan(text);
  const quoted = new Set(report.redFlags.map((f) => (f.evidence || '').toLowerCase()));
  const merged = { ...report, redFlags: [...report.redFlags] };
  for (const f of scan.flags) {
    if (!quoted.has((f.evidence || '').toLowerCase())) {
      merged.redFlags.push({ id: f.id, title: f.title, evidence: f.evidence, severity: f.severity, source: 'cross-check' });
    }
  }
  if (scan.score > merged.riskScore) {
    merged.riskScore = scan.score;
    merged.verdict = verdictForScore(merged.riskScore);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Routing: how the deep check should run
// ---------------------------------------------------------------------------

export const LONG_INPUT_CHARS = 4000;

export function decideDeepRoute({ text, quick }) {
  if (text.length > LONG_INPUT_CHARS) {
    return { route: 'cloud', reason: `Long input (${text.length} chars) — the cloud model handles the full document` };
  }
  if (quick && quick.riskScore >= 60) {
    return { route: 'cloud', reason: 'Quick screen scored high risk — the stronger cloud model re-examines it' };
  }
  return { route: 'on_device', reason: 'Short, lower-risk input — the on-device model can complete the full check privately' };
}
