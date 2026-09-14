// options.js — quick bar (one click away, never modal) + full options menu.
// All options apply live without restarting the trip.

const STYLE = `
  .ad-quick { position: fixed; top: 16px; right: 16px; z-index: 6;
    font-family: system-ui, sans-serif; }
  .ad-quick .toggle { width: 36px; height: 36px; border-radius: 8px; background: rgba(20,24,33,0.7);
    border: 1px solid #2a3244; color: #8a94a4; cursor: pointer; font-size: 16px; }
  .ad-quick .bar { display: none; margin-top: 8px; background: rgba(20,24,33,0.92);
    border: 1px solid #2a3244; border-radius: 10px; padding: 12px; width: 220px;
    color: #c8d0dc; font-size: 12px; }
  .ad-quick.open .bar { display: block; }
  .ad-quick .row { display: flex; justify-content: space-between; align-items: center; margin: 8px 0; }
  .ad-quick .row label { color: #8a94a4; }
  .ad-quick select, .ad-quick input[type=range] { background: #1c2230; color: #c8d0dc;
    border: 1px solid #2a3244; border-radius: 6px; padding: 4px; font-size: 12px; max-width: 120px; }
  .ad-quick .more { margin-top: 10px; width: 100%; padding: 8px; background: #1c2230;
    color: #8a94a4; border: 1px solid #2a3244; border-radius: 6px; cursor: pointer; }
  .ad-quick .close-x { position: absolute; top: 8px; right: 10px; cursor: pointer; color: #5a6474; }
  .ad-more { position: fixed; inset: 0; z-index: 20; display: none;
    font-family: system-ui, sans-serif; }
  .ad-more.open { display: block; }
  .ad-more .backdrop { position: absolute; inset: 0; background: rgba(5,8,12,0.6); }
  .ad-more .panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: min(440px, 92vw); max-height: 80vh; overflow-y: auto; background: #141821;
    border: 1px solid #2a3244; border-radius: 12px; padding: 20px 22px; color: #c8d0dc;
    font-size: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.5); }
  .ad-more h2 { margin: 0 0 4px; font-size: 16px; color: #e8eef8; }
  .ad-more .group { margin-top: 16px; }
  .ad-more .group h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.08em; color: #5a6474; }
  .ad-more .row { display: flex; justify-content: space-between; align-items: center; margin: 8px 0; gap: 12px; }
  .ad-more .row label { color: #8a94a4; flex: 1; }
  .ad-more .row small { display: block; color: #5a6474; font-size: 10px; margin-top: 2px; }
  .ad-more select, .ad-more input[type=range] { background: #1c2230; color: #c8d0dc;
    border: 1px solid #2a3244; border-radius: 6px; padding: 4px; font-size: 12px; max-width: 130px; }
  .ad-more input[type=checkbox] { width: 16px; height: 16px; accent-color: #5aa9ff; }
  .ad-more input[type=color] { width: 44px; height: 26px; border: 1px solid #2a3244;
    border-radius: 6px; background: #1c2230; padding: 2px; cursor: pointer; }
  .ad-more .done { margin-top: 18px; width: 100%; padding: 10px; background: #2a5a8a;
    color: #eaf2ff; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
  .ad-more .done:hover { background: #33689a; }
`;

/**
 * Create the options UI.
 * config: live TripConfig (mutated in place)
 * apply: (key, value) → apply an option live (e.g. weather, volume)
 * Returns { el, destroy, toggle }.
 */
