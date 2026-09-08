/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Plan cards, one source of truth

   The homepage and the pricing page both sell the same four plans, and they had
   already drifted: the homepage listed "Brand search trend + YouTube analysis"
   and the pricing page did not. Copy that lives in two files always drifts, so
   the COPY now lives here, once.

   What is shared: plan names, taglines, feature lists, notes, CTA labels, and
   which price key each card reads.
   What is NOT shared: the markup and CSS. The two pages have genuinely different
   card designs (the homepage's compact .p-* cards inside a section, the pricing
   page's larger .plan-* cards), and forcing one design on both would be a visual
   rewrite of two established pages to solve a copy problem. So this module
   renders each page's own markup from the same data:

     TDMPlans.render('pricing-cards', 'compact')   // homepage  .p-*
     TDMPlans.render('cards', 'full')              // pricing   .plan-*

   PRICES ARE NEVER WRITTEN HERE. Each card emits a [data-price] span with an
   em dash, exactly like static markup does, and /js/pricing-display.js fills it
   from /api/client-config. Changing a price stays a lib/pricing.js edit.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── THE MASTER LIST ───────────────────────────────────────────────────────
  // `price` is the key /api/client-config exposes (null = no price to look up).
  // `cta.compact` is a JS action (the homepage runs the scan/checkout in place);
  // `cta.full` is a URL (the pricing page navigates). Same label either way.
  var PLANS = [
    {
      id: 'free',
      name: 'Free snapshot',
      badge: null,
      tagline: 'See exactly what patients see. Know your biggest issues. No commitment, no card.',
      price: null,               // rendered as <symbol>0
      period: 'forever',
      note: 'No card required.',
      features: [
        'Patient view snapshot',
        '3 critical issues identified',
        'Competitor comparison',
        'Personalised fix guide (email)'
      ],
      cta: {
        label: 'Run free check →',
        compact: "document.getElementById('tool').scrollIntoView({behavior:'smooth'})",
        full: '/#tool'
      },
      style: 'plain'
    },
    {
      id: 'report',
      name: 'Full audit report',
      badge: 'One-time',
      tagline: 'The complete picture. Every pillar scored. Specific fixes for your specialty and city. No subscription.',
      price: 'report',
      period: 'one-time',
      note: 'One payment. No subscription. Instant delivery.',
      // Value anchor, previously inline on the homepage only. It carries a
      // HARDCODED currency figure — the one price-ish string this file still
      // has — because it is a claim about what agencies charge, not our price,
      // and the India figure is a business decision, not a conversion.
      anchor: 'What marketing agencies charge $150 to produce — in 60 seconds.',
      features: [
        'All 7 visibility pillars scored',
        'AI Visibility Score (ChatGPT, Gemini, Claude)',
        'Brand search trend + YouTube analysis',
        'Social &amp; directory presence audit',
        '5 AI-written fixes with copy-paste steps',
        'Competitor narrative — why they beat you',
        'SEO keyword strategy for your specialty',
        'Content strategy brief (Reels + blogs)',
        'Patient journey audit — where you lose patients',
        '90-day action plan with KPIs',
        'PDF report — emailed in 60 seconds',
        'Audit History page (your past reports)'
      ],
      cta: {
        label: 'Get full report →',
        compact: 'doOneTime()',
        full: '/?plan=audit#tool'
      },
      style: 'accent'
    },
    {
      id: 'monitor',
      name: 'Monthly monitor',
      badge: 'Most popular',
      tagline: 'Weekly automated checks. Know instantly when something changes — before patients notice.',
      price: 'monitor',
      period: '/month',
      note: 'Cancel anytime · One patient visit pays for months.',
      features: [
        'Everything in Full audit report',
        'Live Visibility Dashboard — scores, competitors, reviews &amp; AI rankings in real time',
        'Weekly visibility audit + PDF by email',
        'AI Rank Tracker (ChatGPT, Claude, Gemini, Perplexity)',
        'Competitor watchlist &amp; change alerts',
        'Review sentiment heatmap',
        'Review growth engine',
        'Reputation &amp; local SEO monitor',
        'Weekly personalised action tasks',
        'Monthly content pack',
        '30/60/90-day growth roadmap',
        'Email alerts when your score drops'
      ],
      cta: {
        label: 'Start monitoring →',
        compact: "doUpgrade('monitor')",
        full: '/?plan=monitor#tool'
      },
      style: 'featured'
    },
    {
      id: 'agency',
      name: 'Clinic / Agency',
      badge: 'Multi-doctor',
      tagline: 'One login for your whole practice — every doctor tracked, each with their own dashboard.',
      price: 'agency',
      period: '/month',
      note: 'Cancel anytime. No contracts.',
      // The doctor limit is filled from ORG_PLANS at runtime, like the price.
      features: [
        'Add up to <span data-plan-limit="agency">—</span> doctors',
        'Each doctor gets their own dashboard',
        'Everything in Monthly monitor, for every doctor',
        'Switch between doctors instantly'
      ],
      cta: {
        label: 'Start agency plan →',
        compact: "window.location.href='/pages/agency-signup.html'",
        full: '/pages/agency-signup.html'
      },
      style: 'agency'
    }
  ];

  // Price element for a card. `null` price = the free plan: show the region's
  // currency symbol followed by a literal 0, so the zero follows the currency.
  function priceHtml(plan, variant) {
    if (!plan.price) {
      return variant === 'compact'
        ? '<span data-price-symbol>—</span>0<span> ' + esc(plan.period) + '</span>'
        : '<span data-price-symbol>—</span>0';
    }
    return variant === 'compact'
      ? '<span data-price="' + plan.id + '">—</span><span> ' + esc(plan.period) + '</span>'
      : '<span data-price="' + plan.id + '">—</span>';
  }

  // ── Homepage variant: .p-card / .p-name / .p-price / .p-feats / .p-cta ────
  function compactCard(plan) {
    var cls = 'p-card' + (plan.style === 'featured' ? ' feat' : '');
    var inline = plan.style === 'accent' ? ' style="border-color:var(--green);border-width:1.5px"' : '';
    var nameStyle = plan.style === 'accent' ? ' style="color:var(--green-dark)"' : '';
    var btnCls = plan.style === 'featured' ? 'c-fill' : plan.style === 'plain' ? 'c-out' : 'c-green';

    return '<div class="' + cls + '"' + inline + '>' +
      (plan.style === 'featured' ? '<div class="p-badge">' + esc(plan.badge) + '</div>' : '') +
      '<div class="p-name"' + nameStyle + '>' + esc(plan.name) + '</div>' +
      '<div class="p-price">' + priceHtml(plan, 'compact') + '</div>' +
      '<div class="p-desc">' + plan.tagline + '</div>' +
      (plan.anchor ? '<div class="p-anchor">' + plan.anchor + '</div>' : '') +
      '<ul class="p-feats">' + plan.features.map(function (f) { return '<li>' + f + '</li>'; }).join('') + '</ul>' +
      '<button class="p-cta ' + btnCls + '" type="button" onclick="' + plan.cta.compact + '">' +
        esc(plan.cta.label) + '</button>' +
      '<p style="font-size:11px;color:var(--slate-muted);text-align:center;margin-top:8px">' + plan.note + '</p>' +
    '</div>';
  }

  // ── Pricing variant: .plan-card / .plan-name / .features / .plan-cta ──────
  function fullCard(plan) {
    var extra = plan.style === 'featured' ? ' monitor' : plan.style === 'agency' ? ' agency' : '';
    var badgeCls = plan.style === 'featured' ? 'badge-monitor' : 'badge-audit';
    var ctaCls = plan.style === 'featured' ? 'cta-monitor' : 'cta-audit';

    return '<div class="plan-card' + extra + '">' +
      (plan.style === 'featured' ? '<div class="popular-tag">' + esc(plan.badge) + '</div>' : '') +
      (plan.badge && plan.style !== 'featured'
        ? '<span class="plan-badge ' + badgeCls + '">' + esc(plan.badge) + '</span>'
        : (plan.style === 'featured' ? '<span class="plan-badge ' + badgeCls + '">Subscription</span>' : '<span class="plan-badge badge-audit">Free</span>')) +
      '<div class="plan-name">' + esc(plan.name) + '</div>' +
      '<div class="plan-tagline">' + plan.tagline + '</div>' +
      '<div class="plan-price">' +
        '<div class="plan-amount">' + priceHtml(plan, 'full') + '</div>' +
        '<div class="plan-period">&nbsp;' + (plan.period === '/month' ? '/ month' : plan.period) + '</div>' +
      '</div>' +
      '<div class="plan-note">' + plan.note + '</div>' +
      (plan.anchor ? '<div class="plan-anchor">' + plan.anchor + '</div>' : '') +
      '<ul class="features">' + plan.features.map(function (f) {
        return '<li><span class="ico ico-check">✓</span> ' + f + '</li>';
      }).join('') + '</ul>' +
      '<a href="' + plan.cta.full + '" class="plan-cta ' + ctaCls + '" data-plan="' + plan.id + '">' +
        esc(plan.cta.label) + '</a>' +
    '</div>';
  }

  /**
   * Render all four plans into `containerId`.
   * @param {string} containerId
   * @param {'compact'|'full'} variant
   */
  function render(containerId, variant) {
    var el = document.getElementById(containerId);
    if (!el) return null;
    var build = variant === 'full' ? fullCard : compactCard;
    el.innerHTML = PLANS.map(build).join('');

    // The cards were injected after boot, so their [data-price] spans and the
    // agency doctor-limit still hold their em-dash placeholder. Fill both from
    // the same /api/client-config payload once it lands.
    if (window.TDMPricing) {
      var fill = function (cfg) {
        window.TDMPricing.refresh(el);
        var a = (cfg && cfg.prices && cfg.prices.agency) ||
                (window.TDM_PRICING && window.TDM_PRICING.prices && window.TDM_PRICING.prices.agency);
        if (a && a.profileLimit != null) {
          var lim = el.querySelectorAll('[data-plan-limit="agency"]');
          for (var i = 0; i < lim.length; i++) lim[i].textContent = a.profileLimit;
        }
      };
      window.TDMPricing.ready ? window.TDMPricing.ready.then(fill) : fill();
    }
    return el;
  }

  window.TDMPlans = { PLANS: PLANS, render: render };
})();
