/**
 * ══════════════════════════════════════════════════════════════
 *  칼럼 페이지 생성기
 *  data/columns/*.md 를 읽어 column/{주소}/index.html 을 만듭니다.
 *  관리자 화면(seum13.com/admin)에서 칼럼을 저장하면
 *  Netlify가 이 파일을 자동으로 실행해 페이지를 만듭니다.
 *
 *  ※ 이 파일이 실패해도 홈페이지 배포는 멈추지 않습니다.
 *    (오류가 나면 기록만 남기고 그냥 넘어갑니다)
 * ══════════════════════════════════════════════════════════════
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'data', 'columns');
const OUT = path.join(ROOT, 'column');
const SITE = 'https://seum13.com';

const log = (...a) => console.log('[칼럼]', ...a);

/* ── 유틸 ─────────────────────────────────────────── */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* 앞머리(frontmatter) 읽기 — key: value 와 key: > 여러 줄 지원 */
function parseFront(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  let key = null, buf = [];
  const flush = () => { if (key) meta[key] = buf.join('\n').trim(); key = null; buf = []; };
  for (const line of lines) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv && !/^\s/.test(line)) {
      flush();
      key = kv[1];
      let v = kv[2].trim();
      if (v === '>' || v === '|' || v === '>-' || v === '|-') { buf = []; continue; }
      v = v.replace(/^["'](.*)["']$/, '$1');
      meta[key] = v; key = null; buf = [];
    } else if (key !== null || line.trim()) {
      buf.push(line.trim());
    }
  }
  flush();
  return { meta, body: m[2] };
}

/* 인라인 서식: **굵게**, [글자](주소)
   따옴표는 본문에서는 그대로 보여야 하므로 되돌린다 */
