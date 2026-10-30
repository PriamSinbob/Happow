import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { AccountProvider } from './account';
import { initAnalytics } from './analytics';
import { captureArrival } from './attendance';
import { App } from './App';
import { captureAuthRedirect } from './auth';
import { config } from './config';
import { adoptEventPath } from './hooks/useHashRoute';
import { detectLanguage, I18nProvider } from './i18n';
import { captureShare } from './share';
import { applyInitialTheme, ThemeProvider } from './theme';
import './styles.css';

registerSW({ immediate: true });
adoptEventPath();
captureArrival();
// Before the app reads the URL: a sign-in from a code email's link or from Google lands here,
// and so does a page shared into the installed app (it opens the add form).
const signedIn = captureAuthRedirect();
captureShare();
initAnalytics();

applyInitialTheme();

const lang = detectLanguage(config.app.languages, config.app.fallbackLanguage);
document.documentElement.lang = lang;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider initial={lang}>
      <AccountProvider ready={signedIn}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </AccountProvider>
    </I18nProvider>
  </StrictMode>,
);
