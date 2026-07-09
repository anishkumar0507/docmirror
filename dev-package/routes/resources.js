'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Resources routes + views

   Server-renders the Markdown-driven Resources system, reusing The Doc Mirror
   design language (same tokens, nav/footer via /js/layout.js, same CTA style):

     GET /resources           → listing (Nextdot-style cards)
     GET /resources/:slug      → individual article page

   All content comes from lib/resources.js (Markdown in dev-package/resources/).
   ────────────────────────────────────────────────────────────────────────── */

const {
  SITE,
  escapeHtml,
  getAllResources,
  getResourceBySlug,
} = require('../lib/resources');

// ── shared head + shell ────────────────────────────────────────────────────

// Page-body CSS only (nav/footer styles are injected by /js/layout.js).
// Mirrors the existing guide/resources pages, plus card-with-image and
// Markdown-content styling. No colours or layout tokens changed.
const PAGE_CSS = `
:root{--navy:#0A2540;--green:#00A878;--green-dark:#007a57;--green-light:#e6f7f2;--warm:#F7F6F3;--warm-white:#FEFCF7;--slate:#3D4D5C;--slate-light:#6B7A8D;--slate-muted:#9aabba;--border:#E2E8F0}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'DM Sans',system-ui,sans-serif;color:var(--slate);background:var(--warm);-webkit-font-smoothing:antialiased;line-height:1.7}
main{width:min(100% - 2rem,900px);max-width:1040px;margin:0 auto;padding:clamp(1.5rem,4vw,2.5rem) 0 3rem;display:flex;flex-direction:column;gap:1.25rem}
.eyebrow{display:inline-flex;align-items:center;gap:.65rem;background:rgba(0,168,120,.12);border:1px solid rgba(0,168,120,.2);color:var(--green-dark);font-size:11px;font-weight:700;padding:7px 12px;border-radius:999px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.25rem;width:fit-content}
h1{font-size:clamp(2rem,4vw,3rem);line-height:1.06;color:var(--navy);margin:0}
.lede{font-size:1.05rem;color:var(--slate-light);line-height:1.75;margin:0 0 1rem}

/* ── listing: compact card grid (Nextdot-style) ── */
.res-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.15rem}
.res-card{background:#fff;border:1px solid var(--border);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;text-decoration:none;color:var(--navy);box-shadow:0 6px 18px rgba(10,37,64,.05);transition:transform .18s,box-shadow .18s}
.res-card:hover{transform:translateY(-3px);box-shadow:0 14px 30px rgba(10,37,64,.1)}
.res-card-media{width:100%;aspect-ratio:16/9;overflow:hidden;background:#061b2f;display:block}
.res-card-media>img{width:100%;height:100%;object-fit:contain;object-position:center;display:block}
.res-card-media--ph{aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;text-align:center;padding:1rem;background:linear-gradient(135deg,#061b2f,var(--green-dark));color:#fff;font-weight:700;font-size:.95rem;line-height:1.3}
.res-card-body{padding:.9rem 1.05rem 1.15rem;display:flex;flex-direction:column;gap:.5rem}
.res-card-meta{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;font-size:.72rem;color:var(--slate-muted)}
.res-card-cat{font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--green);background:var(--green-light);padding:3px 9px;border-radius:20px;font-size:.66rem}
.res-card-dot{opacity:.6}
.res-card h3{font-size:.98rem;line-height:1.35;margin:0;color:var(--navy);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.res-card p{font-size:.86rem;color:var(--slate-light);line-height:1.55;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.res-empty{background:#fff;border:1px dashed var(--border);border-radius:18px;padding:2rem;text-align:center;color:var(--slate-light)}

/* ── featured (latest) resource — text left, image right ── */
.res-featured{display:grid;grid-template-columns:1.02fr .98fr;gap:0;background:#fff;border:1px solid var(--border);border-radius:20px;overflow:hidden;text-decoration:none;color:var(--navy);box-shadow:0 12px 30px rgba(10,37,64,.07);transition:transform .18s,box-shadow .18s;margin-bottom:.4rem}
.res-featured:hover{transform:translateY(-3px);box-shadow:0 18px 42px rgba(10,37,64,.12)}
.res-featured-body{padding:clamp(1.5rem,3vw,2.4rem);display:flex;flex-direction:column;gap:.7rem;justify-content:center}
.res-featured-badge{align-self:flex-start;font-size:.66rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--green-dark);background:rgba(0,168,120,.12);border:1px solid rgba(0,168,120,.2);padding:5px 11px;border-radius:999px}
.res-featured-title{font-size:clamp(1.3rem,2.4vw,1.85rem);line-height:1.2;margin:0;color:var(--navy);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.res-featured-excerpt{font-size:.98rem;color:var(--slate-light);line-height:1.65;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.res-featured-link{font-size:.9rem;font-weight:600;color:var(--green-dark);margin-top:.15rem}
.res-featured-media{width:100%;aspect-ratio:16/9;align-self:center;overflow:hidden;background:#061b2f;display:block}
.res-featured-media>img{width:100%;height:100%;object-fit:contain;object-position:center;display:block}
.res-featured-media--ph{aspect-ratio:16/9;align-self:center;display:flex;align-items:center;justify-content:center;text-align:center;padding:1.5rem;background:linear-gradient(135deg,#061b2f,var(--green-dark));color:#fff;font-weight:700;font-size:clamp(1.1rem,2.5vw,1.5rem);line-height:1.25}

/* ── article ── */
.back-link{display:inline-flex;align-items:center;gap:.4rem;color:var(--slate-light);text-decoration:none;font-size:.88rem;font-weight:500;width:fit-content}
.back-link:hover{color:var(--navy)}
.res-meta{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;font-size:.83rem;color:var(--slate-muted)}
.res-meta .res-card-cat{font-size:.68rem}
.res-hero{width:100%;aspect-ratio:16/9;overflow:hidden;background:#061b2f;border-radius:20px;box-shadow:0 18px 44px rgba(10,37,64,.12);margin:.25rem 0 .5rem;display:block}
.res-hero>img{width:100%;height:100%;object-fit:contain;object-position:center;display:block}
.res-hero--ph{aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;text-align:center;padding:1.5rem;background:linear-gradient(135deg,#061b2f,var(--green-dark));color:#fff;font-weight:700;font-size:clamp(1.1rem,3vw,1.6rem)}
.res-content{color:var(--slate)}
.res-content h1,.res-content h2,.res-content h3,.res-content h4{color:var(--navy);line-height:1.25}
.res-content h1{font-size:1.7rem;margin:2rem 0 .8rem}
.res-content h2{font-size:1.45rem;margin:2rem 0 .8rem}
.res-content h3{font-size:1.15rem;margin:1.5rem 0 .55rem}
.res-content p,.res-content li{font-size:1.02rem;line-height:1.85}
.res-content p{margin:0 0 1.1rem}
.res-content ul,.res-content ol{margin:0 0 1.15rem 1.35rem}
.res-content li{margin-bottom:.35rem}
.res-content a{color:var(--green-dark);text-decoration:underline;text-underline-offset:2px}
.res-content img{max-width:100%;height:auto;border-radius:14px;margin:1.5rem 0;display:block}
.res-content blockquote{border-left:4px solid var(--green);background:#fff;border-radius:0 12px 12px 0;padding:.9rem 1.2rem;margin:1.5rem 0;color:var(--slate);box-shadow:0 12px 30px rgba(10,37,64,.05)}
.res-content blockquote p:last-child{margin-bottom:0}
.res-content pre{background:var(--navy);color:#e6f7f2;padding:1rem 1.2rem;border-radius:12px;overflow-x:auto;margin:1.5rem 0;font-size:.9rem;line-height:1.6}
.res-content code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;background:rgba(10,37,64,.06);padding:.15em .4em;border-radius:6px}
.res-content pre code{background:none;padding:0;color:inherit}
.res-content hr{border:none;border-top:1px solid var(--border);margin:2rem 0}
.res-table-wrap{overflow-x:auto;margin:1.5rem 0}
.res-content table{width:100%;border-collapse:collapse;font-size:.95rem}
.res-content th,.res-content td{border:1px solid var(--border);padding:.6rem .85rem;text-align:left}
.res-content th{background:var(--green-light);color:var(--navy);font-weight:700}

/* ── CTA + related (same as guide pages) ── */
.cta-block{background:#fff;border:1.5px solid rgba(0,168,120,.22);border-radius:24px;box-shadow:0 12px 40px rgba(10,37,64,.08);padding:40px;display:flex;align-items:center;justify-content:space-between;gap:24px;margin:2rem 0}
.cta-block-left{flex:1;display:flex;flex-direction:column;gap:.65rem}
.cta-block h2{margin:0;font-size:1.35rem;color:var(--navy)}
.cta-block p{margin:0;color:var(--slate-light)}
.cta-trust{font-size:.82rem;color:var(--slate-muted);margin:0}
.cta-btn{flex-shrink:0;display:inline-flex;align-items:center;gap:.5rem;background:var(--navy);color:#fff;padding:16px 26px;border-radius:999px;font-weight:600;font-size:.97rem;white-space:nowrap;width:fit-content;max-width:260px;text-decoration:none;transition:background .15s}
.cta-btn:hover{background:#163a5f}
/* ── FAQ accordion (per-resource) ── */
.faq-section{margin-top:1rem}
.faq-section > h2{font-size:1.3rem;color:var(--navy);margin:0 0 1rem}
.faq-item{background:#fff;border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:0 8px 18px rgba(10,37,64,.05);margin-bottom:1rem}
.faq-item h3{padding:1rem 1.2rem;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:1rem;color:var(--navy);margin:0;font-size:1rem;line-height:1.4}
.faq-item h3::after{content:'+';color:var(--green);font-weight:700;flex-shrink:0}
.faq-item.open h3::after{content:'−'}
.faq-item p{padding:0 1.2rem;color:var(--slate-light);margin:0;line-height:1.65;max-height:0;overflow:hidden;transition:max-height .35s ease,padding-bottom .35s ease;padding-bottom:0}
.faq-item.open p{max-height:600px;padding-bottom:1rem}
@media(max-width:768px){.cta-block{flex-direction:column;align-items:stretch;padding:28px 24px}.cta-btn{width:100%;max-width:none;justify-content:center}}
/* Resources grid: 3 cols desktop → 2 tablet → 1 mobile; featured stacks (image above text) on mobile */
@media(max-width:980px){.res-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:768px){.res-featured{grid-template-columns:1fr}.res-featured-media{order:-1;aspect-ratio:16/9;align-self:stretch}.res-featured-media--ph{aspect-ratio:16/9;align-self:stretch}.res-featured-body{padding:1.4rem 1.35rem}}
@media(max-width:640px){.res-grid{grid-template-columns:1fr}}
@media(max-width:720px){main{padding:1.25rem 1rem 2rem}}
`;