function inline(s) {
  return esc(s)
    .replace(/&quot;/g, '"')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/* 마크다운 → HTML (세움 칼럼에서 쓰는 문법만) */
function mdToHtml(md) {
  const out = [];
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (!t) { i++; continue; }

    /* HTML 을 직접 쓴 줄은 그대로 둔다 */
    if (t.startsWith('<')) { out.push(t); i++; continue; }

    /* 소제목 */
    if (/^###\s+/.test(t)) { out.push(`<h3>${inline(t.replace(/^###\s+/, ''))}</h3>`); i++; continue; }
    if (/^##\s+/.test(t))  { out.push(`<h2>${inline(t.replace(/^##\s+/, ''))}</h2>`);  i++; continue; }

    /* 인용 */
    if (/^>\s?/.test(t)) {
      const rows = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        const v = lines[i].trim().replace(/^>\s?/, '').trim();
        if (v) rows.push(`<p>${inline(v)}</p>`);
        i++;
      }
      out.push(`<blockquote>${rows.join('')}</blockquote>`);
      continue;
    }

    /* 번호 목록 */
    if (/^\d+\.\s+/.test(t)) {
      const rows = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        rows.push(`<li>${inline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${rows.join('')}</ol>`);
      continue;
    }

    /* 글머리 목록 */
    if (/^[-*]\s+/.test(t)) {
      const rows = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        rows.push(`<li>${inline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${rows.join('')}</ul>`);
      continue;
    }

    /* 문단 — 빈 줄이 나올 때까지 한 덩어리 */
    const para = [];
    while (i < lines.length) {
      const c = lines[i].trim();
      if (!c || /^(#{2,3}\s|>\s?|[-*]\s|\d+\.\s|<)/.test(c)) break;
      para.push(c); i++;
    }
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

/* 본문 첫 문단을 요약으로 (설명이 비어 있을 때만 씀) */
function firstText(html, n = 150) {
  const s = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* ── 페이지 틀 ─────────────────────────────────────── */
function pageHtml({ css, slug, meta, bodyHtml, others }) {
  const title = meta.title || '칼럼';
  const seoTitle = meta.seo_title || `${title} | 교육협동조합 세움`;
  const desc = meta.description || firstText(bodyHtml);
  const date = (meta.date || '').slice(0, 10);
  const author = meta.author || '교육협동조합 세움';
  const kicker = meta.kicker || '칼럼';
  const lead = meta.lead ? `<p class="lead">${inline(meta.lead)}</p>` : '';
  const url = `${SITE}/column/${slug}/`;

  const ld = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: title, description: desc, datePublished: date,
    author: { '@type': 'Person', name: author },
    publisher: {
      '@type': 'Organization', name: '교육협동조합 세움', url: SITE,
      logo: { '@type': 'ImageObject', url: `${SITE}/images/logo-seum.jpg` }
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: `${SITE}/files/og-seum.png`, inLanguage: 'ko'
  };

  /* 다른 칼럼 최대 2개 + 주요 안내 페이지 고정 링크 */
  const rel = [
    ...others.slice(0, 2).map(o => `<a href="/column/${o.slug}/">${esc(o.meta.title || o.slug)}</a>`),
    '<a href="/work-experience/">느린학습자(경계선지능) 청년 취업·일경험 지원</a>',
    '<a href="/about-slow-learner/">경계선지능이란? 부모가 가장 많이 묻는 질문</a>'
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(seoTitle)}</title>
<meta name="description" content="${esc(desc)}">
${meta.keywords ? `<meta name="keywords" content="${esc(meta.keywords)}">` : ''}
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(seoTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="article:published_time" content="${date}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="교육협동조합 세움">
<meta property="og:image" content="${SITE}${meta.image ? '/' + String(meta.image).replace(/^\//, '') : '/files/og-seum.png'}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}${meta.image ? '/' + String(meta.image).replace(/^\//, '') : '/files/og-seum.png'}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<style>
${css}
${COLUMN_CSS}
</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
${TOPBAR}
<main class="pg">
<div class="crumb"><a href="/">홈</a> › <a href="/column/">칼럼</a> › ${esc(kicker)}</div>
<span class="eyebrow" style="color:var(--teal-d);font-weight:700;font-size:.85rem;letter-spacing:.08em">${esc(kicker)}</span>
<h1 style="font-size:clamp(1.85rem,3.1vw,2.5rem);margin:.6rem 0 0">${esc(title)}</h1>
<div class="meta"><span class="pill">칼럼</span><span>${date.replace(/-/g, '.')}</span><span>글 · ${esc(author)}</span></div>
${lead}
${bodyHtml}
${meta.note ? `<div class="note">${inline(meta.note)}</div>` : ''}
<div class="cta">
<h2 style="margin:0 0 .6rem;font-size:1.22rem;border:0;padding:0">느린학습자(경계선지능) 청년의 일경험이 궁금하시면</h2>
<p style="margin:0 0 .8rem">청년 본인, 보호자, 학교·기관·기업 담당자 누구나 편하게 문의하실 수 있습니다.</p>
<p style="margin:0"><a href="tel:053-795-2013">📞 053-795-2013</a> &nbsp;·&nbsp; <a href="/work-experience/">일경험 지원 안내 보기 ›</a></p>
</div>
<div class="rel">
<strong style="color:var(--ink3);font-size:.9rem">함께 보면 좋은 글</strong>
${rel}
<a href="/column/">칼럼 전체 보기</a>
</div>
</main>
</body></html>`;
}

/* 「함께 일하는 방법」 시리즈 안내 — 발행된 편은 링크, 안 된 편은 '준비 중' */
const SERIES = [
  ['how-to-work-together-1', '정서 — 태도 문제로 보이던 것의 정체'],
  ['how-to-work-together-2', '시간 — 두 달이 주어졌을 때 달라진 것'],
  ['how-to-work-together-3', '환경 — 준비된 자리는 무엇이 다른가'],
];

function seriesBox(cols) {
  const have = new Set(cols.map(c => c.slug));
  const rows = SERIES.map(([slug, label]) => have.has(slug)
    ? `<li><a href="/column/${slug}/">${label}</a> <span style="color:var(--ink3)">(발행)</span></li>`
    : `<li>${label} <span style="color:var(--ink3)">(준비 중)</span></li>`).join('');
  return `<div class="series">
<h2 style="font-size:1.2rem;margin:0">「함께 일하는 방법」 시리즈</h2>
<p style="margin:.6rem 0 0">사업장이 몰랐던 것은 마음이 아니었습니다. 느린학습자(경계선지능)가 어떤 사람인지, 그리고 함께 일하는 방법. 몰라서 못 한 것이니 알려드리면 되는 문제였습니다.</p>
<ol>${rows}</ol>
</div>`;
}

function listHtml({ css, cols }) {
  const cards = cols.map(c => `
<a class="card" href="/column/${c.slug}/">
  <div class="k">${esc(c.meta.kicker || '칼럼')}</div>
  <h2>${esc(c.meta.title || c.slug)}</h2>
  <p>${esc(c.meta.description || firstText(c.bodyHtml, 110))}</p>
  <div class="m">${(c.meta.date || '').slice(0, 10).replace(/-/g, '.')} · ${esc(c.meta.author || '교육협동조합 세움')}</div>
</a>`).join('\n');

  const ld = {
    '@context': 'https://schema.org', '@type': 'Blog',
    name: '교육협동조합 세움 칼럼', url: `${SITE}/column/`,
    description: '느린학습자(경계선지능) 청년의 취업과 일경험, 노동인권 교육 현장 기록',
    publisher: { '@type': 'Organization', name: '교육협동조합 세움', url: SITE },
    inLanguage: 'ko'
  };

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>칼럼 | 느린학습자(경계선지능) 청년과 함께 일하는 이야기 | 교육협동조합 세움</title>
<meta name="description" content="대구 교육협동조합 세움이 현장에서 쓰는 글. 느린학습자(경계선지능) 청년의 취업과 일경험, 노동인권 교육에서 배운 것을 기록합니다.">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="canonical" href="${SITE}/column/">
<meta property="og:title" content="칼럼 | 교육협동조합 세움">
<meta property="og:description" content="느린학습자(경계선지능) 청년과 함께 일하며 배운 것을 현장에서 기록합니다.">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/column/">
<meta property="og:site_name" content="교육협동조합 세움">
<meta property="og:image" content="${SITE}/files/og-seum.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}/files/og-seum.png">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<style>
${css}
${LIST_CSS}
</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
${TOPBAR}
<main class="pg">
<div class="crumb"><a href="/">홈</a> › 칼럼</div>
<span class="eyebrow" style="color:var(--teal-d);font-weight:700;font-size:.85rem;letter-spacing:.08em">칼럼</span>
<h1 style="font-size:clamp(1.9rem,3.2vw,2.6rem);margin:.6rem 0 1.2rem">현장에서 쓰는 글</h1>
<p style="font-size:1.12rem;color:var(--ink);margin-bottom:2rem">느린학습자(경계선지능) 청년과 함께 일하며 배운 것을 기록합니다. 모집 공고가 담지 못하는 이야기들입니다.</p>
${cards}
${seriesBox(cols)}
<div style="border-top:1px solid var(--line);margin-top:2.5rem;padding-top:1.5rem">
<strong style="color:var(--ink3);font-size:.9rem">함께 보면 좋은 페이지</strong>
<a style="display:block;margin:.55rem 0;font-weight:600" href="/work-experience/">느린학습자(경계선지능) 청년 취업·일경험 지원</a>
<a style="display:block;margin:.55rem 0;font-weight:600" href="/about-slow-learner/">경계선지능이란? 부모가 가장 많이 묻는 질문</a>
<a style="display:block;margin:.55rem 0;font-weight:600" href="/daegu/">대구 경계선지능·느린학습자 지원 안내</a>
</div>
</main>
</body></html>`;
}

const TOPBAR = `<header class="topbar"><div class="wrap">
<a href="/" style="color:var(--teal-d);font-weight:800">교육협동조합 세움</a>
<a href="/column/">칼럼</a><a href="/work-experience/">일경험</a><a href="/#news">소식</a><a href="/#contact">문의</a>
</div></header>`;

const COLUMN_CSS = `
.pg{max-width:760px;margin:0 auto;padding:3.5rem 2rem 5rem}
.pg h2{font-size:1.5rem;margin:3rem 0 1rem;color:var(--ink);padding-top:.4rem;border-top:1px solid var(--line)}
.pg h3{font-size:1.12rem;margin:2rem 0 .6rem;color:var(--teal-d)}
.pg p{margin:0 0 1.15rem;color:var(--ink2);font-size:1.05rem;line-height:1.85}
.pg ul,.pg ol{margin:0 0 1.3rem;padding-left:1.2rem;color:var(--ink2);line-height:1.85}
.pg li{margin:.45rem 0}
.pg strong{color:var(--ink)}
.pg blockquote{margin:1.4rem 0;padding:1.1rem 1.4rem;background:var(--teal-l);border-radius:12px;color:var(--ink);font-weight:600}
.pg blockquote p{margin:.25rem 0;color:var(--ink)}
.pg img{max-width:100%;height:auto;border-radius:12px;border:1px solid var(--line);margin:1.2rem 0}
.lead{font-size:1.16rem;color:var(--ink);margin:1.4rem 0 2.2rem;line-height:1.8}
.meta{color:var(--ink3);font-size:.92rem;margin:.8rem 0 0;display:flex;gap:.7rem;flex-wrap:wrap;align-items:center}
.meta .pill{background:var(--amber-l);color:var(--amber-t);padding:.2rem .7rem;border-radius:999px;font-weight:700;font-size:.85rem}
.cta{background:var(--teal-l);border-radius:16px;padding:1.8rem;margin:3rem 0 0}
.crumb{font-size:.88rem;color:var(--ink3);margin-bottom:1rem}
.rel{border-top:1px solid var(--line);margin-top:2.5rem;padding-top:1.5rem}
.rel a{display:block;margin:.55rem 0;font-weight:600}
.topbar{border-bottom:1px solid var(--line);background:var(--surface)}
.topbar .wrap{display:flex;align-items:center;gap:1.2rem;padding:1rem 2rem}
.topbar a{color:var(--ink2);font-weight:600;font-size:.95rem}
.note{font-size:.9rem;color:var(--ink3);border-top:1px solid var(--line);margin-top:2rem;padding-top:1rem}
`;

const LIST_CSS = `
.pg{max-width:820px;margin:0 auto;padding:3.5rem 2rem 5rem}
.pg p{color:var(--ink2)}
.crumb{font-size:.88rem;color:var(--ink3);margin-bottom:1rem}
.topbar{border-bottom:1px solid var(--line);background:var(--surface)}
.topbar .wrap{display:flex;align-items:center;gap:1.2rem;padding:1rem 2rem}
.topbar a{color:var(--ink2);font-weight:600;font-size:.95rem}
.card{display:block;border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:1.6rem 1.8rem;margin:1rem 0;text-decoration:none;color:inherit;transition:box-shadow .2s}
.card:hover{box-shadow:var(--sh);text-decoration:none}
.card .k{color:var(--teal-d);font-weight:700;font-size:.85rem;letter-spacing:.06em}
.card h2{font-size:1.35rem;margin:.5rem 0 .6rem;color:var(--ink);line-height:1.4}
.card p{margin:0 0 .8rem;color:var(--ink2);font-size:1rem;line-height:1.7}
.card .m{color:var(--ink3);font-size:.88rem}
.series{background:var(--teal-l);border-radius:16px;padding:1.6rem 1.8rem;margin:2.5rem 0}
.series ol{margin:.8rem 0 0;padding-left:1.3rem;color:var(--ink2)}
.series li{margin:.4rem 0}
`;

/* ── 사이트맵 ──────────────────────────────────────── */
const FIXED = [
  ['/', 'weekly', '1.0'],
  ['/work-experience/', 'monthly', '0.9'],
  ['/about-slow-learner/', 'monthly', '0.9'],
  ['/daegu/', 'monthly', '0.8'],
  ['/column/', 'weekly', '0.8'],
];

async function writeSitemap(cols) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = FIXED.map(([loc, cf, pr]) =>
    `  <url><loc>${SITE}${loc}</loc><lastmod>${today}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`);
  for (const c of cols) {
    const d = (c.meta.date || today).slice(0, 10);
    rows.push(`  <url><loc>${SITE}/column/${c.slug}/</loc><lastmod>${d}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
  await fs.writeFile(path.join(ROOT, 'sitemap.xml'), xml);
  log('사이트맵 갱신:', rows.length, '개 주소');
}


/* ── RSS 피드 (네이버 서치어드바이저용) ──────────────────
   네이버는 RSS로 새 글을 빠르게 물어간다.
   칼럼을 올리면 이 파일도 함께 갱신된다. */
function rfc822(d) {
  const dt = new Date((d || new Date().toISOString().slice(0, 10)) + 'T09:00:00+09:00');
  return isNaN(dt) ? new Date().toUTCString() : dt.toUTCString();
}

async function writeRss(cols) {
  const items = cols.map(c => {
    const url = `${SITE}/column/${c.slug}/`;
    const desc = c.meta.description || firstText(c.bodyHtml, 200);
    return `  <item>
    <title>${esc(c.meta.title || c.slug)}</title>
    <link>${url}</link>
    <guid isPermaLink="true">${url}</guid>
    <description>${esc(desc)}</description>
    <author>${esc(c.meta.author || '교육협동조합 세움')}</author>
    <pubDate>${rfc822((c.meta.date || '').slice(0, 10))}</pubDate>
  </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>교육협동조합 세움 · 현장에서 쓰는 글</title>
  <link>${SITE}/column/</link>
  <description>대구 느린학습자(경계선지능) 청년의 취업과 일경험, 노동인권 교육 현장 기록</description>
  <language>ko</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
  await fs.writeFile(path.join(ROOT, 'rss.xml'), xml);
  log('RSS 갱신:', cols.length, '건');
}

/* ── 실행 ─────────────────────────────────────────── */
async function main() {
  let files = [];
  try {
    files = (await fs.readdir(SRC)).filter(f => /\.md$/i.test(f));
  } catch {
    log('data/columns 폴더가 없습니다. 건너뜁니다.');
    return;
  }
  if (!files.length) { log('칼럼 원고가 없습니다. 건너뜁니다.'); return; }

  const site = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const css = (site.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  if (!css) { log('index.html 에서 디자인(style)을 찾지 못했습니다. 중단합니다.'); return; }

  const cols = [];
  for (const f of files) {
    const raw = await fs.readFile(path.join(SRC, f), 'utf8');
    const { meta, body } = parseFront(raw);
    if (String(meta.draft).toLowerCase() === 'true') { log('초안이라 건너뜀:', f); continue; }
    const slug = (meta.slug || f.replace(/\.md$/i, '')).trim();
    cols.push({ slug, meta, bodyHtml: mdToHtml(body) });
  }
  if (!cols.length) { log('공개할 칼럼이 없습니다.'); return; }

  cols.sort((a, b) => String(b.meta.date || '').localeCompare(String(a.meta.date || '')));

  for (const c of cols) {
    const others = cols.filter(o => o.slug !== c.slug);
    const dir = path.join(OUT, c.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), pageHtml({ css, slug: c.slug, meta: c.meta, bodyHtml: c.bodyHtml, others }));
    log('생성:', `/column/${c.slug}/`);
  }

  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'index.html'), listHtml({ css, cols }));
  log('생성: /column/ (목록', cols.length, '건)');

  await writeSitemap(cols);
  await writeRss(cols);
  log('완료');
}

main().catch(e => {
  console.error('[칼럼] 오류가 났지만 배포는 계속합니다:', e && e.message);
});
