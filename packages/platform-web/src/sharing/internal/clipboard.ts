// Copy text to the clipboard: the async Clipboard API, else the legacy
// `execCommand('copy')` on a temporary textarea. Resolves `false` when both
// are refused, so the caller shows the text to copy by hand (the
// accessibility requirement's text fallback). Never logs the text: it may be
// a share URL carrying a link token.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
