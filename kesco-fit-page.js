/*
 * KESCO-MANUAL PDF Viewer - Whole Page Fit patch v3.7.9 (2026-11-10)
 * Target: https://bigstone2e.github.io/kesco-manual-pdf/
 * Install by adding this script at the END of the existing GitHub Pages index.html.
 * This is a view-only enhancement. PDF source files are never modified.
 * PDF.js continues to own PDF loading, rendering, page navigation and downloads.
 * Default: fit one entire page INSIDE the viewer (both width and height).
 * Zoom +/- / width-fit: switch to the original viewer behavior, preserving zoom.
 * Click "한 장 맞춤" at any time to restore fit-page view.
 */
(function () {
  'use strict';
  if (window.__KESCO_MANUAL_WHOLE_PAGE_FIT_V379__) return;
  window.__KESCO_MANUAL_WHOLE_PAGE_FIT_V379__ = true;

  const VERSION = '3.7.9';
  const BUTTON_ID = 'kescoWholePageFitButton';
  const USER_SCALE_BUTTON = /^(?:\+|＋|−|–|-|확대|축소|너비\s*맞춤|폭\s*맞춤|fit\s*width|100%|actual\s*size)$/i;
  const PAGE_BUTTON = /^(?:[◀▶‹›←→]|이전|다음|prev(?:ious)?|next)(?:\s*(?:페이지|page))?$/i;
  const saved = new WeakMap();
  let mode = 'fit';
  let currentCanvas = null;
  let resizePending = false;
  let lastPageFingerprint = '';

  // This viewer renders one PDF page at a time through PDF.js canvas.
  // Prefer its large, visible canvas, not optional icon/sparkline canvases.
  function getPdfCanvas() {
    const candidates = [...document.querySelectorAll('canvas')].filter((el) => {
      const w = Number(el.width) || 0;
      const h = Number(el.height) || 0;
      if (w < 180 || h < 180 || !el.isConnected) return false;
      if (getComputedStyle(el).display === 'none') return false;
      if (el.closest('[hidden], [aria-hidden="true"]')) return false;
      return true;
    });
    return candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] || null;
  }

  // Store ONLY properties touched by this patch so the original zoom UI
  // can regain control without replacing the viewer's other inline styles.
  const fields = ['width', 'height', 'max-width', 'max-height', 'margin-left', 'margin-right', 'display'];
  function remember(el) {
    if (saved.has(el)) return;
    saved.set(el, fields.map((prop) => ({
      prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop)
    })));
  }
  function restore(el) {
    const previous = saved.get(el);
    if (!previous) return;
    for (const item of previous) {
      if (item.value) el.style.setProperty(item.prop, item.value, item.priority);
      else el.style.removeProperty(item.prop);
    }
    saved.delete(el);
    delete el.dataset.kescoFitPage;
  }

  function measureAvailableArea(canvas) {
    // The toolbar is ABOVE the PDF canvas. The remaining viewport height is
    // the maximum available page height, NOT the PDF's original width.
    const rect = canvas.getBoundingClientRect();
    const screenH = window.visualViewport?.height || window.innerHeight;
    const top = Math.max(0, Math.min(rect.top, screenH * 0.65));
    const bottomSpace = 20;
    let maxHeight = Math.max(180, Math.floor(screenH - top - bottomSpace));

    // The hosted viewer may use a smaller scroll panel BELOW its toolbar.
    // Fit within that panel too, not just the outer iframe viewport.
    for (let node = canvas.parentElement; node && node !== document.body; node = node.parentElement) {
      const css = getComputedStyle(node);
      const isScroller = /(auto|scroll)/.test(css.overflowY);
      if (!isScroller || node.clientHeight < 180 || node.clientHeight > screenH + 60) continue;
      const innerTop = Math.max(0, canvas.getBoundingClientRect().top - node.getBoundingClientRect().top);
      maxHeight = Math.max(140, Math.min(maxHeight, node.clientHeight - innerTop - 16));
      break;
    }

    // Guard against an oversized original canvas/wrapper. The visual PDF may
    // not exceed either the screen or the current PDF container's width.
    let container = canvas.parentElement;
    const screenW = window.visualViewport?.width || window.innerWidth;
    let widthLimit = Math.max(160, screenW - 24);
    for (let step = 0; container && step < 4; step++, container = container.parentElement) {
      const cw = container.clientWidth;
      if (cw >= 180 && cw <= screenW + 12) {
        widthLimit = Math.min(widthLimit, cw - 16);
        break;
      }
    }
    return { maxWidth: Math.max(160, Math.floor(widthLimit)), maxHeight };
  }

  function updateButton() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    const active = mode === 'fit';
    btn.textContent = active ? '한 장 맞춤 ✓' : '한 장 맞춤';
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.title = active
      ? 'PDF 한 페이지 전체가 보이도록 맞춘 상태입니다.'
      : '클릭하면 PDF 한 페이지 전체가 보이도록 맞춥니다.';
    btn.style.background = active ? '#e7f4ff' : '#fff';
    btn.style.borderColor = active ? '#5ca6dd' : '#cbd5e1';
    btn.style.color = active ? '#135e99' : '#34465e';
  }

  function fitPage() {
    if (mode !== 'fit') return;
    const canvas = getPdfCanvas();
    if (!canvas) return;
    if (currentCanvas && canvas !== currentCanvas) restore(currentCanvas);
    currentCanvas = canvas;
    remember(canvas);

    // PDF canvas pixel resolution may be scaled by devicePixelRatio; the
    // width/height RATIO is invariant and represents the actual page shape.
    const ratio = Number(canvas.width) / Number(canvas.height);
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const limits = measureAvailableArea(canvas);
    const w = Math.max(80, Math.floor(Math.min(limits.maxWidth, limits.maxHeight * ratio)));
    const h = Math.max(80, Math.floor(w / ratio));

    for (const [prop, value] of Object.entries({
      width: `${w}px`, height: `${h}px`, 'max-width': '100%',
      'max-height': `${limits.maxHeight}px`, 'margin-left': 'auto',
      'margin-right': 'auto', display: 'block'
    })) canvas.style.setProperty(prop, value, 'important');
    canvas.dataset.kescoFitPage = VERSION;
  }

  function fitSoon() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      if (mode === 'fit') fitPage();
    });
  }

  function turnFitOn() {
    mode = 'fit';
    updateButton();
    fitSoon();
  }
  function turnNativeZoomOn() {
    mode = 'native';
    if (currentCanvas) restore(currentCanvas);
    updateButton();
  }

  function locateWidthButton() {
    return [...document.querySelectorAll('button')].find((b) =>
      /너비\s*맞춤|폭\s*맞춤|fit\s*width/i.test(`${b.textContent || ''} ${b.title || ''} ${b.getAttribute('aria-label') || ''}`)
    ) || null;
  }
  function ensureFitButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const widthButton = locateWidthButton();
    if (!widthButton?.parentElement) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = widthButton.className || '';
    btn.style.cssText = [
      'border:1px solid #5ca6dd', 'border-radius:6px',
      'font:inherit', 'font-weight:700', 'font-size:12px',
      'padding:5px 10px', 'min-height:30px', 'white-space:nowrap',
      'cursor:pointer', 'background:#e7f4ff', 'color:#135e99'
    ].join(';');
    btn.addEventListener('click', (e) => {e.preventDefault(); turnFitOn();});
    widthButton.parentElement.insertBefore(btn, widthButton);
    updateButton();
  }

  // Capture phase: restore the original canvas dimensions BEFORE the hosted
  // viewer's zoom +/- / fit-width button handlers run.
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest?.('button');
    if (!b || b.id === BUTTON_ID) return;
    const label = (b.textContent || '').trim().replace(/\s+/g, ' ');
    const aria = (b.getAttribute('aria-label') || b.getAttribute('title') || '').trim();
    if (USER_SCALE_BUTTON.test(label) || /확대|축소|너비\s*맞춤|fit\s*width/i.test(aria)) {
      turnNativeZoomOn();
    } else if (PAGE_BUTTON.test(label) || /이전\s*페이지|다음\s*페이지|previous\s*page|next\s*page/i.test(aria)) {
      turnFitOn();
    }
  }, true);

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!el || el.tagName !== 'INPUT') return;
    const n = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`;
    if (/page|쪽|페이지/i.test(n) && Number.isFinite(Number(el.value))) turnFitOn();
  }, true);

  // Existing Manual.html sends this message when a chapter/page is selected.
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'KESCO_MANUAL_PDF_GOTO_V377') turnFitOn();
  });

  const observer = new MutationObserver((records) => {
    if (records.some((rec) => rec.type === 'childList')) ensureFitButton();
    // The original PDF.js renderer changes canvas WIDTH/HEIGHT ATTRIBUTES
    // whenever a new page is drawn; style changes made here are NOT observed.
    if (mode === 'fit') fitSoon();
  });
  function start() {
    observer.observe(document.documentElement, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['width', 'height']
    });
    ensureFitButton();
    turnFitOn();
  }
  window.addEventListener('resize', fitSoon, {passive:true});
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitSoon, {passive:true});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
