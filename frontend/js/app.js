/* app.js — logique du site : appels à l'API, formulaire, démo de l'accueil, rendu des résultats.
   Une seule page est active à la fois : elle est identifiée par <body data-page="home|tool|model">. */
(function () {
  'use strict';

  const { fmt } = Charts;
  const NBSP = ' ';

  // ==========================================================================
  // 1. Configuration et constantes
  // ==========================================================================
  const CONFIG = Object.assign({ API_URL: 'http://localhost:8000', GITHUB_URL: '' }, window.APP_CONFIG || {});
  const API_URL = String(CONFIG.API_URL).replace(/\/+$/, '');

  // Taux de conversion FIXES et INDICATIFS (unités de devise pour 1 USD), affichage uniquement.
  // Le modèle a été entraîné sur des revenus en USD : toute valeur saisie dans une autre devise
  // est TOUJOURS reconvertie en USD avant l'appel à l'API.
  const CURRENCIES = {
    USD: { rate: 1, symbol: '$' },
    EUR: { rate: 0.92, symbol: '€' },
    MAD: { rate: 9.5, symbol: 'MAD' },
  };

  const DEFAULT_MARGIN = 0.10;   // « zone limite » : à moins de 10 points du seuil (valeur réelle fournie par /model-info)

  // Libellés lisibles des variables du modèle (noms techniques -> français)
  const FEATURE_LABELS = {
    RevolvingUtilizationOfUnsecuredLines: 'Utilisation du crédit renouvelable',
    age: 'Âge',
    DebtRatio: "Taux d'endettement",
    MonthlyIncome: 'Revenu mensuel',
    NumberOfOpenCreditLinesAndLoans: 'Crédits et lignes ouverts',
    'NumberOfTime30-59DaysPastDueNotWorse': 'Retards de 30-59 jours',
    NumberOfTimes90DaysLate: 'Retards de 90 jours et plus',
    NumberRealEstateLoansOrLines: 'Prêts immobiliers',
    'NumberOfTime60-89DaysPastDueNotWorse': 'Retards de 60-89 jours',
    NumberOfDependents: 'Personnes à charge',
    total_delinquency: 'Total des retards de paiement',
    income_per_dependent: 'Revenu par personne du foyer',
    total_credit_lines: 'Total des lignes de crédit',
    has_sentinel_delinquency: "Code d'erreur dans les retards (96/98)",
    income_was_missing: 'Revenu non renseigné',
    dependents_was_missing: 'Personnes à charge non renseignées',
    debtratio_extreme: "Taux d'endettement extrême",
    revolving_extreme: 'Utilisation du crédit extrême',
    has_real_estate_loan: 'Possède un prêt immobilier',
    'age_group_30-40': "Tranche d'âge 30-40 ans",
    'age_group_40-50': "Tranche d'âge 40-50 ans",
    'age_group_50-60': "Tranche d'âge 50-60 ans",
    'age_group_60+': "Tranche d'âge 60 ans et plus",
  };
  const BINARY_FEATURES = new Set([
    'has_sentinel_delinquency', 'income_was_missing', 'dependents_was_missing', 'debtratio_extreme',
    'revolving_extreme', 'has_real_estate_loan', 'age_group_30-40', 'age_group_40-50', 'age_group_50-60', 'age_group_60+',
  ]);
  const PERCENT_FEATURES = new Set(['RevolvingUtilizationOfUnsecuredLines', 'DebtRatio']);
  const MONEY_FEATURES = new Set(['MonthlyIncome', 'income_per_dependent']);

  // Profil standard, en USD : sert de base à la démo de l'accueil et aux exemples de l'outil
  const STANDARD_CLIENT = {
    RevolvingUtilizationOfUnsecuredLines: 0.30, age: 45, 'NumberOfTime30-59DaysPastDueNotWorse': 0, DebtRatio: 0.35,
    MonthlyIncome: 5400, NumberOfOpenCreditLinesAndLoans: 8, NumberOfTimes90DaysLate: 0,
    NumberRealEstateLoansOrLines: 1, 'NumberOfTime60-89DaysPastDueNotWorse': 0, NumberOfDependents: 0,
  };

  // ==========================================================================
  // 2. Utilitaires
  // ==========================================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Appel à l'API avec délai maximal. Lève une exception si l'API est injoignable. */
  async function api(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(API_URL + path, { ...options, signal: controller.signal });
      let data = null;
      try { data = await res.json(); } catch (_) { /* réponse sans corps JSON */ }
      return { ok: res.ok, status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  const postJson = (path, body) =>
    api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // /model-info est demandé une seule fois par page (null si indisponible)
  let infoPromise = null;
  function getInfo() {
    if (!infoPromise) infoPromise = api('/model-info').then((r) => (r.ok ? r.data : null)).catch(() => null);
    return infoPromise;
  }

  /** Zone de risque selon la distance au seuil : faible, limite (autour du seuil) ou élevée. */
  function zoneOf(probability, threshold, margin) {
    if (Math.abs(probability - threshold) <= margin) return 'limit';
    return probability < threshold ? 'low' : 'high';
  }
  const ZONE_LABELS = { low: 'Risque faible', limit: 'Zone limite', high: 'Risque élevé' };

  const ICON_OK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5"/></svg>';
  const ICON_NO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  function setBadge(el, refused) {
    el.className = 'badge ' + (refused ? 'badge--danger' : 'badge--success');
    el.innerHTML = (refused ? ICON_NO : ICON_OK) + '<span>' + (refused ? 'Refusé' : 'Accordé') + '</span>';
  }

  function decisionSentence(refused, probability, threshold) {
    return refused
      ? `Crédit refusé : la probabilité de défaut (${fmt.pct(probability)}) atteint ou dépasse le seuil de ${fmt.pct(threshold, 0)}.`
      : `Crédit accordé : la probabilité de défaut (${fmt.pct(probability)}) est inférieure au seuil de ${fmt.pct(threshold, 0)}.`;
  }

  // Descriptions des indicateurs, calculées à partir des vrais chiffres (jamais écrites en dur)
  const METRIC_DESCRIPTIONS = {
    average_precision: (m, info) =>
      `Qualité du classement des défauts, métrique principale. Un modèle au hasard obtiendrait ${fmt.num(info.test.default_rate, 3)}.`,
    roc_auc: () => "Probabilité qu'un client en défaut reçoive un score plus élevé qu'un client sain.",
    recall: (m) => `Sur 100 clients qui font défaut, environ ${Math.round(m.value * 100)} sont repérés.`,
    precision: (m) => `Sur 100 clients refusés, environ ${Math.round(m.value * 100)} auraient réellement fait défaut.`,
  };

  /** Remplit une tuile d'indicateur [data-metric] à partir de /model-info. */
  function fillMetricTile(tile, info) {
    const key = tile.dataset.metric;
    const m = info.test.metrics[key];
    const format = (x) => (tile.dataset.format === 'pct' ? fmt.pct(x, 1) : fmt.num(x, 3));
    $('[data-role="value"]', tile).textContent = format(m.value);
    $('[data-role="ci"]', tile).textContent = `IC 95 %${NBSP}: ${format(m.ci_low)} – ${format(m.ci_high)}`;
    const cv = $('[data-role="cv"]', tile);
    if (cv) cv.textContent = `Validation croisée${NBSP}: ${format(m.cv_mean)}`;
    $('[data-role="desc"]', tile).textContent = METRIC_DESCRIPTIONS[key](m, info);
  }

  // ==========================================================================
  // 3. Éléments communs à toutes les pages
  // ==========================================================================
  function initCommon() {
    // Lien GitHub : affiché seulement si l'URL est configurée (config.js / variable GITHUB_URL)
    if (CONFIG.GITHUB_URL) {
      $$('[data-github]').forEach((a) => { a.href = CONFIG.GITHUB_URL; a.hidden = false; });
    }
  }

  // ==========================================================================
  // 4. Page d'accueil : indicateurs et démo interactive
  // ==========================================================================
  function initHome() {
    initHeroDemo();
    loadHomeKpis();
  }

  async function loadHomeKpis() {
    const info = await getInfo();
    if (!info) { $('#kpi-error').hidden = false; return; }
    $$('[data-metric]').forEach((tile) => fillMetricTile(tile, info));
    $('#kpi-count').textContent = fmt.num(info.test.n_clients);
  }

  function initHeroDemo() {
    const root = $('#hero-demo');
    const range = $('#demo-revolving');
    const output = $('#demo-revolving-out');
    const late = $$('input[name="demo-late"]', root);
    const gauge = $('#demo-gauge');
    let sequence = 0;
    let timer = 0;

    const currentClient = () => ({
      ...STANDARD_CLIENT,
      RevolvingUtilizationOfUnsecuredLines: Number(range.value) / 100,
      'NumberOfTime30-59DaysPastDueNotWorse': Number(late.find((r) => r.checked).value),
    });

    function showOffline() {
      root.dataset.offline = 'true';
      $('#demo-status').textContent = 'API hors ligne';
      $('#demo-dot').className = 'dot dot--err';
      Charts.renderGauge(gauge, { probability: 0, threshold: 0.57, zone: 'none', placeholder: true, duration: 0 });
      $('#demo-badge').className = 'badge';
      $('#demo-badge').textContent = 'Démo indisponible';
      $('#demo-sentence').textContent = "Lancez l'API pour activer la démo : docker compose up.";
      $('#demo-zone').textContent = '';
    }

    async function run() {
      const mine = ++sequence;                       // ignore les réponses devenues obsolètes
      try {
        const [res, info] = await Promise.all([postJson('/predict', currentClient()), getInfo()]);
        if (mine !== sequence) return;
        if (!res.ok) throw new Error('réponse invalide');
        const { default_probability: p, threshold, decision } = res.data;
        const zone = zoneOf(p, threshold, info ? info.borderline_margin : DEFAULT_MARGIN);
        const refused = decision === 'refusé';
        root.dataset.offline = 'false';
        $('#demo-status').textContent = 'API connectée';
        $('#demo-dot').className = 'dot dot--ok';
        Charts.renderGauge(gauge, {
          probability: p, threshold, zone, duration: 350,
          ariaLabel: `Probabilité de défaut ${fmt.pct(p)}, seuil ${fmt.pct(threshold, 0)}, ${ZONE_LABELS[zone].toLowerCase()}`,
        });
        setBadge($('#demo-badge'), refused);
        $('#demo-sentence').textContent = decisionSentence(refused, p, threshold);
        $('#demo-zone').textContent = ZONE_LABELS[zone];
      } catch (_) {
        if (mine === sequence) showOffline();
      }
    }

    function onInput() {
      output.textContent = fmt.num(Number(range.value)) + NBSP + '%';
      range.style.setProperty('--fill', (Number(range.value) / Number(range.max)) * 100 + '%');
      clearTimeout(timer);
      timer = setTimeout(run, 120);
    }

    range.addEventListener('input', onInput);
    late.forEach((r) => r.addEventListener('change', onInput));
    onInput();
  }

  // ==========================================================================
  // 5. Outil d'évaluation
  // ==========================================================================
  // Champs du formulaire : clé (id = "f-<clé>"), nom de la colonne côté API, type de saisie
  const FIELDS = [
    { key: 'age', api: 'age', kind: 'int' },
    { key: 'income', api: 'MonthlyIncome', kind: 'money', nullable: 'income_unknown' },
    { key: 'dependents', api: 'NumberOfDependents', kind: 'int', nullable: 'dependents_unknown' },
    { key: 'revolving', api: 'RevolvingUtilizationOfUnsecuredLines', kind: 'percent' },
    { key: 'debt', api: 'DebtRatio', kind: 'percent' },
    { key: 'open_lines', api: 'NumberOfOpenCreditLinesAndLoans', kind: 'int' },
    { key: 'real_estate', api: 'NumberRealEstateLoansOrLines', kind: 'int' },
    { key: 'late_30_59', api: 'NumberOfTime30-59DaysPastDueNotWorse', kind: 'int' },
    { key: 'late_60_89', api: 'NumberOfTime60-89DaysPastDueNotWorse', kind: 'int' },
    { key: 'late_90', api: 'NumberOfTimes90DaysLate', kind: 'int' },
  ];

  // Valeurs affichées : revenu en USD (converti dans la devise choisie à l'affichage), ratios en %
  const DEFAULTS = {
    age: 45, income_usd: 5400, dependents: 0, revolving: 30, debt: 35, open_lines: 8, real_estate: 1,
    late_30_59: 0, late_60_89: 0, late_90: 0, income_unknown: false, dependents_unknown: false,
  };
  // Exemples de la barre d'outils (probabilités vérifiées avec le vrai modèle : ~23 %, ~56 %, ~94 %)
  const PRESETS = {
    standard: { ...DEFAULTS },
    limit: { ...DEFAULTS, revolving: 50, late_30_59: 1 },
    risk: { ...DEFAULTS, revolving: 100, late_90: 3 },
  };

  function initTool() {
    const form = $('#client-form');
    const state = { currency: 'USD', incomeUSD: DEFAULTS.income_usd, last: null };
    try { state.currency = CURRENCIES[localStorage.getItem('currency')] ? localStorage.getItem('currency') : 'USD'; } catch (_) { /* stockage indisponible */ }

    const money = (usd) => fmt.num(usd * CURRENCIES[state.currency].rate, 0) + NBSP + CURRENCIES[state.currency].symbol;

    // ----- Formulaire : valeurs, devise, erreurs -----
    function renderIncome() {
      const cur = CURRENCIES[state.currency];
      $('#f-income').value = Number.isFinite(state.incomeUSD) ? Math.round(state.incomeUSD * cur.rate) : '';
      $('#income-suffix').textContent = state.currency;
      $('#income-usd').textContent = Number.isFinite(state.incomeUSD)
        ? `Envoyé au modèle : ${fmt.num(state.incomeUSD, 0)}${NBSP}USD`
        : '';
    }

    function setValues(v) {
      state.incomeUSD = v.income_usd;
      FIELDS.forEach((f) => { if (f.key !== 'income') $('#f-' + f.key).value = v[f.key]; });
      ['income_unknown', 'dependents_unknown'].forEach((k) => { $('#f-' + k).checked = v[k]; });
      renderIncome();
      syncNullable();
      clearErrors();
    }

    /** Une case « inconnu » désactive le champ correspondant (il est alors envoyé comme absent). */
    function syncNullable() {
      FIELDS.filter((f) => f.nullable).forEach((f) => {
        const off = $('#f-' + f.nullable).checked;
        $('#f-' + f.key).disabled = off;
      });
    }

    function clearErrors() {
      $$('.field__error', form).forEach((e) => { e.hidden = true; e.textContent = ''; });
      $$('input[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
      $('#form-alert').hidden = true;
    }

    function showFieldError(key, message) {
      const input = $('#f-' + key);
      const error = $('#err-' + key);
      input.setAttribute('aria-invalid', 'true');
      error.textContent = message;
      error.hidden = false;
    }

    function nativeMessage(input) {
      const v = input.validity;
      if (v.valueMissing) return 'Renseignez ce champ.';
      if (v.badInput) return 'Entrez un nombre valide.';
      if (v.rangeUnderflow) return `Minimum : ${input.min}.`;
      if (v.rangeOverflow) return `Maximum : ${input.max}.`;
      if (v.stepMismatch) return 'Entrez un nombre entier.';
      return 'Valeur invalide.';
    }

    /** Valide tous les champs actifs ; place le focus sur le premier champ en erreur. */
    function validate() {
      clearErrors();
      let first = null;
      FIELDS.forEach((f) => {
        const input = $('#f-' + f.key);
        if (input.disabled || input.checkValidity()) return;
        showFieldError(f.key, nativeMessage(input));
        first = first || input;
      });
      if (first) first.focus();
      return !first;
    }

    /** Requête envoyée à l'API : colonnes d'origine, revenu TOUJOURS en USD, ratios en fraction (30 % -> 0.30). */
    function readPayload() {
      const payload = {};
      FIELDS.forEach((f) => {
        const input = $('#f-' + f.key);
        if (f.nullable && $('#f-' + f.nullable).checked) payload[f.api] = null;
        else if (f.kind === 'money') payload[f.api] = Math.round(state.incomeUSD * 100) / 100;
        else if (f.kind === 'percent') payload[f.api] = Math.round(Number(input.value) * 100) / 10000;
        else payload[f.api] = parseInt(input.value, 10);
      });
      return payload;
    }

    // ----- Résultat -----
    const resultSection = $('#result');
    const loading = $('#result-loading');
    const card = $('#result-card');

    function showBanner(message) {
      const alertBox = $('#form-alert');
      alertBox.textContent = message;
      alertBox.hidden = false;
    }

    function shapItems(factors) {
      return factors.map((f) => ({
        label: FEATURE_LABELS[f.feature] || f.feature,
        sublabel: '= ' + featureValue(f.feature, f.value),
        value: f.shap_value,
        valueText: fmt.signed(f.shap_value),
        tooltip: `${FEATURE_LABELS[f.feature] || f.feature} = ${featureValue(f.feature, f.value)} : ${fmt.signed(f.shap_value)} ` +
          (f.shap_value > 0 ? '(pousse vers le refus)' : '(pousse vers l’acceptation)'),
      }));
    }

    function featureValue(feature, value) {
      if (BINARY_FEATURES.has(feature)) return value >= 0.5 ? 'oui' : 'non';
      if (PERCENT_FEATURES.has(feature)) return fmt.pct(value, 0);
      if (MONEY_FEATURES.has(feature)) return money(value);
      return fmt.num(value, Number.isInteger(value) ? 0 : 2);
    }

    function drawShap(animate) {
      if (!state.last) return;
      const items = shapItems(state.last.data.top_factors);
      Charts.renderBars($('#shap-chart'), items, {
        mode: 'diverging', animate,
        ariaLabel: 'Facteurs les plus influents pour ce client : ' + items.map((i) => `${i.label} ${i.valueText}`).join(', '),
      });
    }

    async function showResult(data, payload) {
      const info = await getInfo();
      const margin = info ? info.borderline_margin : DEFAULT_MARGIN;
      const p = data.default_probability;
      const zone = zoneOf(p, data.threshold, margin);
      const refused = data.decision === 'refusé';
      state.last = { data, payload };

      loading.hidden = true;
      card.hidden = false;
      setBadge($('#result-badge'), refused);
      $('#result-sentence').textContent = decisionSentence(refused, p, data.threshold);
      $('#result-prob').textContent = fmt.pct(p);
      $('#result-threshold').textContent = fmt.pct(data.threshold, 0);
      $('#result-zone').textContent = ZONE_LABELS[zone];
      const note = $('#zone-note');
      note.hidden = zone !== 'limit';
      note.textContent = `Zone limite : la probabilité est à moins de ${Math.round(margin * 100)} points du seuil. ` +
        'Une petite variation du dossier peut faire basculer la décision.';
      $('#request-json').textContent = `POST ${API_URL}/predict?explain=true\n\n${JSON.stringify(payload, null, 2)}`;

      Charts.renderGauge($('#gauge'), {
        probability: p, threshold: data.threshold, zone,
        ariaLabel: `Probabilité de défaut ${fmt.pct(p)}, seuil de refus ${fmt.pct(data.threshold, 0)}, ${ZONE_LABELS[zone].toLowerCase()}`,
      });
      drawShap(true);

      resultSection.setAttribute('aria-busy', 'false');
      resultSection.scrollIntoView({ behavior: Charts.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      $('#result-title').focus({ preventScroll: true });
    }

    function setLoading(on) {
      const btn = $('#submit-btn');
      btn.disabled = on;
      $('#submit-label').textContent = on ? 'Évaluation en cours…' : 'Évaluer le client';
      $('#submit-spinner').hidden = !on;
      if (on) {
        resultSection.hidden = false;
        resultSection.setAttribute('aria-busy', 'true');
        card.hidden = true;
        loading.hidden = false;
      }
    }

    function hideResult() {
      resultSection.hidden = true;
      state.last = null;
    }

    async function evaluate() {
      const payload = readPayload();
      setLoading(true);
      try {
        const res = await postJson('/predict?explain=true', payload);
        if (res.ok) {
          await showResult(res.data, payload);
        } else if (res.status === 422 && res.data && res.data.details) {
          hideResult();
          // Chaque erreur de l'API est rattachée à son champ (noms de colonnes d'origine)
          const unmatched = [];
          res.data.details.forEach((d) => {
            const f = FIELDS.find((x) => x.api === d.field);
            if (f) showFieldError(f.key, d.message.charAt(0).toUpperCase() + d.message.slice(1) + '.');
            else unmatched.push(`${d.field} : ${d.message}`);
          });
          if (unmatched.length) showBanner('Données refusées par l’API. ' + unmatched.join(' ; '));
        } else {
          hideResult();
          showBanner(`Erreur de l’API (code ${res.status}). Réessayez dans un instant.`);
        }
      } catch (_) {
        hideResult();
        showBanner(`Impossible de joindre l’API à l’adresse ${API_URL}. Vérifiez qu’elle est démarrée.`);
        setStatus(null);
      } finally {
        setLoading(false);
      }
    }

    // ----- Bandeau d'état de l'API -----
    function setStatus(health) {
      $('#status-dot').className = 'dot ' + (health ? 'dot--ok' : 'dot--err');
      $('#status-text').textContent = health ? 'API connectée' : 'API injoignable';
      $('#status-model').textContent = health ? health.model : '—';
      $('#status-threshold').textContent = health ? String(health.threshold) : '—';
    }

    async function refreshStatus() {
      try {
        const res = await api('/health');
        setStatus(res.ok ? res.data : null);
      } catch (_) {
        setStatus(null);
      }
    }

    // ----- Événements -----
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (validate()) evaluate();
    });

    form.addEventListener('input', (e) => {
      const input = e.target;
      if (input.id === 'f-income') {
        state.incomeUSD = input.value === '' ? NaN : Number(input.value) / CURRENCIES[state.currency].rate;
        $('#income-usd').textContent = Number.isFinite(state.incomeUSD)
          ? `Envoyé au modèle : ${fmt.num(state.incomeUSD, 0)}${NBSP}USD` : '';
      }
      if (input.hasAttribute('aria-invalid')) {
        input.removeAttribute('aria-invalid');
        const err = $('#err-' + input.id.replace('f-', ''));
        if (err) err.hidden = true;
      }
    });

    ['income_unknown', 'dependents_unknown'].forEach((k) => $('#f-' + k).addEventListener('change', syncNullable));

    $('#currency').addEventListener('change', (e) => {
      state.currency = e.target.value;
      try { localStorage.setItem('currency', state.currency); } catch (_) { /* stockage indisponible */ }
      renderIncome();
      drawShap(false);            // les valeurs monétaires du graphique suivent la devise
    });

    $$('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
      setValues(PRESETS[btn.dataset.preset]);
      form.requestSubmit();
    }));

    $('#reset-btn').addEventListener('click', () => { setValues(DEFAULTS); hideResult(); });

    Charts.watchResize($('#shap-chart'), () => drawShap(false));

    // ----- Initialisation -----
    $('#currency').value = state.currency;
    setValues(DEFAULTS);
    refreshStatus();
    getInfo().then((info) => {
      if (!info) return;
      $$('[data-k]').forEach((el) => { el.textContent = String(info.cost_ratio_assumption); });
    });
  }

  // ==========================================================================
  // 6. Page « Modèle »
  // ==========================================================================
  const EFFECT_ARROWS = { increases: '↑', decreases: '↓', mixed: '↕' };

  async function initModel() {
    const info = await getInfo();
    if (!info) { $('#model-error').hidden = false; return; }

    $$('[data-metric]').forEach((tile) => fillMetricTile(tile, info));

    const c = info.test.confusion;
    $('#confusion').textContent =
      `Sur les ${fmt.num(info.test.n_clients)} clients de test : ${fmt.num(c.tp)} défauts détectés et ${fmt.num(c.fn)} manqués ; ` +
      `${fmt.num(c.fp)} bons clients refusés à tort sur ${fmt.num(c.fp + c.tn)}.`;
    $$('[data-threshold]').forEach((el) => { el.textContent = fmt.pct(info.threshold, 0); });
    $$('[data-k]').forEach((el) => { el.textContent = String(info.cost_ratio_assumption); });

    const chart = $('#global-chart');
    const items = info.global_importance.map((g) => ({
      label: FEATURE_LABELS[g.feature] || g.feature,
      tag: EFFECT_ARROWS[g.effect],
      value: g.mean_abs_shap,
      valueText: fmt.num(g.share_pct, 1) + NBSP + '%',
      tooltip: `${FEATURE_LABELS[g.feature] || g.feature} : ${fmt.num(g.share_pct, 1)} % de l’importance totale`,
    }));
    const draw = (animate) => Charts.renderBars(chart, items, {
      mode: 'magnitude', animate,
      ariaLabel: 'Importance moyenne des variables : ' + items.map((i) => `${i.label} ${i.valueText}`).join(', '),
    });
    draw(true);
    Charts.watchResize(chart, () => draw(false));
  }

  // ==========================================================================
  // 7. Démarrage
  // ==========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initCommon();
    const init = { home: initHome, tool: initTool, model: initModel }[document.body.dataset.page];
    if (init) init();
  });
})();
