import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { initAnalytics } from './analytics';
import { App } from './App';
import { captureAuthRedirect } from './auth';
import { config } from './config';
import { detectLanguage, I18nProvider } from './i18n';
import { applyInitialTheme, ThemeProvider } from './theme';
import './styles.css';

registerSW({ immediate: true });
// Before the app reads the hash: a moderator's magic-link sign-in lands here with tokens in it.
captureAuthRedirect();
initAnalytics();

applyInitialTheme();

const lang = detectLanguage(config.app.languages, config.app.fallbackLanguage);
document.documentElement.lang = lang;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider initial={lang}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
