// ClaimCheck — browser UI wiring.

import { loadConfig } from './config.js';
import { createMockClient } from './mock-ai.js';
import { CATEGORIES } from './analyze.js';
import { runCheck } from './flow.js';
import { verifyReceipt, verifyChain, shortHash } from './receipts.js';
import { LocalStorageStore } from './store.js';

const SAMPLES = {
  scam: `URGENT!! Double your Bitcoin in 24 hours! Send 0.1 BTC to our wallet and receive 0.2 BTC back, guaranteed profit, no risk! Our team of expert traders works with a secret exchange. Offer expires in 2 hours, only 3 spots left! Contact us on Telegram only, do not tell your bank. A registration fee of $50 in gift cards is required to activate your account.`,
  rental: `For rent: 2-bedroom apartment in Kebayoran Baru, South Jakarta. Rp 8,500,000 per month, minimum 6-month lease. The unit is on the 5th floor of a serviced building with parking and 24-hour security. Viewing available Saturday and Sunday by appointment at the building office. The lease is signed at the notary office and a refundable deposit of one month applies. Contact Ibu Ratna, licensed agent, office phone (021) 555-0134.`,
  job: `Work from home, no experience needed! Earn $4,500 per week just processing payments for our clients. We are a trusted team and hiring urgently. To start, pay a small activation fee of $75 to unlock your worker account, then share the code we send to your phone so we can verify you.`,
};

const $ = (id) => document.getElementById(id);
const els = {
  category: $('category'),
  input: $('input'),
  charcount: $('charcount'),
  run: $('run'),
  status: $('status'),
  modeBadge: $('mode-badge'),
  quick: $('quick-result'),
  report: $('report'),
  receipt: $('receipt'),
  ledger: $('ledger'),
  chainStatus: $('chain-status'),
  verifyChain: $('verify-chain'),
};

let client = null;
let store = null;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function verdictClass(v) {
  return v === 'high_risk' ? 'v-high' : v === 'caution' ? 'v-caution' : 'v-ok';
}
function verdictLabel(v) {
  return v === 'high_risk' ? 'HIGH RISK' : v === 'caution' ? 'CAUTION' : 'LIKELY OK';
}
function sourceBadge(s) {
  const label = s === 'ON_DEVICE' ? 'ran ON-DEVICE' : s === 'IN_CLOUD' ? 'ran IN CLOUD' : 'DEMO engine';
  return `<span class="src src-${String(s).toLowerCase()}">${label}</span>`;
}

