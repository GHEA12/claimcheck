// ClaimCheck — live Firebase AI Logic client (browser only).
//
// ALL AI inference in ClaimCheck goes through Firebase AI Logic. There are
// no direct calls to any other model API anywhere in this project.
//
// Hybrid routing, per the official Firebase AI Logic hybrid docs:
//   - Quick Screen uses InferenceMode.PREFER_ON_DEVICE: Gemini Nano in
//     Chrome when available, cloud fallback otherwise.
//   - Deep Check uses PREFER_ON_DEVICE for short, lower-risk inputs and
//     PREFER_IN_CLOUD with a JSON response schema for long or high-risk
//     inputs.
// Every response's `inferenceSource` ('ON_DEVICE' | 'IN_CLOUD') is returned
// to the caller and written into the receipt — the routing itself becomes
// provenance.

import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from 'firebase/ai';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { REPORT_RESPONSE_SCHEMA } from './analyze.js';

function toSdkSchema(node) {
  if (node.type === 'object') {
    const properties = {};
    for (const [k, v] of Object.entries(node.properties || {})) properties[k] = toSdkSchema(v);
    return Schema.object({ properties, optionalProperties: (node.required ? Object.keys(node.properties || {}).filter((k) => !node.required.includes(k)) : []) });
  }
  if (node.type === 'array') return Schema.array({ items: toSdkSchema(node.items) });
  if (node.type === 'string') return node.enum ? Schema.enumString({ enum: node.enum }) : Schema.string();
  if (node.type === 'number') return Schema.number();
  return Schema.string();
}

export async function createLiveClient(firebaseConfig, { appCheckSiteKey } = {}) {
  const app = initializeApp(firebaseConfig);

  // Firebase AI Logic requires App Check. A reCAPTCHA v3 site key is used
  // when provided; otherwise the debug provider is enabled, which the
  // contest rules explicitly accept ("debug tokens are accepted").
  if (appCheckSiteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } else {
    // eslint-disable-next-line no-restricted-globals
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider('debug-token-placeholder'), isTokenAutoRefreshEnabled: true });
  }

  // Anonymous auth so Firestore rules can scope receipt writes to signed-in
  // (anonymous) users. Non-fatal if it fails — reads still work.
  try {
    await signInAnonymously(getAuth(app));
  } catch {
    /* anonymous auth is best-effort for this app */
  }

  const ai = getAI(app, { backend: new GoogleAIBackend() });

  // Models are created lazily inside each call: the hybrid docs require
  // getGenerativeModel to be called after a user interaction.
  const quickModel = () => getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE });
  const deviceModel = () => getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE });
  const cloudModel = () =>
    getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_IN_CLOUD,
      inCloudParams: {
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toSdkSchema(REPORT_RESPONSE_SCHEMA),
        },
      },
    });

  async function call(model, prompt) {
    const result = await model.generateContent(prompt);
    return {
      raw: result.response.text(),
      inferenceSource: result.response.inferenceSource || 'IN_CLOUD',
    };
  }

  return {
    kind: 'live',
    app,
    quickScreen: (prompt) => call(quickModel(), prompt),
    deepCheck: (prompt, route) => call(route === 'cloud' ? cloudModel() : deviceModel(), prompt),
  };
}
