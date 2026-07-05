import { useState } from 'react';
import './InstallHint.css';

const DISMISS_KEY = 'five31.installHint.dismissed';

/** True on iOS Safari (iPhone/iPad) — the only platform with the manual A2HS flow. */
function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Mac; detect touch to catch it.
  const isIpadOs =
    navigator.platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|chrome/i.test(ua);
  return (isIos || isIpadOs) && isSafari;
}

/** True when already launched from the home screen (standalone). */
function isStandalone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

/**
 * Banner nudging iOS Safari users to Add to Home Screen. Shown ONLY when:
 * iOS Safari AND not already standalone AND not previously dismissed.
 */
export function InstallHint() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed || !isIosSafari() || isStandalone()) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore — private mode etc.
    }
    setDismissed(true);
  };

  return (
    <div className="install-hint">
      <div className="install-hint__body">
        <span className="install-hint__title label label-hi">Install FIVE31</span>
        <span className="install-hint__text">
          Tap the Share icon{' '}
          <span className="install-hint__share" aria-hidden="true">
            &#x2191;
          </span>{' '}
          then “Add to Home Screen” to run offline, full-screen.
        </span>
      </div>
      <button type="button" className="install-hint__close" aria-label="Dismiss" onClick={dismiss}>
        &times;
      </button>
    </div>
  );
}
