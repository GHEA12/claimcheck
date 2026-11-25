// ClaimCheck — tamper-evident receipts.
//
// Every completed check mints a receipt in the pattern we established with
// FabReceipt and RunReceipt: SHA-256 over a canonical JSON form, and each
// receipt carries the previous receipt's hash, forming a chain. Editing a
// report (or an input, or a stage's inference source) after the fact
// breaks that receipt's hash; deleting or reordering receipts breaks the
// chain. Verification is pure recomputation — anyone can do it.

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const GENESIS_HASH = '0'.repeat(64);

// stages: [{ stage: 'quick_screen'|'deep_check', inferenceSource: 'ON_DEVICE'|'IN_CLOUD'|'DEMO',
//            requestedRoute: 'on_device'|'cloud'|..., model: string }]
export async function createReceipt({ inputText, category, stages, report, prevHash, now = new Date() }) {
  const createdAt = now.toISOString();
  const inputHash = await sha256Hex(inputText);
  const reportHash = await sha256Hex(canonicalJson(report));
  const id = 'rcpt_' + (await sha256Hex(inputHash + '|' + createdAt)).slice(0, 12);
  const body = {
    v: 1,
    app: 'claimcheck',
    id,
    createdAt,
    category,
    inputHash,
    inputChars: inputText.length,
    reportHash,
    stages,
    prevHash: prevHash || GENESIS_HASH,
  };
  const hash = await sha256Hex(canonicalJson(body));
  return { ...body, report, hash };
}

export async function verifyReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object') return { ok: false, errors: ['not an object'] };
  const { report, hash, ...body } = receipt;
  const inputHashOk = typeof body.inputHash === 'string' && body.inputHash.length === 64;
  if (!inputHashOk) errors.push('inputHash missing or malformed');
  const expectedReportHash = await sha256Hex(canonicalJson(report ?? null));
  if (expectedReportHash !== body.reportHash) errors.push('reportHash mismatch — the report was altered after the receipt was issued');
  const expectedHash = await sha256Hex(canonicalJson(body));
  if (expectedHash !== hash) errors.push('receipt hash mismatch — receipt fields were altered');
  return { ok: errors.length === 0, errors };
}

// receipts: array ordered oldest -> newest.
export async function verifyChain(receipts) {
  const errors = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    const v = await verifyReceipt(r);
    if (!v.ok) errors.push(`receipt ${r.id || i}: ${v.errors.join('; ')}`);
    if (r.prevHash !== prev) errors.push(`receipt ${r.id || i}: prevHash does not match the previous receipt — chain is broken`);
    prev = r.hash;
  }
  return { ok: errors.length === 0, errors, count: receipts.length };
}

export const shortHash = (h) => (typeof h === 'string' && h.length > 16 ? h.slice(0, 10) + '…' + h.slice(-6) : h);
