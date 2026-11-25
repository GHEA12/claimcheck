// Copy this file to `firebase-config.js` (same folder) and fill in the
// values from the Firebase console:
//   Firebase console -> Project settings -> General -> Your apps -> Web app
// `firebase-config.js` is gitignored and must never be committed with real
// values in a public repo you do not control; the web config itself is not
// a secret, but keep production keys out of the repo per the contest rules.
//
// After copying, reload the app: the header badge switches from
// "DEMO MODE" to "LIVE · Firebase AI Logic".

export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// Optional: a reCAPTCHA v3 site key for App Check. If left empty, the app
// enables the App Check debug provider instead (debug tokens are accepted
// for hackathon submissions; register the token printed in the browser
// console under Firebase console -> App Check -> Apps -> Manage debug
// tokens).
export const appCheckSiteKey = '';