const GTAG = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-QS7ZLTTZLF"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-QS7ZLTTZLF');
</script>`;

const DEFAULT_OG_IMAGE = `${SITE}/assets/logo/og-image.png`;

function absUrl(src) {
  if (!src) return DEFAULT_OG_IMAGE;
  if (/^https?:\/\//i.test(src)) return src;
  return SITE + (src.startsWith('/') ? src : '/' + src);
}

// Full HTML document shell — head SEO + Doc Mirror header/footer mounts.
function renderShell({ title, description, canonical, ogType, ogImage, jsonLd, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0A2540">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="${escapeHtml(ogType)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="The Doc Mirror">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
<script type="application/ld+json">${jsonLd}</script>
<style>${PAGE_CSS}</style>
${GTAG}
</head>
<body>
<div id="dm-header"></div>
<main>
${body}
</main>
<div id="dm-footer"></div>
<script>
/* Broken-image safety net: replace any failed resource image with the
   branded gradient placeholder (same look as a post with no image). */
window.dmImgFallback=function(img){
  var wrap=img.parentNode;
  if(!wrap||wrap.dataset.fb)return;wrap.dataset.fb='1';
  var d=document.createElement('div');
  d.className=img.getAttribute('data-ph')||'';
  var s=document.createElement('span');
  s.textContent=img.getAttribute('data-label')||img.alt||'';
  d.appendChild(s);
  if(wrap.parentNode)wrap.parentNode.replaceChild(d,wrap);
};
</script>
<script src="/js/layout.js" defer></script>
<script src="/js/branding.js" defer></script>
</body>
</html>`;
}

