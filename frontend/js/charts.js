/* charts.js — jauge de probabilité et graphiques en barres, en SVG natif (aucune bibliothèque).
   Expose l'objet global `Charts` : { fmt, reducedMotion, renderGauge, renderBars, watchResize }. */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Vrai si l'utilisateur demande moins de mouvement : les animations sont alors coupées. */
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Formatage français ----------
  const NBSP = ' ';
  const fmt = {
    num(x, d = 0) {
      return x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    pct(x, d = 1) {
      return this.num(x * 100, d) + NBSP + '%';
    },
    /** Nombre signé avec un vrai signe moins typographique (−), pour les contributions SHAP. */
    signed(x, d = 2) {
      const sign = x > 0 ? '+' : x < 0 ? '−' : '';
      return sign + this.num(Math.abs(x), d);
    },
  };

  function svgEl(name, attrs = {}, text) {
    const el = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text !== undefined) el.textContent = text;
    return el;
  }

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  // ---------- Jauge circulaire (270°, ouverte en bas) ----------
  const G = { size: 220, r: 88, stroke: 16, start: 135, sweep: 270 };

  /** Point sur le cercle à un angle donné (degrés, sens horaire depuis l'axe x). */
  function polar(radius, deg) {
    const rad = (deg * Math.PI) / 180;
    return { x: G.size / 2 + radius * Math.cos(rad), y: G.size / 2 + radius * Math.sin(rad) };
  }

  /**
   * Dessine ou met à jour une jauge dans `container`.
   * Si elle existe déjà, elle s'anime depuis sa valeur précédente (utile pour la démo interactive).
   * opts : { probability, threshold, zone: 'low'|'limit'|'high'|'none', duration, ariaLabel, placeholder }
   *   placeholder : jauge vide affichant « — » (valeur indisponible, ex. API hors ligne)
   */
  function renderGauge(container, opts) {
    const { probability, threshold, zone, duration = 600, ariaLabel, placeholder = false } = opts;
    const circ = 2 * Math.PI * G.r;
    const arc = (G.sweep / 360) * circ;
    const target = Math.max(0, Math.min(1, probability));

    if (!container._gauge) {
      const svg = svgEl('svg', { viewBox: `0 0 ${G.size} ${G.size}`, role: 'img' });
      const ring = svgEl('g', { transform: `rotate(${G.start} ${G.size / 2} ${G.size / 2})` });
      const common = { cx: G.size / 2, cy: G.size / 2, r: G.r, fill: 'none', 'stroke-width': G.stroke, 'stroke-linecap': 'round' };
      const track = svgEl('circle', { ...common, class: 'gauge__track', 'stroke-dasharray': `${arc} ${circ}` });
      const progress = svgEl('circle', { ...common, class: 'gauge__progress', 'stroke-dasharray': `0 ${circ}` });
      ring.append(track, progress);

      const tick = svgEl('line', { class: 'gauge__tick', 'stroke-width': 3, 'stroke-linecap': 'round' });
      const value = svgEl('text', { class: 'gauge__value', x: G.size / 2, y: 118, 'text-anchor': 'middle' }, '');
      const caption = svgEl('text', { class: 'gauge__caption', x: G.size / 2, y: 144, 'text-anchor': 'middle' }, 'probabilité de défaut');
      svg.append(ring, tick, value, caption);

      container.replaceChildren(svg);
      container.classList.add('gauge');
      container._gauge = { svg, progress, tick, value, current: 0, raf: 0 };
    }

    const g = container._gauge;
    container.dataset.zone = zone;
    g.svg.setAttribute('aria-label', placeholder ? 'Probabilité de défaut indisponible' : (ariaLabel || `Probabilité de défaut ${fmt.pct(target)}`));

    // Repère du seuil : trait qui traverse l'anneau à la position du seuil
    const a = G.start + threshold * G.sweep;
    const p1 = polar(G.r - 15, a);
    const p2 = polar(G.r + 15, a);
    g.tick.setAttribute('x1', p1.x); g.tick.setAttribute('y1', p1.y);
    g.tick.setAttribute('x2', p2.x); g.tick.setAttribute('y2', p2.y);

    const draw = (v) => {
      g.progress.setAttribute('stroke-dasharray', `${v * arc} ${circ}`);
      g.progress.style.opacity = v < 0.004 ? 0 : 1;   // évite le point résiduel à 0 %
      g.value.textContent = placeholder ? '—' : fmt.pct(v);
    };

    cancelAnimationFrame(g.raf);
    const from = g.current;
    g.current = target;
    if (reducedMotion() || duration <= 0) { draw(target); return; }

    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      draw(from + (target - from) * easeOutCubic(t));
      if (t < 1) g.raf = requestAnimationFrame(step);
    };
    g.raf = requestAnimationFrame(step);
  }

  // ---------- Barres horizontales ----------
  /**
   * Barres horizontales. Deux dispositions selon la largeur disponible :
   *  - large (>= 700 px) : libellés dans une colonne à gauche, barres à droite sur la même ligne ;
   *  - étroite (mobile)  : libellé au-dessus de chaque barre, lisible sans défilement horizontal.
   * items : [{ label, sublabel, tag, value, valueText, tooltip }]
   * opts  : { mode: 'diverging' | 'magnitude', animate: bool, ariaLabel }
   *  - diverging : autour d'un axe central ; valeur > 0 vers la droite (hausse du risque), < 0 vers la gauche.
   *  - magnitude : à partir de la gauche, longueur proportionnelle à la valeur.
   */
  function renderBars(container, items, opts = {}) {
    const { mode = 'diverging', animate = true, ariaLabel = '' } = opts;
    const W = Math.max(280, Math.floor(container.clientWidth || 640));
    const side = W >= 700;
    const labelW = side ? Math.min(320, Math.round(W * 0.42)) : 0;   // colonne des libellés
    const rowH = side ? 44 : 56;
    const H = items.length * rowH + 4;
    const maxAbs = Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
    const still = !animate || reducedMotion();

    const diverging = mode === 'diverging';
    const plotW = W - labelW;                          // largeur de la zone de tracé
    const x0 = diverging ? labelW + plotW / 2 : labelW;
    const room = 64;                                   // place réservée à l'étiquette de valeur
    const scale = ((diverging ? plotW / 2 : plotW) - room) / maxAbs;

    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': ariaLabel });

    if (diverging) svg.append(svgEl('line', { class: 'chart__axis', x1: x0, y1: 0, x2: x0, y2: H }));

    items.forEach((it, i) => {
      const y = i * rowH;
      const len = Math.max(2, Math.abs(it.value) * scale);
      const positive = it.value >= 0;
      const g = svgEl('g');
      g.append(svgEl('title', {}, it.tooltip || `${it.label} : ${it.valueText}`));

      // Ligne de libellé : nom de la variable, valeur du client en gris, et étiquette (flèche) à droite
      const textY = y + (side ? 26 : 16);
      const label = svgEl('text', { x: 0, y: textY }, it.label);
      if (it.sublabel) label.append(svgEl('tspan', { class: 'chart__muted', dx: 6 }, it.sublabel));
      g.append(label);
      if (it.tag) g.append(svgEl('text', { class: 'chart__muted', x: side ? labelW - 12 : W, y: textY, 'text-anchor': 'end' }, it.tag));

      // Barre (centrée sur la ligne du libellé en disposition large)
      const barY = y + (side ? 14 : 26);
      const cls = diverging ? (positive ? 'bar bar--pos' : 'bar bar--neg') : 'bar bar--neutral';
      const bx = diverging && !positive ? x0 - len : x0;
      const bar = svgEl('rect', { class: cls + (still ? ' bar--still' : ''), x: bx, y: barY, width: len, height: 12, rx: 4 });
      if (!still) bar.style.animationDelay = `${i * 60}ms`;
      g.append(bar);

      // Valeur au bout de la barre
      const vx = diverging && !positive ? bx - 8 : bx + len + 8;
      g.append(svgEl('text', { class: 'chart__value', x: vx, y: barY + 11, 'text-anchor': diverging && !positive ? 'end' : 'start' }, it.valueText));
      svg.append(g);
    });

    container.replaceChildren(svg);
    container._barsWidth = W;
  }

  /** Redessine un graphique quand sa largeur change (sans rejouer l'animation). */
  function watchResize(container, redraw) {
    if (!('ResizeObserver' in window)) return;
    let timer = 0;
    new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (container.clientWidth && Math.abs(container.clientWidth - (container._barsWidth || 0)) > 8) redraw();
      }, 150);
    }).observe(container);
  }

  global.Charts = { fmt, reducedMotion, renderGauge, renderBars, watchResize };
})(window);
