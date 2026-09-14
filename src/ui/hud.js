// hud.js — in-ride HUD: speed, time, ETA, next street, speed-limit icon.
// Fades to 0 after N s idle; reappears on mouse move. Sleep mode hides it fully.

const STYLE = `
  .ad-hud { position: fixed; top: 16px; left: 16px; z-index: 5; pointer-events: none;
    font-family: system-ui, sans-serif; color: #c8d0dc; opacity: 1;
    transition: opacity 1.2s ease; text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
  .ad-hud.hidden { opacity: 0; }
  .ad-hud .speed { font-size: 40px; font-weight: 300; line-height: 1; }
  .ad-hud .speed small { font-size: 14px; color: #7a8494; }
  .ad-hud .row { font-size: 12px; color: #8a94a4; margin-top: 6px; }
  .ad-hud .limit { display: inline-block; width: 30px; height: 30px; border-radius: 50%;
    background: #fff; color: #111; border: 3px solid #d02020; font-weight: 700;
    font-size: 13px; line-height: 24px; text-align: center; margin-right: 6px;
    vertical-align: middle; }
`;

/**
 * Create the HUD.
 * Returns { el, update(state), setSleep(on), destroy }.
 * state: { speedKmh, clockHours, etaMin, nextStreet, limitKmh }
 */
export function createHud(config) {
  if (!document.getElementById('ad-hud-style')) {
    const s = document.createElement('style');
    s.id = 'ad-hud-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const el = document.createElement('div');
  el.className = 'ad-hud';
  el.innerHTML = `
    <div class="speed"><span id="ad-hud-speed">0</span> <small>km/h</small></div>
    <div class="row"><span class="limit" id="ad-hud-limit">50</span><span id="ad-hud-next"></span></div>
    <div class="row" id="ad-hud-eta"></div>
    <div class="row" id="ad-hud-time"></div>
  `;
  document.body.appendChild(el);

  const speedEl = el.querySelector('#ad-hud-speed');
  const limitEl = el.querySelector('#ad-hud-limit');
  const nextEl = el.querySelector('#ad-hud-next');
  const etaEl = el.querySelector('#ad-hud-eta');
  const timeEl = el.querySelector('#ad-hud-time');

  let fadeTimer = null;
  let sleep = false;
  let fadeSec = (config.visuals?.hudFade ?? 10);

  function wake() {
    if (sleep) return;
    el.classList.remove('hidden');
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => el.classList.add('hidden'), fadeSec * 1000);
  }

  /** Live-apply the HUD fade time (seconds). */
  function setFade(sec) {
    fadeSec = Math.max(2, Number(sec) || 10);
    if (!sleep) wake(); // restart the timer with the new fade
  }

  function setSleep(on) {
    sleep = on;
    if (on) { el.classList.add('hidden'); if (fadeTimer) clearTimeout(fadeTimer); }
    else wake();
  }

  function update(state) {
    speedEl.textContent = Math.round(state.speedKmh);
    limitEl.textContent = Math.round(state.limitKmh);
    nextEl.textContent = state.nextStreet || '';
    etaEl.textContent = state.etaMin != null ? `ETA ${Math.round(state.etaMin)} min` : '';
    const h = Math.floor(state.clockHours);
    const m = Math.floor((state.clockHours - h) * 60);
    timeEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Reappear on mouse move.
  const onMove = () => wake();
  window.addEventListener('mousemove', onMove);

  function destroy() {
    window.removeEventListener('mousemove', onMove);
    el.remove();
    if (fadeTimer) clearTimeout(fadeTimer);
  }

  return { el, update, setSleep, setFade, wake, destroy };
}
