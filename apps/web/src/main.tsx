import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import App from './App';
// The app's sign-in button looks (#727): registered once, before the first render.
import './identity/authProviders';
import { registerAppLinkRenderers } from './platform/linkRenderers';
import { captureTwaLaunch } from '@marinoscar/platform-web/android-app/headless';
import { ANDROID_TWA_KEY_PREFIX } from './config/androidApp';

// Remember an Android app (Trusted Web Activity) launch and the installed
// build before the router drops `?source=twa&appVersion=&appVersionCode=` (#746).
captureTwaLaunch(undefined, ANDROID_TWA_KEY_PREFIX);

// The public `/s` page's renderers (#731), registered and frozen before the
// first render.
registerAppLinkRenderers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <CssBaseline />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