// ── card + placeholder helpers ─────────────────────────────────────────────

// Fixed 16:9 image wrapper (Nextdot-style): the <img> uses object-fit:contain
// inside a dark #061b2f box, so the full image is always shown — never cropped.
function cardMedia(post, cls, { eager = false } = {}) {
  const ph = `${cls} ${cls}--ph`;
  if (post.image) {
    // If the image ever fails to load, dmImgFallback swaps the wrapper for the
    // branded placeholder so a broken image can never show a blank/broken icon.
    return `<div class="${cls}"><img src="${escapeHtml(post.image)}" alt="${escapeHtml(post.imageAlt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} width="1200" height="675" data-ph="${ph}" data-label="${escapeHtml(post.title)}" onerror="dmImgFallback(this)"></div>`;
  }
  return `<div class="${ph}"><span>${escapeHtml(post.title)}</span></div>`;
}

function metaBits(post) {
  const bits = [`<span class="res-card-cat">${escapeHtml(post.category)}</span>`];
  if (post.date.display) bits.push(`<span class="res-card-date">${escapeHtml(post.date.display)}</span>`);
  bits.push(`<span class="res-card-rt">${post.readingTime} min read</span>`);
  return bits.join('<span class="res-card-dot">·</span>');
}

function resourceCard(post) {
  return `<a class="res-card" href="${escapeHtml(post.url)}">
  ${cardMedia(post, 'res-card-media')}
  <div class="res-card-body">
    <div class="res-card-meta">${metaBits(post)}</div>
    <h3>${escapeHtml(post.title)}</h3>
    <p>${escapeHtml(post.excerpt)}</p>
  </div>
</a>`;
}