export function createOptions(config, { apply }) {
  if (!document.getElementById('ad-opt-style')) {
    const s = document.createElement('style');
    s.id = 'ad-opt-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const el = document.createElement('div');
  el.className = 'ad-quick';
  el.innerHTML = `
    <button class="toggle" id="ad-opt-toggle" title="Options (O)">⚙</button>
    <div class="bar">
      <span class="close-x" id="ad-opt-close">✕</span>
      <div class="row"><label>Volume</label><input type="range" id="ad-vol" min="0" max="1" step="0.05"></div>
      <div class="row"><label>Sleep</label><select id="ad-sleep"><option value="1">On</option><option value="0">Off</option></select></div>
      <div class="row"><label>Camera</label><select id="ad-cam"><option value="seat">Seat</option><option value="freecam">Freecam</option></select></div>
      <div class="row"><label>Weather</label><select id="ad-wx"></select></div>
      <div class="row"><label>Traffic</label><select id="ad-tr"></select></div>
      <div class="row"><label>Peds</label><select id="ad-peds"><option value="1">Stop</option><option value="0">Ignore</option></select></div>
      <div class="row"><label>Time</label><select id="ad-tod"></select></div>
      <div class="row"><label>Loop</label><select id="ad-loop"><option value="1">On</option><option value="0">Off</option></select></div>
      <div class="row"><label>Audio</label><select id="ad-mode"><option value="headphones">Headphones</option><option value="speakers">Speakers</option></select></div>
      <div class="row"><label>Raytrace</label><select id="ad-rt"><option value="full">Full</option><option value="windows">Windows</option><option value="off">Off</option></select></div>
      <button class="more" id="ad-more">More…</button>
    </div>
  `;
  document.body.appendChild(el);

  const bar = el.querySelector('.bar');
  const toggleBtn = el.querySelector('#ad-opt-toggle');

  function fill(id, items, current) {
    const s = el.querySelector(id);
    for (const it of items) {
      const o = document.createElement('option');
      o.value = String(it);
      o.textContent = String(it);
      s.appendChild(o);
    }
    s.value = String(current);
  }
  fill('#ad-wx', ['random', 'clear', 'overcast', 'rain', 'snow', 'fog'], config.weather);
  fill('#ad-tr', ['light', 'normal', 'heavy'], config.traffic);
  fill('#ad-tod', ['auto', 'dusk', 'night', 'morning'], config.timeOfDay);

  el.querySelector('#ad-vol').value = config.audio.master;
  el.querySelector('#ad-sleep').value = '1';
  el.querySelector('#ad-cam').value = 'seat';
  el.querySelector('#ad-peds').value = config.stopForPedestrians ? '1' : '0';
  el.querySelector('#ad-loop').value = config.loop ? '1' : '0';
  el.querySelector('#ad-mode').value = config.audio.mode;
  el.querySelector('#ad-rt').value = config.audio.raytrace;

  const bind = (id, fn) => { el.querySelector(id).onchange = (e) => fn(e.target.value); };
  bind('#ad-vol', (v) => { config.audio.master = Number(v); apply('master', Number(v)); });
  bind('#ad-sleep', (v) => apply('sleep', v === '1'));
  bind('#ad-cam', (v) => apply('camera', v));
  bind('#ad-wx', (v) => { config.weather = v; apply('weather', v); });
  bind('#ad-tr', (v) => { config.traffic = v; apply('traffic', v); });
  bind('#ad-peds', (v) => { config.stopForPedestrians = v === '1'; apply('peds', v === '1'); });
  bind('#ad-tod', (v) => { config.timeOfDay = v; apply('timeOfDay', v); });
  bind('#ad-loop', (v) => { config.loop = v === '1'; apply('loop', v === '1'); });
  bind('#ad-mode', (v) => { config.audio.mode = v; apply('audioMode', v); });
  bind('#ad-rt', (v) => { config.audio.raytrace = v; apply('raytrace', v); });

  function toggle() {
    el.classList.toggle('open');
  }
  toggleBtn.onclick = (e) => { e.stopPropagation(); toggle(); };
  el.querySelector('#ad-opt-close').onclick = () => el.classList.remove('open');

  // ── Full options menu ("More…") ────────────────────────────────────────
  const more = document.createElement('div');
  more.className = 'ad-more';
  more.innerHTML = `
    <div class="backdrop"></div>
    <div class="panel">
      <h2>Options</h2>
      <div class="group"><h3>Driving</h3>
        <div class="row"><label>Obey speed limits</label><input type="checkbox" id="ad-m-limits"></div>
        <div class="row"><label>Style</label><select id="ad-m-style"><option value="relaxed">Relaxed</option><option value="aggressive">Aggressive</option></select></div>
      </div>
      <div class="group"><h3>Audio</h3>
        <div class="row"><label>Engine volume</label><input type="range" id="ad-m-eng" min="0" max="1" step="0.05"></div>
        <div class="row"><label>Traffic volume</label><input type="range" id="ad-m-trv" min="0" max="1" step="0.05"></div>
        <div class="row"><label>Rain &amp; weather volume</label><input type="range" id="ad-m-rain" min="0" max="1" step="0.05"></div>
        <div class="row"><label>Soft limiter</label><input type="checkbox" id="ad-m-lim"></div>
        <div class="row"><label>Doppler effect</label><input type="checkbox" id="ad-m-dopp"></div>
        <div class="row"><label>Seatbelt creaks</label><input type="checkbox" id="ad-m-belt"></div>
        <div class="row"><label>Cabin sounds (A/C hum)</label><input type="checkbox" id="ad-m-cabin"></div>
        <div class="row"><label>Ambient music</label><select id="ad-m-music"><option value="off">Off</option><option value="very-quiet">Very quiet</option></select></div>
      </div>
      <div class="group"><h3>Visuals</h3>
        <div class="row"><label>Rain-on-glass detail</label><select id="ad-m-rd"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
        <div class="row"><label>Streetlight glow</label><input type="checkbox" id="ad-m-glow"></div>
        <div class="row"><label>Instrument glow</label><select id="ad-m-hud"><option value="off">Off</option><option value="dim">Dim</option><option value="neon">Neon</option></select></div>
        <div class="row"><label>HUD fade (s)<small>0 = never fades</small></label><input type="range" id="ad-m-fade" min="0" max="30" step="2"></div>
        <div class="row"><label>Speed-limit signs</label><input type="checkbox" id="ad-m-signs"></div>
      </div>
      <div class="group"><h3>Car</h3>
        <div class="row"><label>Color</label><input type="color" id="ad-m-color"></div>
        <div class="row"><label>Type<small>applies on the next trip</small></label><select id="ad-m-type"><option value="car">Car</option><option value="van">Van</option></select></div>
      </div>
      <button class="done" id="ad-m-done">Done</button>
    </div>
  `;
  document.body.appendChild(more);

  function openMore() {
    // Refresh values from the live config each time the menu opens.
    more.querySelector('#ad-m-limits').checked = !!config.obeyLimits;
    more.querySelector('#ad-m-style').value = config.style;
    more.querySelector('#ad-m-eng').value = config.audio.engine;
    more.querySelector('#ad-m-trv').value = config.audio.traffic;
    more.querySelector('#ad-m-rain').value = config.audio.rain;
    more.querySelector('#ad-m-lim').checked = !!config.audio.limiter;
    more.querySelector('#ad-m-dopp').checked = !!config.audio.doppler;
    more.querySelector('#ad-m-belt').checked = !!config.audio.seatbelt;
    more.querySelector('#ad-m-cabin').checked = !!config.audio.cabin;
    more.querySelector('#ad-m-music').value = config.misc.music;
    more.querySelector('#ad-m-rd').value = config.visuals.rainDetail;
    more.querySelector('#ad-m-glow').checked = !!config.visuals.lightGlow;
    more.querySelector('#ad-m-hud').value = config.visuals.hudGlow;
    more.querySelector('#ad-m-fade').value = config.visuals.hudFade;
    more.querySelector('#ad-m-signs').checked = !!config.visuals.signs;
    more.querySelector('#ad-m-color').value = config.misc.carColor;
    more.querySelector('#ad-m-type').value = config.misc.carType;
    more.classList.add('open');
  }
  function closeMore() { more.classList.remove('open'); }

  const mbind = (id, fn) => { more.querySelector(id).onchange = (e) => fn(e.target); };
  mbind('#ad-m-limits', (t) => { config.obeyLimits = t.checked; apply('obeyLimits', t.checked); });
  mbind('#ad-m-style', (t) => { config.style = t.value; apply('style', t.value); });
  mbind('#ad-m-eng', (t) => { config.audio.engine = Number(t.value); apply('engineVol', Number(t.value)); });
  mbind('#ad-m-trv', (t) => { config.audio.traffic = Number(t.value); apply('trafficVol', Number(t.value)); });
  mbind('#ad-m-rain', (t) => { config.audio.rain = Number(t.value); apply('rainVol', Number(t.value)); });
  mbind('#ad-m-lim', (t) => { config.audio.limiter = t.checked; apply('limiter', t.checked); });
  mbind('#ad-m-dopp', (t) => { config.audio.doppler = t.checked; apply('doppler', t.checked); });
  mbind('#ad-m-belt', (t) => { config.audio.seatbelt = t.checked; apply('seatbelt', t.checked); });
  mbind('#ad-m-cabin', (t) => { config.audio.cabin = t.checked; apply('cabin', t.checked); });
  mbind('#ad-m-music', (t) => { config.misc.music = t.value; apply('music', t.value); });
  mbind('#ad-m-rd', (t) => { config.visuals.rainDetail = t.value; apply('rainDetail', t.value); });
  mbind('#ad-m-glow', (t) => { config.visuals.lightGlow = t.checked; apply('lightGlow', t.checked); });
  mbind('#ad-m-hud', (t) => { config.visuals.hudGlow = t.value; apply('hudGlow', t.value); });
  mbind('#ad-m-fade', (t) => { config.visuals.hudFade = Number(t.value); apply('hudFade', Number(t.value)); });
  mbind('#ad-m-signs', (t) => { config.visuals.signs = t.checked; apply('signs', t.checked); });
  mbind('#ad-m-color', (t) => { config.misc.carColor = t.value; apply('carColor', t.value); });
  mbind('#ad-m-type', (t) => { config.misc.carType = t.value; apply('carType', t.value); });

  el.querySelector('#ad-more').onclick = (e) => { e.stopPropagation(); openMore(); };
  more.querySelector('.backdrop').onclick = closeMore;
  more.querySelector('#ad-m-done').onclick = closeMore;
  more.addEventListener('click', (e) => e.stopPropagation());

  // Close on click-away.
  const onDocClick = (e) => {
    if (!el.contains(e.target)) el.classList.remove('open');
  };
  document.addEventListener('click', onDocClick);

  // Keyboard: O toggles.
  const onKey = (e) => {
    if (e.key === 'o' || e.key === 'O') toggle();
    if (e.key === 'Escape') { el.classList.remove('open'); closeMore(); }
  };
  window.addEventListener('keydown', onKey);

  function destroy() {
    document.removeEventListener('click', onDocClick);
    window.removeEventListener('keydown', onKey);
    el.remove();
    more.remove();
  }

  return { el, toggle, destroy };
}
