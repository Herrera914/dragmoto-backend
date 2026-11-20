/* ══ TeleChart: gráfica de telemetría en canvas (estilo Telemetría avanzada de la app) ══
 * Canales apilados en franjas, cada uno con su escala, eje de tiempo común,
 * marcas de 100 m / ⅛ / ¼, cursor con lectura de todos los canales y selector
 * de canales. Sirve en vivo (push) y para carreras guardadas (setSeries).
 */
(function (global) {
  'use strict';

  var CHANNELS = [
    { id: 'speed', name: 'Velocidad', unit: 'km/h', color: '#ff3b5c', dec: 1, min: 0, span: 60 },
    { id: 'rpm',   name: 'RPM',       unit: 'rpm',  color: '#ff7a1a', dec: 0, min: 0, span: 4000 },
    { id: 'g',     name: 'G long.',   unit: 'G',    color: '#2bb8ff', dec: 2, span: 0.4 },
    { id: 'dist',  name: 'Distancia', unit: 'm',    color: '#19e68c', dec: 0, min: 0, span: 50 },
    { id: 'adv',   name: 'Avance',    unit: '°',    color: '#ffe14d', dec: 1, span: 10 },
    { id: 'volts', name: 'Voltaje',   unit: 'V',    color: '#b18cff', dec: 1, span: 2 }
  ];
  var BY_ID = {};
  CHANNELS.forEach(function (c) { BY_ID[c.id] = c; });
  var DEFAULT = ['speed', 'rpm', 'g', 'dist'];   // los mismos de la app
  var GAP_S = 3;                                 // sin datos más de 3 s: se corta la línea
  var STORE = 'dm_tele_ch';

  function loadSel() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (Array.isArray(v) && v.length) return v.filter(function (id) { return BY_ID[id]; });
    } catch (_) {}
    return DEFAULT.slice();
  }
  function saveSel(sel) { try { localStorage.setItem(STORE, JSON.stringify(sel)); } catch (_) {} }

  /* paso "redondo" para ejes */
  function niceStep(range, target) {
    var raw = range / Math.max(target, 1), p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
  }
  function fmt(v, dec) {
    return v.toLocaleString('es', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  /* valor interpolado en t (null si cae en un hueco o fuera de los datos) */
  function valueAt(pts, t) {
    if (!pts.length || t < pts[0][0] || t > pts[pts.length - 1][0]) return null;
    var lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (pts[m][0] <= t) lo = m; else hi = m; }
    var a = pts[lo], b = pts[hi];
    if (b[0] - a[0] > GAP_S) return null;
    if (b[0] === a[0]) return a[1];
    return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
  }

  function create(canvas, chipsEl, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var data = {};            // id -> [[t, v], ...]
    CHANNELS.forEach(function (c) { data[c.id] = []; });
    var sel = loadSel();
    var markers = [];         // { t, label, color }
    var windowS = opts.window || null;   // null = toda la serie; número = últimos N s
    var cursorT = null;
    var dirty = true, W = 0, H = 0, dpr = 1;
    var PAD_L = 8, PAD_R = 8, AXIS_H = 22;
    var chipEls = {};

    /* ── selector de canales ── */
    function buildChips() {
      if (!chipsEl) return;
      chipsEl.innerHTML = '';
      CHANNELS.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tc-chip';
        b.style.setProperty('--c', c.color);
        b.setAttribute('aria-pressed', sel.indexOf(c.id) >= 0);
        b.innerHTML = '<i></i><span class="n">' + c.name + '</span><b class="v">--</b>';
        b.onclick = function () {
          var i = sel.indexOf(c.id);
          if (i >= 0) { if (sel.length > 1) sel.splice(i, 1); }
          else sel = CHANNELS.map(function (x) { return x.id; }).filter(function (id) { return id === c.id || sel.indexOf(id) >= 0; });
          saveSel(sel);
          Object.keys(chipEls).forEach(function (id) { chipEls[id].setAttribute('aria-pressed', sel.indexOf(id) >= 0); });
          if (opts.onLanes) opts.onLanes(sel.length);
          dirty = true;
        };
        chipsEl.appendChild(b);
        chipEls[c.id] = b;
      });
      if (opts.onLanes) opts.onLanes(sel.length);
    }

    /* ── tamaño (nítido en pantallas de alta densidad) ── */
    function resize() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(r.width, 10); H = Math.max(r.height, 10);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      dirty = true;
    }
    if (global.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);

    function tRange() {
      var tMin = Infinity, tMax = -Infinity;
      CHANNELS.forEach(function (c) {
        var p = data[c.id];
        if (p.length) { tMin = Math.min(tMin, p[0][0]); tMax = Math.max(tMax, p[p.length - 1][0]); }
      });
      if (tMax === -Infinity) return [0, 10];
      if (windowS) return [Math.max(tMin, tMax - windowS), Math.max(tMax, tMin + 5)];
      return [tMin, Math.max(tMax, tMin + 5)];
    }

    function draw() {
      dirty = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var tr = tRange(), t0 = tr[0], t1 = tr[1];
      var plotW = W - PAD_L - PAD_R, n = sel.length, laneH = (H - AXIS_H) / n;
      var x = function (t) { return PAD_L + (t - t0) / (t1 - t0) * plotW; };

      /* eje de tiempo y cuadrícula vertical */
      var st = niceStep(t1 - t0, Math.max(3, Math.floor(plotW / 90)));
      ctx.font = '11px "Share Tech Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      for (var tt = Math.ceil(t0 / st) * st; tt <= t1 + 1e-9; tt += st) {
        var gx = x(tt);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H - AXIS_H); ctx.stroke();
        ctx.fillStyle = '#5c6278';
        ctx.fillText(fmt(tt, st < 1 ? 1 : 0) + ' s', gx, H - 6);
      }

      var readout = {};
      sel.forEach(function (id, li) {
        var c = BY_ID[id], pts = data[id], top = li * laneH, bot = top + laneH;
        var inner = { top: top + 18, bot: bot - 6 };
        /* separador de franja */
        if (li > 0) { ctx.strokeStyle = '#222839'; ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(W, top + 0.5); ctx.stroke(); }

        /* escala de la franja según lo visible */
        var lo = Infinity, hi = -Infinity;
        for (var i = 0; i < pts.length; i++) {
          var p = pts[i];
          if (p[0] < t0 - GAP_S || p[0] > t1 + GAP_S) continue;
          if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1];
        }
        if (lo === Infinity) { lo = c.min != null ? c.min : 0; hi = lo + c.span; }
        if (c.min != null) lo = Math.min(c.min, lo);
        if (hi - lo < c.span) { var mid = (hi + lo) / 2; if (c.min != null && lo === c.min) hi = lo + c.span; else { lo = mid - c.span / 2; hi = mid + c.span / 2; } }
        var padv = (hi - lo) * 0.08; hi += padv; if (c.min == null || lo > c.min) lo -= padv;
        var y = function (v) { return inner.bot - (v - lo) / (hi - lo) * (inner.bot - inner.top); };

        /* línea de cero para G */
        if (lo < 0 && hi > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(PAD_L, y(0)); ctx.lineTo(W - PAD_R, y(0)); ctx.stroke(); ctx.setLineDash([]);
        }

        /* nombre, máximo y mínimo de la escala */
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.font = '600 12px Rajdhani, sans-serif'; ctx.fillStyle = c.color;
        ctx.fillText(c.name.toUpperCase() + '  ·  ' + c.unit, PAD_L + 2, top + 4);
        ctx.textAlign = 'right'; ctx.font = '10px "Share Tech Mono", monospace'; ctx.fillStyle = '#5c6278';
        ctx.fillText(fmt(hi, c.dec > 1 ? 1 : 0), W - PAD_R, top + 4);
        ctx.textBaseline = 'bottom';
        ctx.fillText(fmt(lo, c.dec > 1 ? 1 : 0), W - PAD_R, bot - 2);

        /* curva, cortada en los huecos */
        if (pts.length) {
          ctx.save();
          ctx.beginPath(); ctx.rect(PAD_L, top, plotW, laneH); ctx.clip();
          ctx.strokeStyle = c.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
          ctx.beginPath();
          var started = false, prev = null;
          for (var k = 0; k < pts.length; k++) {
            var q = pts[k];
            if (q[0] < t0 - GAP_S) { prev = q; continue; }
            if (q[0] > t1 + GAP_S) break;
            if (!started || (prev && q[0] - prev[0] > GAP_S)) ctx.moveTo(x(q[0]), y(q[1]));
            else ctx.lineTo(x(q[0]), y(q[1]));
            started = true; prev = q;
          }
          ctx.stroke();
          ctx.restore();
          /* punto del último dato (en vivo) */
          var last = pts[pts.length - 1];
          if (cursorT === null && last[0] >= t0 && last[0] <= t1) {
            ctx.fillStyle = c.color; ctx.shadowColor = c.color; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(x(last[0]), y(last[1]), 3.2, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
          }
        }

        /* lectura: en el cursor o el último valor */
        var v = cursorT !== null ? valueAt(pts, cursorT) : (pts.length ? pts[pts.length - 1][1] : null);
        readout[id] = v;
        if (cursorT !== null && v !== null) {
          ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(x(cursorT), y(v), 3.5, 0, Math.PI * 2); ctx.fill();
        }
      });

      /* marcas de distancia */
      markers.forEach(function (m) {
        if (m.t < t0 || m.t > t1) return;
        var mx = x(m.t);
        ctx.strokeStyle = m.color; ctx.globalAlpha = 0.7; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H - AXIS_H); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.font = '700 11px "Share Tech Mono", monospace'; ctx.fillStyle = m.color; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(m.label, mx, 3);
      });

      /* cursor */
      if (cursorT !== null) {
        var cx = x(cursorT);
        ctx.strokeStyle = '#ff3b5c'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H - AXIS_H); ctx.stroke();
        var lbl = fmt(cursorT, 2) + ' s';
        ctx.font = '700 11px "Share Tech Mono", monospace';
        var tw = ctx.measureText(lbl).width + 10, bx = Math.min(Math.max(cx - tw / 2, 0), W - tw);
        ctx.fillStyle = '#ff3b5c'; ctx.fillRect(bx, H - AXIS_H + 2, tw, 16);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(lbl, bx + tw / 2, H - AXIS_H + 10);
      }

      /* valores en los chips */
      CHANNELS.forEach(function (c) {
        var el = chipEls[c.id] && chipEls[c.id].querySelector('.v');
        if (!el) return;
        var v = sel.indexOf(c.id) >= 0 ? readout[c.id] : (data[c.id].length ? (cursorT !== null ? valueAt(data[c.id], cursorT) : data[c.id][data[c.id].length - 1][1]) : null);
        el.textContent = v === null || v === undefined ? '--' : fmt(v, c.dec);
      });
    }

    function loop() { if (dirty && W) draw(); requestAnimationFrame(loop); }

    /* ── cursor con mouse o dedo ── */
    function tAtClient(clientX) {
      var r = canvas.getBoundingClientRect(), tr = tRange();
      var f = (clientX - r.left - PAD_L) / (r.width - PAD_L - PAD_R);
      return tr[0] + Math.min(Math.max(f, 0), 1) * (tr[1] - tr[0]);
    }
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || e.buttons) { cursorT = tAtClient(e.clientX); dirty = true; } });
    canvas.addEventListener('pointerdown', function (e) { cursorT = tAtClient(e.clientX); dirty = true; });
    canvas.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { cursorT = null; dirty = true; } });
    canvas.addEventListener('dblclick', function () { cursorT = null; dirty = true; });

    buildChips();
    resize();
    requestAnimationFrame(loop);

    return {
      /** agrega un punto en vivo */
      push: function (id, t, v) {
        if (!data[id] || v === null || v === undefined || !isFinite(v)) return;
        var p = data[id];
        if (p.length && t < p[p.length - 1][0]) return;   // fuera de orden
        p.push([t, v]);
        if (p.length > 20000) p.splice(0, p.length - 20000);
        dirty = true;
      },
      /** reemplaza todo (carrera guardada): { speed: [[t,v],...], ... } */
      setSeries: function (series) {
        CHANNELS.forEach(function (c) { data[c.id] = (series && series[c.id]) ? series[c.id].slice() : []; });
        cursorT = null; dirty = true;
      },
      /** nuevo cero de tiempo (salida): conserva los últimos `keep` s previos */
      rebase: function (tZero, keep) {
        CHANNELS.forEach(function (c) {
          data[c.id] = data[c.id].filter(function (p) { return p[0] >= tZero - (keep || 0); })
                                 .map(function (p) { return [p[0] - tZero, p[1]]; });
        });
        markers = []; cursorT = null; dirty = true;
      },
      clear: function () { CHANNELS.forEach(function (c) { data[c.id] = []; }); markers = []; cursorT = null; dirty = true; },
      addMarker: function (t, label, color) { markers.push({ t: t, label: label, color: color }); dirty = true; },
      setWindow: function (s) { if (windowS !== s) { windowS = s; dirty = true; } },
      hasData: function (id) { return data[id].length > 0; },
      lanes: function () { return sel.length; },
      redraw: function () { dirty = true; }
    };
  }

  global.TeleChart = { create: create, CHANNELS: CHANNELS };
})(window);
