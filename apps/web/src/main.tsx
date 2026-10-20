import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { captureAuthRedirect } from './auth';
import { config } from './config';
import { detectLanguage, I18nProvider } from './i18n';
import './styles.css';

registerSW({ immediate: true });
// Before the app reads the hash: a moderator's magic-link sign-in lands here with tokens in it.
captureAuthRedirect();

const lang = detectLanguage(config.app.languages, config.app.fallbackLanguage);
document.documentElement.lang = lang;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider initial={lang}>
      <App />
    </I18nProvider>
  </StrictMode>,
);
