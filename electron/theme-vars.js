/**
 * Theme variables — pulled directly from Strata's src/stores/theme-store.ts.
 *
 * Loaded by both settings.html and capture.html (and the pill, which shares
 * capture.html's body). Sets CSS custom properties on document.documentElement
 * so every component using var(--bg) / var(--text) / etc. responds immediately.
 *
 * Two themes:
 *   - parchment    (light mode — Strata's "Parchment" theme verbatim)
 *   - electron-vue (dark mode — Strata's "Electron Vue" theme verbatim)
 */

(function () {
  const PARCHMENT = {
    '--bg': '#f5f4ed',
    '--surface': '#faf9f5',
    '--surface-hover': '#f0eee6',
    '--surface-active': '#e8e6dc',
    '--border': '#e8e6dc',
    '--border-light': '#d1cfc5',
    '--text': '#141413',
    '--text-dim': '#5e5d59',
    '--text-faint': '#87867f',
    '--accent': '#c96442',
    '--accent-dim': 'rgba(201, 100, 66, 0.08)',
    '--accent-hover': '#d97757',
    '--red': '#d93a42',
    '--red-dim': 'rgba(217, 58, 66, 0.08)',
    '--green': '#2e7d32',
    '--green-dim': 'rgba(46, 125, 50, 0.08)',
    '--blue': '#1565c0',
    '--blue-dim': 'rgba(21, 101, 192, 0.08)',
    '--yellow': '#f57f17',
    '--yellow-dim': 'rgba(245, 127, 23, 0.08)',
  };

  const ELECTRON_VUE = {
    '--bg': '#212836',
    '--surface': '#1b212c',
    '--surface-hover': '#283040',
    '--surface-active': '#2e3a4d',
    '--border': '#2c3548',
    '--border-light': '#3d4a60',
    '--text': '#bac7e4',
    '--text-dim': '#99a3b8',
    '--text-faint': '#677696',
    '--accent': '#37c886',
    '--accent-dim': 'rgba(55, 200, 134, 0.14)',
    '--accent-hover': '#4dd89a',
    '--red': '#ff4579',
    '--red-dim': 'rgba(255, 69, 121, 0.14)',
    '--green': '#6af699',
    '--green-dim': 'rgba(106, 246, 153, 0.14)',
    '--blue': '#82aaff',
    '--blue-dim': 'rgba(130, 170, 255, 0.14)',
    '--yellow': '#facf5a',
    '--yellow-dim': 'rgba(250, 207, 90, 0.14)',
  };

  const THEMES = {
    light: PARCHMENT,
    dark: ELECTRON_VUE,
  };

  function resolveMode(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(mode) {
    const resolved = resolveMode(mode);
    const vars = THEMES[resolved];
    const root = document.documentElement;
    for (const key in vars) {
      root.style.setProperty(key, vars[key]);
    }
    root.dataset.theme = resolved;
    document.body && document.body.setAttribute('data-theme', resolved);
  }

  let systemListener = null;
  function watchSystem(callback) {
    if (systemListener) {
      try { matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', systemListener); } catch {}
    }
    systemListener = () => callback(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', systemListener);
  }

  function unwatchSystem() {
    if (systemListener) {
      try { matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', systemListener); } catch {}
      systemListener = null;
    }
  }

  /** Bootstrap theme: read mode (default 'system'), apply, and re-apply on system change. */
  async function boot(modeOverride) {
    let mode = modeOverride;
    if (!mode && window.echo?.readSettings) {
      try { mode = (await window.echo.readSettings())?.themeMode; } catch {}
    }
    mode = mode || 'system';
    applyTheme(mode);
    unwatchSystem();
    if (mode === 'system') watchSystem(() => applyTheme('system'));
    return mode;
  }

  /** Listen for theme changes from the main process (when user saves new mode in Settings). */
  if (window.echo?.onThemeChange) {
    window.echo.onThemeChange((mode) => {
      applyTheme(mode);
      unwatchSystem();
      if (mode === 'system') watchSystem(() => applyTheme('system'));
    });
  }

  window.EchoTheme = { applyTheme, boot, THEMES };
})();