// Latest resource, rendered wider — text on the left, hero image on the right.
function featuredCard(post) {
  return `<a class="res-featured" href="${escapeHtml(post.url)}">
  <div class="res-featured-body">
    <span class="res-featured-badge">Latest</span>
    <div class="res-card-meta">${metaBits(post)}</div>
    <h2 class="res-featured-title">${escapeHtml(post.title)}</h2>
    <p class="res-featured-excerpt">${escapeHtml(post.excerpt)}</p>
    <span class="res-featured-link">Read guide &rarr;</span>
  </div>
  ${cardMedia(post, 'res-featured-media')}
</a>`;
}

const CTA_BLOCK = `<div class="cta-block">
  <div class="cta-block-left">
    <h2>Run a free visibility audit</h2>
    <p>See your Doctor Visibility Score across Google, ChatGPT, Gemini, and Claude.</p>
    <p class="cta-trust">Free &middot; No signup &middot; 60 seconds &middot; Private</p>
  </div>
  <a class="cta-btn" href="/#tool">Run free check &rarr;</a>
</div>`;

// ── listing page ───────────────────────────────────────────────────────────

function renderListing() {
  const posts = getAllResources();
  const canonical = `${SITE}/resources`;

  let cards;
  if (!posts.length) {
    cards = `<div class="res-empty">New guides are on the way. Check back soon.</div>`;
  } else {
    // Newest post (getAllResources is sorted date-desc) is the featured card;
    // the rest fill the compact grid below.
    const [featured, ...rest] = posts;
    const grid = rest.length
      ? `<div class="res-grid">${rest.map(resourceCard).join('\n')}</div>`
      : '';
    cards = `${featuredCard(featured)}\n${grid}`;
  }

  const itemList = {
    '@type': 'ItemList',
    '@id': `${canonical}#list`,
    itemListElement: posts.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: p.canonical,
      name: p.title,
    })),
  };
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    '@id': `${canonical}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Resources', item: canonical },
    ],
  };
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': [breadcrumb, itemList] });

  const body = `<div class="eyebrow">Resources</div>
