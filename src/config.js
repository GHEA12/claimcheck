// ClaimCheck — configuration loading.
//
// Live mode needs a Firebase web config. It is NEVER committed to the
// repo: the app dynamically imports ../firebase-config.js, which is
// gitignored. Copy firebase-config.example.js to firebase-config.js and
// fill in the values from the Firebase console (Project settings →
// Your apps → Web app). If the file is missing or still holds placeholder
// values, the app boots in DEMO MODE with the deterministic mock model
// and a local receipt ledger, and says so in the header.

export async function loadConfig() {
  try {
    const mod = await import('../firebase-config.js');
    const cfg = mod.firebaseConfig;
    if (cfg && cfg.apiKey && !String(cfg.apiKey).includes('YOUR_')) {
      return { mode: 'live', firebaseConfig: cfg, appCheckSiteKey: mod.appCheckSiteKey || '' };
    }
  } catch {
    /* no firebase-config.js yet — demo mode */
  }
  return { mode: 'demo' };
}
