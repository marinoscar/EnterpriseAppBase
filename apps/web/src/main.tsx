import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import App from './App';
// The app's sign-in button looks (#727): registered once, before the first render.
import './identity/authProviders';
import { registerAppLinkRenderers } from './platform/linkRenderers';

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