<h1>Learn how doctors appear in Google and AI search</h1>
<p class="lede">Guides to help doctors understand Google visibility, AI visibility, ChatGPT ranking, and online presence.</p>
${cards}
${CTA_BLOCK}`;

  return renderShell({
    title: 'Resources — Doctor Visibility Guides | The Doc Mirror',
    description: 'Guides to help doctors understand Google visibility, AI visibility, ChatGPT ranking, and online presence.',
    canonical,
    ogType: 'website',
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd,
    body,
  });
}

// ── article page ───────────────────────────────────────────────────────────

function renderArticle(post) {
  const ogImage = absUrl(post.image);

  const hero = cardMedia(post, 'res-hero', { eager: true });

  const faqBlock = post.faq.length
    ? `<section class="faq-section" aria-label="Frequently asked questions">
  <h2>Frequently asked questions</h2>
  ${post.faq.map(f => `<div class="faq-item"><h3>${escapeHtml(f.question)}</h3><p>${escapeHtml(f.answer)}</p></div>`).join('\n  ')}
</section>
<script>
document.querySelectorAll('.faq-item h3').forEach(function(h){
  h.addEventListener('click',function(){
    var item=h.parentNode,isOpen=item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(function(x){x.classList.remove('open');});
    if(!isOpen){item.classList.add('open');}
  });
});
</script>`
    : '';

  const article = {
    '@type': 'BlogPosting',
    '@id': `${post.canonical}#article`,
    headline: post.title,
    description: post.metaDescription,
    image: ogImage,
    datePublished: post.date.iso || undefined,
    dateModified: post.date.iso || undefined,
    author: { '@type': 'Organization', name: post.author },
    publisher: {
      '@type': 'Organization',
      name: 'The Doc Mirror',
      logo: { '@type': 'ImageObject', url: `${SITE}/android-chrome-512x512.png` },
    },
    mainEntityOfPage: post.canonical,
    url: post.canonical,
  };
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    '@id': `${post.canonical}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Resources', item: `${SITE}/resources` },
      { '@type': 'ListItem', position: 3, name: post.title, item: post.canonical },
    ],
  };
  const graph = [article, breadcrumb];
  if (post.faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${post.canonical}#faq`,
      mainEntity: post.faq.map(f => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    });
  }
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });

  const body = `<a class="back-link" href="/resources">&larr; Back to Resources</a>
<div class="eyebrow">${escapeHtml(post.category)}</div>
<h1>${escapeHtml(post.title)}</h1>
<div class="res-meta">${metaBits(post)}<span class="res-card-dot">·</span><span>By ${escapeHtml(post.author)}</span></div>
${hero}
<article class="res-content">${post.html}</article>
${CTA_BLOCK}
${faqBlock}
<a class="back-link" href="/resources">&larr; Back to Resources</a>`;

  return renderShell({
    title: post.seoTitle,
    description: post.metaDescription,
    canonical: post.canonical,
    ogType: 'article',
    ogImage,
    jsonLd,
    body,
  });
}

// ── Express handlers ───────────────────────────────────────────────────────

function listingHandler(_req, res) {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderListing());
}

function articleHandler(req, res, next) {
  const post = getResourceBySlug(req.params.slug);
  if (!post) return next();          // fall through to catch-all (index.html/SPA)
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderArticle(post));
}

module.exports = { listingHandler, articleHandler, renderListing, renderArticle };
