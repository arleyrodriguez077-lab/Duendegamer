(() => {
  'use strict';

  /* ---------- Configuración ---------- */
  // visible = ms que el duende permanece afuera; gap = pausa entre apariciones
  const NIVELES = {
    facil:   { visible: 2200, gap: 1100 },
    medio:   { visible: 1500, gap: 800 },
    dificil: { visible: 1000, gap: 550 }
  };
  const PROB_DISTRACTOR = 0.25;
  const KEY = 'duendes-atencion-historial';

  /* ---------- Dibujos (SVG) ---------- */
  const SVG_DUENDE = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <polygon points="50,2 28,38 72,38" fill="#d1664b"/>
  <rect x="24" y="36" width="52" height="7" rx="3" fill="#a8452f"/>
  <polygon points="16,60 30,48 30,68" fill="#5aa469"/>
  <polygon points="84,60 70,48 70,68" fill="#5aa469"/>
  <ellipse cx="50" cy="62" rx="26" ry="24" fill="#5aa469"/>
  <circle cx="40" cy="58" r="4.5" fill="#fff"/><circle cx="60" cy="58" r="4.5" fill="#fff"/>
  <circle cx="41" cy="59" r="2.2" fill="#1d3338"/><circle cx="59" cy="59" r="2.2" fill="#1d3338"/>
  <path d="M40 74 Q50 82 60 74" stroke="#1d3338" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`;
  const SVG_HONGO = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <rect x="38" y="52" width="24" height="44" rx="8" fill="#efe6d6"/>
  <path d="M8 56 Q50 -6 92 56 Z" fill="#7d8fc4"/>
  <circle cx="34" cy="38" r="6" fill="#fff"/><circle cx="58" cy="30" r="7" fill="#fff"/>
  <circle cx="72" cy="46" r="5" fill="#fff"/>
</svg>`;

  /* ---------- Elementos ---------- */
  const $ = (s) => document.querySelector(s);
  const screens = { menu: $('#screen-menu'), game: $('#screen-game'), result: $('#screen-result') };
  const board = $('#board');
  const hudTime = $('#hud-time'), hudHits = $('#hud-hits'), hudMissed = $('#hud-missed');
  const statusEl = $('#status');
  const pauseOverlay = $('#pause-overlay');

  /* ---------- Mesa de 9 agujeros ---------- */
  const holes = [];
  for (let i = 0; i < 9; i++) {
    const b = document.createElement('button');
    b.className = 'hole';
    b.type = 'button';
    b.setAttribute('aria-label', 'Agujero ' + (i + 1));
    b.innerHTML = '<div class="pit"><div class="creature"></div></div><div class="mound"></div>';
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); onHole(i); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHole(i); } });
    board.appendChild(b);
    holes.push(b);
  }

  /* ---------- Estado ---------- */
  let st = null;          // estado de la sesión
  let spawnTimer = null, hideTimer = null, clockTimer = null, fxTimer = null;
  let audioCtx = null;

  const rand = (a, b) => a + Math.random() * (b - a);
  function show(name) {
    Object.entries(screens).forEach(([k, el]) => (el.hidden = k !== name));
    window.scrollTo(0, 0);
  }

  /* ---------- Sonido (opcional, suave) ---------- */
  function beep(freq, dur = 0.09) {
    if (!st || !st.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq; g.gain.value = 0.04;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (_) { /* sin audio */ }
  }

  /* ---------- Flujo de la sesión ---------- */
  function start() {
    const nivel = document.querySelector('input[name="nivel"]:checked').value;
    const dur = parseInt(document.querySelector('input[name="duracion"]:checked').value, 10);
    st = {
      nivel, cfg: NIVELES[nivel],
      distractores: $('#opt-distractores').checked,
      sound: $('#opt-sonido').checked,
      timeLeft: dur, total: dur,
      hits: 0, missed: 0, wrong: 0, empty: 0, rts: [],
      current: null, last: -1, running: true, paused: false
    };
    updateHud(); setStatus('Prepárate…');
    show('game');
    clockTimer = setInterval(tick, 1000);
    schedule(1200);
  }

  function tick() {
    if (!st || st.paused) return;
    st.timeLeft--;
    updateHud();
    if (st.timeLeft <= 0) finish();
  }

  function schedule(delay) {
    clearTimeout(spawnTimer);
    spawnTimer = setTimeout(spawn, delay);
  }

  function spawn() {
    if (!st || !st.running || st.paused) return;
    let idx;
    do { idx = Math.floor(Math.random() * 9); } while (idx === st.last);
    st.last = idx;
    const tipo = st.distractores && Math.random() < PROB_DISTRACTOR ? 'hongo' : 'duende';
    holes[idx].querySelector('.creature').innerHTML = tipo === 'duende' ? SVG_DUENDE : SVG_HONGO;
    holes[idx].classList.remove('hit');
    holes[idx].classList.add('up');
    st.current = { idx, tipo, t0: performance.now() };
    hideTimer = setTimeout(() => retreat(), st.cfg.visible);
  }

  // El duende se esconde solo (no fue tocado a tiempo)
  function retreat() {
    if (!st || !st.current) return;
    const { idx, tipo } = st.current;
    holes[idx].classList.remove('up');
    st.current = null;
    if (tipo === 'duende') { st.missed++; setStatus('Se escapó. Sigue atento.'); }
    updateHud();
    schedule(st.cfg.gap + rand(0, 350));
  }

  function onHole(i) {
    if (!st || !st.running || st.paused) return;
    const cur = st.current;
    if (cur && cur.idx === i) {
      clearTimeout(hideTimer);
      st.current = null;
      holes[i].classList.remove('up');
      holes[i].classList.add('hit');
      if (cur.tipo === 'duende') {
        st.hits++; st.rts.push(performance.now() - cur.t0);
        flash(i, 'ok'); setStatus('¡Bien!'); beep(520);
      } else {
        st.wrong++;
        flash(i, 'wrong'); setStatus('Ese era un hongo. No lo toques.'); beep(260, 0.12);
      }
      updateHud();
      schedule(st.cfg.gap + rand(0, 350));
    } else {
      st.empty++;
      flash(i, 'empty');
    }
  }

  function flash(i, cls) {
    holes[i].classList.add(cls);
    setTimeout(() => holes[i].classList.remove(cls), 350);
  }

  /* ---------- Pausa ---------- */
  function pause() {
    if (!st || !st.running || st.paused) return;
    st.paused = true;
    clearTimeout(spawnTimer); clearTimeout(hideTimer);
    if (st.current) { holes[st.current.idx].classList.remove('up'); st.current = null; }
    pauseOverlay.hidden = false;
    $('#btn-resume').focus();
  }
  function resume() {
    if (!st || !st.paused) return;
    st.paused = false;
    pauseOverlay.hidden = true;
    setStatus('Prepárate…');
    schedule(1000);
  }

  /* ---------- Final ---------- */
  function finish() {
    if (!st) return;
    st.running = false;
    clearInterval(clockTimer); clearTimeout(spawnTimer); clearTimeout(hideTimer);
    holes.forEach((h) => h.classList.remove('up', 'hit'));
    pauseOverlay.hidden = true;

    const apariciones = st.hits + st.missed;
    const precision = apariciones ? Math.round((st.hits / apariciones) * 100) : 0;
    const rt = st.rts.length ? Math.round(st.rts.reduce((a, b) => a + b, 0) / st.rts.length) : null;
    const nombres = { facil: 'Tranquilo', medio: 'Medio', dificil: 'Ágil' };

    const filas = [
      ['Aciertos', st.hits],
      ['Se escaparon', st.missed],
      ['Precisión', precision + ' %'],
      ['Tiempo de reacción medio', rt ? (rt / 1000).toFixed(2) + ' s' : '—'],
      ['Toques en agujero vacío', st.empty]
    ];
    if (st.distractores) filas.push(['Hongos tocados', st.wrong]);
    $('#result-stats').innerHTML = filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

    let msg = 'Terminaste una sesión de atención. Eso ya cuenta.';
    if (precision >= 80) msg = 'Muy buena concentración. Si quieres, prueba el siguiente nivel.';
    else if (precision >= 50) msg = 'Buen trabajo. La constancia mejora la atención poco a poco.';
    $('#result-msg').textContent = msg;

    saveHistory({
      fecha: new Date().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }),
      nivel: nombres[st.nivel], hits: st.hits, missed: st.missed, precision, rt
    });
    renderHistory();
    show('result');
  }

  /* ---------- Historial (localStorage) ---------- */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (_) { return []; }
  }
  function saveHistory(item) {
    try {
      const h = loadHistory(); h.unshift(item);
      localStorage.setItem(KEY, JSON.stringify(h.slice(0, 10)));
    } catch (_) { /* sin almacenamiento */ }
  }
  function renderHistory() {
    const h = loadHistory();
    $('#history-list').innerHTML = h.length
      ? h.map((x) => `<li>${x.fecha} · ${x.nivel}: ${x.hits} aciertos, ${x.precision} % de precisión</li>`).join('')
      : '<li>Aún no hay sesiones.</li>';
  }

  /* ---------- Utilidades de interfaz ---------- */
  function updateHud() {
    hudTime.textContent = st.timeLeft;
    hudHits.textContent = st.hits;
    hudMissed.textContent = st.missed;
  }
  function setStatus(t) {
    statusEl.textContent = t;
    clearTimeout(fxTimer);
    fxTimer = setTimeout(() => { statusEl.innerHTML = '&nbsp;'; }, 1400);
  }
  function backToMenu() {
    if (st) { st.running = false; }
    clearInterval(clockTimer); clearTimeout(spawnTimer); clearTimeout(hideTimer);
    holes.forEach((h) => h.classList.remove('up', 'hit'));
    pauseOverlay.hidden = true;
    renderHistory();
    show('menu');
  }

  /* ---------- Eventos ---------- */
  $('#btn-start').addEventListener('click', start);
  $('#btn-pause').addEventListener('click', pause);
  $('#btn-resume').addEventListener('click', resume);
  $('#btn-quit').addEventListener('click', finish);
  $('#btn-again').addEventListener('click', start);
  $('#btn-menu').addEventListener('click', backToMenu);
  $('#btn-clear').addEventListener('click', () => { try { localStorage.removeItem(KEY); } catch (_) {} renderHistory(); });

  // Teclas 1-9 con la disposición del teclado numérico (7 8 9 arriba)
  document.addEventListener('keydown', (e) => {
    if (screens.game.hidden) return;
    if (e.key === 'Escape' || e.key.toLowerCase() === 'p') { st && st.paused ? resume() : pause(); return; }
    if (/^[1-9]$/.test(e.key)) {
      const d = parseInt(e.key, 10) - 1;
      onHole((2 - Math.floor(d / 3)) * 3 + (d % 3));
    }
  });

  renderHistory();
})();