function renderQuick(quick, stages) {
  els.quick.classList.remove('hidden');
  els.quick.innerHTML = `
    <div class="row between">
      <strong>Quick Screen</strong>${sourceBadge(stages.quickSource)}
    </div>
    <p><span class="verdict ${verdictClass(quick.verdict)}">${verdictLabel(quick.verdict)}</span>
    <span class="score">risk ${quick.riskScore}/100</span></p>
    ${quick.topFlags.length ? `<ul>${quick.topFlags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <p class="muted">${esc(quick.summary)}</p>`;
}

function renderReport(report, stages, route) {
  const flags = report.redFlags
    .map(
      (f) => `<li>
        <div class="row between"><strong>${esc(f.title)}</strong><span class="sev sev-${f.severity}">severity ${f.severity}${f.source === 'cross-check' ? ' · cross-check' : ''}</span></div>
        ${f.evidence ? `<blockquote>${esc(f.evidence)}</blockquote>` : ''}
      </li>`,
    )
    .join('');
  els.report.innerHTML = `
    <div class="banner ${verdictClass(report.verdict)}">
      <span>${verdictLabel(report.verdict)}</span>
      <span class="score">risk ${report.riskScore}/100 · ${esc(report.category)}</span>
    </div>
    <div class="meter"><div class="meter-fill ${verdictClass(report.verdict)}" style="width:${report.riskScore}%"></div></div>
    <p>${esc(report.summary)}</p>
    <div class="row between"><h3>Deep Check</h3>${sourceBadge(stages.deepSource)}</div>
    <p class="muted">Route: ${esc(route.reason)}</p>
    <h3>Red flags</h3>
    ${report.redFlags.length ? `<ul class="flags">${flags}</ul>` : '<p class="muted">None found.</p>'}
    <h3>Positives</h3>
    ${report.positives.length ? `<ul>${report.positives.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p class="muted">None detected.</p>'}
    <h3>Missing information</h3>
    ${report.missingInfo.length ? `<ul>${report.missingInfo.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p class="muted">Nothing material missing.</p>'}
    <h3>Ask before you pay</h3>
    ${report.questionsToAsk.length ? `<ol>${report.questionsToAsk.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : '<p class="muted">—</p>'}`;
}

function renderReceipt(receipt) {
  els.receipt.classList.remove('hidden');
  const stageRows = receipt.stages
    .map((s) => `<div class="row between"><span>${esc(s.stage)} (${esc(s.requestedRoute)})</span>${sourceBadge(s.inferenceSource)}</div>`)
    .join('');
  els.receipt.innerHTML = `
    <h3>Receipt ${esc(receipt.id)}</h3>
    ${stageRows}
    <dl>
      <dt>Issued</dt><dd>${esc(receipt.createdAt)}</dd>
      <dt>Input hash</dt><dd><code>${esc(shortHash(receipt.inputHash))}</code> (${receipt.inputChars} chars)</dd>
      <dt>Report hash</dt><dd><code>${esc(shortHash(receipt.reportHash))}</code></dd>
      <dt>Previous</dt><dd><code>${esc(shortHash(receipt.prevHash))}</code></dd>
      <dt>Receipt hash</dt><dd><code>${esc(shortHash(receipt.hash))}</code></dd>
    </dl>
    <button type="button" id="verify-this">Verify this receipt</button>
    <p class="status" id="verify-this-status"></p>`;
  $('verify-this').addEventListener('click', async () => {
    const v = await verifyReceipt(receipt);
    $('verify-this-status').textContent = v.ok ? '✓ Verified — hashes recompute exactly. This report is unaltered.' : '✗ FAILED: ' + v.errors.join('; ');
  });
}

async function renderLedger() {
  const items = await store.list();
  if (!items.length) {
    els.ledger.innerHTML = '<p class="muted">No receipts yet.</p>';
    return;
  }
  els.ledger.innerHTML = [...items]
    .reverse()
    .map(
      (r) => `<div class="ledger-row">
        <div>
          <strong>${esc(r.id)}</strong> <span class="muted">${esc(r.createdAt)}</span><br/>
          <span class="verdict ${verdictClass(r.report.verdict)}">${verdictLabel(r.report.verdict)}</span>
          <span class="score">risk ${r.report.riskScore}/100</span> · ${esc(r.category)} ·
          ${r.stages.map((s) => sourceBadge(s.inferenceSource)).join(' ')}
        </div>
        <code title="${esc(r.hash)}">${esc(shortHash(r.hash))}</code>
      </div>`,
    )
    .join('');
}

async function boot() {
  for (const c of CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    els.category.appendChild(opt);
  }
  els.category.value = 'Message from a stranger';

  const config = await loadConfig();
  if (config.mode === 'live') {
    const [{ createLiveClient }, { FirestoreStore }] = await Promise.all([import('./ai.js'), import('./store-firestore.js')]);
    const live = await createLiveClient(config.firebaseConfig, { appCheckSiteKey: config.appCheckSiteKey });
    client = live;
    store = new FirestoreStore(live.app);
    els.modeBadge.textContent = 'LIVE · Firebase AI Logic';
    els.modeBadge.classList.add('live');
  } else {
    client = createMockClient();
    store = new LocalStorageStore(window.localStorage);
    els.modeBadge.textContent = 'DEMO MODE · local engine';
  }
  await renderLedger();
}

els.input.addEventListener('input', () => {
  els.charcount.textContent = `${els.input.value.length} characters`;
});

document.querySelectorAll('[data-sample]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-sample');
    els.input.value = SAMPLES[key];
    els.category.value = key === 'scam' ? 'Investment / crypto pitch' : key === 'rental' ? 'Rental / housing ad' : 'Job offer';
    els.input.dispatchEvent(new Event('input'));
  });
});

els.run.addEventListener('click', async () => {
  const text = els.input.value.trim();
  if (!text) {
    els.status.textContent = 'Paste a text first.';
    return;
  }
  els.run.disabled = true;
  els.status.textContent = 'Running Quick Screen…';
  els.quick.classList.add('hidden');
  els.receipt.classList.add('hidden');
  try {
    const { quick, route, report, receipt } = await runCheck({
      client,
      store,
      text,
      category: els.category.value,
      onQuick: () => {
        els.status.textContent = 'Quick Screen done. Running Deep Check…';
      },
    });
    renderQuick(quick, { quickSource: receipt.stages[0].inferenceSource });
    renderReport(report, { deepSource: receipt.stages[1].inferenceSource }, route);
    renderReceipt(receipt);
    await renderLedger();
    els.status.textContent = 'Done. Receipt appended to the ledger.';
  } catch (err) {
    els.status.textContent = 'Something went wrong: ' + (err && err.message ? err.message : err);
  } finally {
    els.run.disabled = false;
  }
});

els.verifyChain.addEventListener('click', async () => {
  const items = await store.list();
  const v = await verifyChain(items);
  els.chainStatus.textContent = v.ok
    ? `✓ Chain verified — ${v.count} receipt(s), all hashes and links intact.`
    : '✗ Chain FAILED: ' + v.errors.join('; ');
});

boot().catch((err) => {
  els.modeBadge.textContent = 'failed to start';
  els.status.textContent = 'Startup error: ' + (err && err.message ? err.message : err);
});
