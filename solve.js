// solve.js — makefun-site 1.0.0, réécrit pour être plus rapide.
// Le résultat est identique, octet pour octet, à celui du générateur de référence du kit
// (baselines/makefun-site/vendor/makefun-site/) : mêmes règles, même ordre, même rapport.
//
// Les trois leviers, par rapport à la référence :
//   1. l'échappement HTML rend le texte tel quel quand il n'y a rien à échapper ;
//   2. le Markdown se lit par positions dans le texte source, sans découper les lignes ;
//   3. chaque gabarit est traduit une fois en une fonction JavaScript au lieu d'être interprété.

// ---------------------------------------------------------------- texte

const SLUG_MAX = 64;
const RE_NON_ASCII = /[^\x00-\x7f]/;
const RE_MARKS = /\p{M}/gu;
const SLUG_CACHE = new Map();

const RE_ESCAPE = /[&<>"']/g;
const RE_ANY = /[&<>"']/;
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escReplace = (c) => ESCAPES[c];

/** `& < > " '` échappés ; le texte lui-même quand il n'y a rien à échapper. */
function esc(text) {
  return RE_ANY.test(text) ? text.replace(RE_ESCAPE, escReplace) : text;
}

/** Le slug d'un texte : NFKD, marques retirées, A-Z baissé, toute autre suite un « - ». */
function slugify(text) {
  const cached = SLUG_CACHE.get(text);
  if (cached !== undefined) return cached;
  let plain = text;
  if (RE_NON_ASCII.test(plain)) plain = plain.normalize('NFKD').replace(RE_MARKS, '');
  let out = '';
  let gap = false;
  const n = plain.length;
  for (let i = 0; i < n; i++) {
    const c = plain.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
      if (gap && out.length > 0) { out += '-'; gap = false; }
      out += plain[i];
    } else if (c >= 65 && c <= 90) {
      if (gap && out.length > 0) { out += '-'; gap = false; }
      out += String.fromCharCode(c + 32);
    } else if (c >= 0xd800 && c <= 0xdbff) {
      i++;
      if (out.length > 0) gap = true;
    } else if (out.length > 0) {
      gap = true;
    }
  }
  if (out.length > SLUG_MAX) {
    out = out.slice(0, SLUG_MAX);
    if (out.charCodeAt(out.length - 1) === 45) out = out.slice(0, out.length - 1);
  }
  if (out === '') out = 'untitled';
  SLUG_CACHE.set(text, out);
  return out;
}

/** Le slug rendu unique dans `taken` (et ajouté). */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = slug + '-' + n;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** « 2026-11-09 » devient « 9 November 2026 ». */
function longDate(date) {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/** Les mots d'un corps : ses suites de caractères non blancs. */
function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const space =
      c === 32 || (c >= 9 && c <= 13) || c === 160 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
      c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
    if (space) inWord = false;
    else if (!inWord) { inWord = true; n++; }
  }
  return n;
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const FM_LINE = /^([a-z_]+):(?: (.*))?$/;
const FM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FM_NAME = /^[a-z0-9-]+$/;
const FM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FM_TAG = /^[^"[\]]+$/;
const RE_BLANK_LINE = /^[ \t]*$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    const n = raw.length - 1;
    for (let i = 1; i < n; i++) {
      const c = raw[i];
      if (c === '\\') {
        const x = raw[i + 1];
        if ((x !== '"' && x !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += x;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return s.error !== undefined ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = FM_DATE.exec(raw);
      if (m === null) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      const y = +m[1], mo = +m[2], d = +m[3];
      if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const parts = inner.split(',');
      const tags = [];
      for (let i = 0; i < parts.length; i++) {
        const t = parts[i].trim();
        if (t === '' || !FM_TAG.test(t)) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        tags.push(t);
      }
      return { value: tags };
    }
    case 'draft':
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: 'key "draft": true or false' };
    case 'layout':
      return FM_NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return FM_SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

/** { data, body } ou { error } : le premier motif de refus. */
function parseFrontMatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (RE_BLANK_LINE.test(line) || line.charCodeAt(0) === 35) continue;
    const m = FM_LINE.exec(line);
    if (m === null) return { error: `line ${i + 1} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if (v.error !== undefined) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: lines.slice(close + 1).join('\n') };
}

// ---------------------------------------------------------------- résolution des liens

let CUR_PATH = '';
let CUR_DIR = '';
let CUR_BY_SOURCE = null;
let CUR_STATICS = null;
let CUR_BASE = '';
let CUR_BROKEN = null;
const LINK_CACHE = new Map();
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** `rel` depuis le dossier `dir`, ou null quand il sort de la racine. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  const segs = rel.split('/');
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** L'href d'un lien, et le lien cassé signalé. */
function resolveLink(target) {
  const c0 = target.charCodeAt(0);
  if (c0 === 47 || c0 === 35 || SCHEME.test(target)) return target;
  const key = CUR_DIR + '\u0000' + target;
  const hit = LINK_CACHE.get(key);
  if (hit !== undefined) {
    if (hit.broken) CUR_BROKEN.add('broken-link ' + CUR_PATH + ' -> ' + target);
    return hit.href;
  }
  const hash = target.indexOf('#');
  const rel = hash === -1 ? target : target.slice(0, hash);
  const frag = hash === -1 ? '' : target.slice(hash);
  const path = rel === '' ? null : resolvePath(CUR_DIR, rel);
  let out;
  let broken = false;
  if (path !== null && CUR_BY_SOURCE.has(path)) out = CUR_BY_SOURCE.get(path).url + frag;
  else if (path !== null && CUR_STATICS.has(path)) out = CUR_BASE + '/' + path + frag;
  else {
    CUR_BROKEN.add('broken-link ' + CUR_PATH + ' -> ' + target);
    out = target;
    broken = true;
  }
  LINK_CACHE.set(key, { href: out, broken });
  return out;
}

// ---------------------------------------------------------------- Markdown

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const RE_INLINE_WS = /\s/;
const CLOSE_TICK = '`';
const TWO_STAR = '**';
const CLOSE_BRACKET = ']';
const CLOSE_PAREN = ')';
const P_OPEN = '<p>', P_CLOSE = '</p>';
const CODE_OPEN = '<code>', CODE_CLOSE = '</code>';
const STRONG_OPEN = '<strong>', STRONG_CLOSE = '</strong>';
const EM_OPEN = '<em>', EM_CLOSE = '</em>';
const LINK_OPEN = '<a href="', LINK_MID = '">', LINK_CLOSE = '</a>';
const PRE_OPEN = '<pre><code', PRE_CLOSE = '</code></pre>';

const lineEndOf = (src, p) => {
  const k = src.indexOf('\n', p);
  return k === -1 ? src.length : k;
};

const skipBlanks = (src, p, e) => {
  while (p < e) {
    const c = src.charCodeAt(p);
    if (c !== 32 && c !== 9) break;
    p++;
  }
  return p;
};

const trimEndOf = (src, p, e) => {
  while (e > p) {
    const c = src.charCodeAt(e - 1);
    if (c !== 32 && c !== 9) break;
    e--;
  }
  return e;
};

/** Un titre : [niveau, début du texte, fin du texte] ou null. */
function headingTextRange(src, p, e) {
  let h = 0;
  while (h < 6 && p + h < e && src.charCodeAt(p + h) === 35) h++;
  if (h === 0 || p + h >= e) return null;
  const c = src.charCodeAt(p + h);
  if (c !== 32 && c !== 9) return null;
  const ts = skipBlanks(src, p + h, e);
  const te = trimEndOf(src, ts, e);
  if (ts >= te) return null;
  return [h, ts, te];
}

function isHrAt(src, p, e) {
  const c = src.charCodeAt(p);
  let ok;
  if (c === 45) ok = e - p >= 3 && src.charCodeAt(p + 1) === 45 && src.charCodeAt(p + 2) === 45;
  else if (c === 42) ok = e - p >= 3 && src.charCodeAt(p + 1) === 42 && src.charCodeAt(p + 2) === 42;
  else return false;
  if (!ok) return false;
  for (let i = p + 3; i < e; i++) {
    const x = src.charCodeAt(i);
    if (x !== 32 && x !== 9) return false;
  }
  return true;
}

/** Une clôture ``` ouvrant la ligne : [début, fin] du langage, ou null. */
function fenceAt(src, p, e) {
  if (e - p < 3 || src.charCodeAt(p) !== 96 || src.charCodeAt(p + 1) !== 96 || src.charCodeAt(p + 2) !== 96) return null;
  let j = p + 3;
  while (j < e) {
    const c = src.charCodeAt(j);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45;
    if (!ok) break;
    j++;
  }
  for (let k = j; k < e; k++) {
    const c = src.charCodeAt(k);
    if (c !== 32 && c !== 9) return null;
  }
  return [p + 3, j];
}

function isFenceCloseAt(src, p, e) {
  if (e - p < 3 || src.charCodeAt(p) !== 96 || src.charCodeAt(p + 1) !== 96 || src.charCodeAt(p + 2) !== 96) return false;
  for (let i = p + 3; i < e; i++) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function bulletAt(src, p, e) {
  if (e - p < 2) return -1;
  const c = src.charCodeAt(p);
  if ((c === 45 || c === 42) && src.charCodeAt(p + 1) === 32) return p + 2;
  return -1;
}

function orderedAt(src, p, e) {
  let d = 0;
  while (p + d < e && d <= 9) {
    const c = src.charCodeAt(p + d);
    if (c >= 48 && c <= 57) d++;
    else break;
  }
  if (d === 0 || d > 9) return null;
  if (src.charCodeAt(p + d) !== 46 || src.charCodeAt(p + d + 1) !== 32) return null;
  return { start: Number(src.slice(p, p + d)), text: p + d + 2 };
}

function continuedAt(src, p, e) {
  let k = 0;
  while (p + k < e && src.charCodeAt(p + k) === 32) k++;
  return k >= 2 && p + k < e;
}

/** Le caractère en `k` est-il échappé par une barre oblique inverse ? */
function escapedAt(s, k) {
  let b = 0;
  let i = k - 1;
  while (i >= 0 && s.charCodeAt(i) === 92) { b++; i--; }
  return (b & 1) === 1 && ESCAPABLE.has(s[k]);
}

function findUnescapedIn(s, what, from, end) {
  let j = from;
  for (;;) {
    const k = s.indexOf(what, j);
    if (k === -1 || k > end - what.length) return -1;
    if (escapedAt(s, k)) { j = k + 1; continue; }
    return k;
  }
}

function findSingleStarIn(s, from, end) {
  let j = from;
  for (;;) {
    const k = s.indexOf('*', j);
    if (k === -1 || k >= end) return -1;
    if (escapedAt(s, k)) { j = k + 1; continue; }
    if (s.charCodeAt(k + 1) === 42) { j = k + 2; continue; }
    return k;
  }
}

/**
 * Le texte de `[p, e)` rendu en ligne. Deux temps : on repère les marques (aucune chaîne créée),
 * puis on rend, les morceaux de texte nu partant entiers à l'échappement.
 */
const RE_SPECIAL = /[\\`*[]/g;

function inlineRange(src, p, e) {
  // voie rapide : aucun caractere de marque dans l'intervalle
  RE_SPECIAL.lastIndex = p;
  const hit = RE_SPECIAL.exec(src);
  if (hit === null || hit.index >= e) return esc(src.slice(p, e));
  const pos = [];
  const kinds = [];
  const paren = src.indexOf('(', p);
  let i = p;
  while (i < e) {
    const c = src.charCodeAt(i);
    if (c === 92) {
      if (i + 1 < e && ESCAPABLE.has(src[i + 1])) { pos.push(i); kinds.push(1); i += 2; continue; }
      i++; continue;
    }
    if (c === 96) {
      const j = src.indexOf(CLOSE_TICK, i + 1);
      if (j > i + 1 && j < e) { pos.push(i); kinds.push(2); i = j + 1; continue; }
      i++; continue;
    }
    if (c === 42) {
      if (i + 1 < e && src.charCodeAt(i + 1) === 42) {
        const j = findUnescapedIn(src, TWO_STAR, i + 2, e);
        if (j > i + 2) { pos.push(i); kinds.push(3); i = j + 2; continue; }
        i += 2; continue;
      }
      const j = findSingleStarIn(src, i + 1, e);
      if (j > i + 1) { pos.push(i); kinds.push(4); i = j + 1; continue; }
      i++; continue;
    }
    if (c === 91 && paren >= 0 && paren < e) {
      const k = findUnescapedIn(src, CLOSE_BRACKET, i + 1, e);
      const m = k !== -1 && k + 1 < e && src.charCodeAt(k + 1) === 40 ? src.indexOf(CLOSE_PAREN, k + 2) : -1;
      if (m !== -1 && m < e) {
        const target = src.slice(k + 2, m);
        if (target !== '' && !RE_INLINE_WS.test(target)) {
          pos.push(i); kinds.push(5); pos.push(k); kinds.push(6); pos.push(m); kinds.push(7);
          i = m + 1;
          continue;
        }
      }
      i++; continue;
    }
    i++;
  }
  if (pos.length === 0) return esc(src.slice(p, e));

  let out = '';
  let plain = p;
  for (let k = 0; k < pos.length; k++) {
    const at = pos[k];
    const kind = kinds[k];
    if (kind !== 1 && kind !== 2 && kind !== 3 && kind !== 4 && kind !== 5) continue;
    if (at > plain) out += esc(src.slice(plain, at));
    if (kind === 1) {
      out += esc(src[at + 1]);
      plain = at + 2;
    } else if (kind === 2) {
      const j = src.indexOf(CLOSE_TICK, at + 1);
      out += CODE_OPEN + esc(src.slice(at + 1, j)) + CODE_CLOSE;
      plain = j + 1;
    } else if (kind === 3) {
      const j = findUnescapedIn(src, TWO_STAR, at + 2, e);
      out += STRONG_OPEN + inlineRange(src, at + 2, j) + STRONG_CLOSE;
      plain = j + 2;
    } else if (kind === 4) {
      const j = findSingleStarIn(src, at + 1, e);
      out += EM_OPEN + inlineRange(src, at + 1, j) + EM_CLOSE;
      plain = j + 1;
    } else {
      const kk = pos[k + 1];
      const m = pos[k + 2];
      out += LINK_OPEN + esc(resolveLink(src.slice(kk + 2, m))) + LINK_MID + inlineRange(src, at + 1, kk) + LINK_CLOSE;
      plain = m + 1;
      k += 2;
    }
  }
  if (plain < e) out += esc(src.slice(plain, e));
  return out;
}

/** Le rendu en ligne d'une chaîne déjà assemblée (un titre de liste, une citation). */
const inline = (s) => inlineRange(s, 0, s.length);

/** Le corps rendu : son HTML, sa table des matières (niveaux 2 et 3) et son extrait. */
function renderMarkdown(src) {
  const n = src.length;
  const ids = new Set();
  let out = '';
  const toc = [];
  let excerpt = null;
  let p = 0;
  while (p < n) {
    let e = lineEndOf(src, p);

    const first = skipBlanks(src, p, e);
    if (first >= e) { p = e + 1; continue; }

    // bloc de code
    const fence = fenceAt(src, p, e);
    if (fence !== null) {
      const lang = src.slice(fence[0], fence[1]);
      p = e + 1;
      let body = '';
      while (p < n) {
        const pe = lineEndOf(src, p);
        if (isFenceCloseAt(src, p, pe)) { p = pe + 1; break; }
        body += esc(src.slice(p, pe)) + '\n';
        p = pe + 1;
      }
      out += PRE_OPEN + (lang === '' ? '' : ' class="language-' + esc(lang) + '"') + '>' + body + PRE_CLOSE + '\n';
      continue;
    }

    // titre
    const h = headingTextRange(src, p, e);
    if (h !== null) {
      const text = src.slice(h[1], h[2]);
      const id = uniqueSlug(slugify(text), ids);
      const html = inlineRange(src, h[1], h[2]);
      out += '<h' + h[0] + ' id="' + id + '">' + html + '</h' + h[0] + '>' + '\n';
      if (h[0] === 2 || h[0] === 3) toc.push({ level: h[0], id, html });
      p = e + 1;
      continue;
    }

    // séparation
    if (isHrAt(src, p, e)) { out += '<hr>\n'; p = e + 1; continue; }

    // citation
    if (src.charCodeAt(p) === 62) {
      const parts = [];
      while (p < n) {
        const pe = lineEndOf(src, p);
        if (src.charCodeAt(p) !== 62) break;
        const s0 = src.charCodeAt(p + 1) === 32 ? p + 2 : p + 1;
        const t0 = skipBlanks(src, s0, pe);
        const t1 = trimEndOf(src, t0, pe);
        if (t1 > t0) parts.push(src.slice(t0, t1));
        p = pe + 1;
      }
      out += (parts.length === 0
        ? '<blockquote>\n</blockquote>'
        : '<blockquote>\n<p>' + inline(parts.join('\n')) + '</p>\n</blockquote>') + '\n';
      continue;
    }

    // listes
    const b0 = bulletAt(src, p, e);
    const o0 = b0 === -1 ? orderedAt(src, p, e) : null;
    if (b0 !== -1 || o0 !== null) {
      const isOrdered = o0 !== null;
      const start = isOrdered ? o0.start : 1;
      const items = [];
      let cur = null;
      while (p < n) {
        const pe = lineEndOf(src, p);
        if (isOrdered) {
          const o = orderedAt(src, p, pe);
          if (o !== null) { cur = [src.slice(o.text, trimEndOf(src, o.text, pe))]; items.push(cur); p = pe + 1; continue; }
        } else {
          const b = bulletAt(src, p, pe);
          if (b !== -1) { cur = [src.slice(b, trimEndOf(src, b, pe))]; items.push(cur); p = pe + 1; continue; }
        }
        if (cur !== null && continuedAt(src, p, pe)) {
          const t0 = skipBlanks(src, p, pe);
          cur.push(src.slice(t0, trimEndOf(src, t0, pe)));
          p = pe + 1;
          continue;
        }
        break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      let html = (isOrdered && start !== 1 ? '<ol start="' + start + '">' : '<' + tag + '>') + '\n';
      for (let k = 0; k < items.length; k++) html += '<li>' + inline(items[k].join('\n')) + '</li>\n';
      out += html + '</' + tag + '>' + '\n';
      continue;
    }

    // paragraphe
    const body = [];
    {
      const t0 = skipBlanks(src, p, e);
      body.push(src.slice(t0, trimEndOf(src, t0, e)));
      p = e + 1;
      while (p < n) {
        const pe = lineEndOf(src, p);
        const f0 = skipBlanks(src, p, pe);
        if (f0 >= pe) break;
        if (fenceAt(src, p, pe) !== null || headingTextRange(src, p, pe) !== null || isHrAt(src, p, pe)) break;
        body.push(src.slice(f0, trimEndOf(src, f0, pe)));
        p = pe + 1;
      }
    }
    const html = inline(body.join('\n'));
    if (excerpt === null) excerpt = html;
    out += P_OPEN + html + P_CLOSE + '\n';
  }
  return { html: out, toc, excerpt: excerpt === null ? '' : excerpt };
}

// ---------------------------------------------------------------- gabarits

const T_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const T_FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const T_IF = /^if (not )?(\S+)$/;
const T_INC = /^include "([a-z0-9-]+)"$/;
const RE_INDENT = /^[ \t]*$/;
const INCLUDE_DEPTH = 8;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!T_PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === n - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? n : nl;
    const standalone = RE_INDENT.test(src.slice(lineStart, open)) && RE_INDENT.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? n : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = T_FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = T_IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = T_INC.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function lookup(scope, path) {
  const first = path[0];
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, first)) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[first];
  if (path.length === 1) return v;
  if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[1])) return undefined;
  v = v[path[1]];
  for (let k = 2; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

const NUM_TEXT = [];
for (let i = 0; i < 256; i++) NUM_TEXT.push(String(i));

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return (v >= 0 && v < 256 && (v | 0) === v) ? NUM_TEXT[v] : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let out = '';
    for (let k = 0; k < v.length; k++) out += (k === 0 ? '' : ', ') + textOf(v[k]);
    return out;
  }
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** Le rendu de secours : l'arbre parcouru nœud par nœud (si la traduction échoue). */
function renderNodes(nodes, scope, ctx, depth, acc) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const k = n.kind;
    if (k === 'text') acc.push(n.text);
    else if (k === 'var') acc.push(esc(textOf(lookup(scope, n.path))));
    else if (k === 'raw') acc.push(textOf(lookup(scope, n.path)));
    else if (k === 'if') {
      const v = truthy(lookup(scope, n.path));
      const branch = v !== n.not ? n.then : n.else;
      if (branch !== null) renderNodes(branch, scope, ctx, depth, acc);
    } else if (k === 'for') {
      const xs = lookup(scope, n.path);
      if (Array.isArray(xs)) {
        const len = xs.length;
        for (let j = 0; j < len; j++) {
          const vars = {};
          vars[n.name] = xs[j];
          vars.loop = { index: j + 1, first: j === 0, last: j === len - 1, length: len };
          renderNodes(n.body, { vars, parent: scope }, ctx, depth, acc);
        }
      }
    } else if (k === 'include') {
      const t = ctx.templates.get(n.name);
      if (t !== undefined && depth < INCLUDE_DEPTH) renderNodes(t, scope, ctx, depth + 1, acc);
    }
  }
}

// --- traduction d'un gabarit en fonction ---

const COMPILED = new WeakMap();
let SCOPE_SEQ = 0;

function emitNodes(nodes, tab, svar) {
  const out = tab.out;
  /** Le nom de la constante qui porte ce chemin (une allocation par chemin et par gabarit). */
  const P = (path) => {
    const key = path.join('.');
    let name = tab.paths.get(key);
    if (name === undefined) {
      name = 'p' + tab.paths.size;
      tab.paths.set(key, name);
      tab.defs.push('const ' + name + '=' + JSON.stringify(path) + ';');
    }
    return name;
  };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const k = n.kind;
    if (k === 'text') {
      out.push('o+=' + JSON.stringify(n.text) + ';');
    } else if (k === 'var') {
      out.push('o+=ctx.esc(ctx.text(ctx.get(' + svar + ',' + P(n.path) + ')));');
    } else if (k === 'raw') {
      out.push('o+=ctx.text(ctx.get(' + svar + ',' + P(n.path) + '));');
    } else if (k === 'if') {
      out.push('if(ctx.truthy(ctx.get(' + svar + ',' + P(n.path) + '))!==' + (n.not ? 'true' : 'false') + '){');
      emitNodes(n.then, tab, svar);
      if (n.else !== null) {
        out.push('}else{');
        emitNodes(n.else, tab, svar);
      }
      out.push('}');
    } else if (k === 'for') {
      const inner = 's' + (SCOPE_SEQ++);
      // la portee et l'objet des variables sont crees une fois pour la boucle : le rendu est synchrone
      out.push('{const xs=ctx.get(' + svar + ',' + P(n.path) + ');if(Array.isArray(xs)){const len=xs.length;'
        + 'const vars={};const loop={index:0,first:false,last:false,length:len};vars.loop=loop;'
        + 'const ' + inner + '={vars,parent:' + svar + '};'
        + 'for(let k=0;k<len;k++){vars[' + JSON.stringify(n.name) + ']=xs[k];'
        + 'loop.index=k+1;loop.first=k===0;loop.last=k===len-1;');
      emitNodes(n.body, tab, inner);
      out.push('}}}');
    } else if (k === 'include') {
      out.push('o+=ctx.inc(' + JSON.stringify(n.name) + ',' + svar + ',depth);');
    }
  }
}

/** `nodes` traduits en une fonction (scope, ctx, depth) => texte. */
function compileTemplate(nodes) {
  const cached = COMPILED.get(nodes);
  if (cached !== undefined) return cached;
  const tab = { out: [], defs: [], paths: new Map() };
  SCOPE_SEQ = 0;
  emitNodes(nodes, tab, 'scope');
  const src = 'return (function(){' + tab.defs.join('') + '\nreturn function(scope,ctx,depth){let o="";'
    + tab.out.join('') + '\nreturn o};})()';
  let fn;
  try {
    fn = new Function(src)();
  } catch (err) {
    fn = (scope, ctx, depth) => {
      const acc = [];
      renderNodes(nodes, scope, ctx, depth, acc);
      return acc.join('');
    };
  }
  COMPILED.set(nodes, fn);
  return fn;
}

// --- gabarits invariants : leur rendu ne depend que de site, tags et recent ---
//
// Un gabarit qui ne lit que `site`, `tags` et `recent` (et les gabarits qu'il inclut) rend le meme texte
// pour toutes les pages d'un site : on le rend une fois. Tant que la profondeur d'inclusion permise n'est
// pas atteinte, le cache ne peut pas changer le resultat.

const INVARIANT_NAMES = new Set(['site', 'tags', 'recent']);

/** { pure, nest } : le gabarit ne lit que des valeurs fixes, et la profondeur de ses inclusions. */
function analyzeTemplate(nodes, templates, memo, name, stack) {
  const known = memo.get(name);
  if (known !== undefined) return known;
  if (stack.has(name)) return { pure: false, nest: INCLUDE_DEPTH };
  stack.add(name);
  let pure = true;
  let nest = 0;
  const walk = (list) => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.kind === 'text') continue;
      if (n.kind === 'include') {
        const sub = templates.get(n.name);
        if (sub !== undefined) {
          const a = analyzeTemplate(sub, templates, memo, n.name, stack);
          if (!a.pure) pure = false;
          if (a.nest + 1 > nest) nest = a.nest + 1;
        }
        continue;
      }
      if (!INVARIANT_NAMES.has(n.path[0])) pure = false;
      if (n.kind === 'if') {
        walk(n.then);
        if (n.else !== null) walk(n.else);
      } else if (n.kind === 'for') {
        if (INVARIANT_NAMES.has(n.name)) pure = false;
        walk(n.body);
      }
    }
  };
  walk(nodes);
  stack.delete(name);
  const out = { pure, nest };
  memo.set(name, out);
  return out;
}

// ---------------------------------------------------------------- le build

const REPORT_FILE = 'build-report.txt';
const RESERVED = ['posts', 'tags', 'page'];
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function cardOf(s) {
  const d = s.data;
  return {
    title: d.title,
    url: s.url,
    date: d.date ?? '',
    date_long: d.date === undefined ? '' : longDate(d.date),
    summary: d.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

const linkOf = (s) => (s === null ? null : {
  title: s.data.title,
  url: s.url,
  date: s.data.date ?? '',
  date_long: s.data.date === undefined ? '' : longDate(s.data.date),
});

function pageOf(s, card) {
  return {
    title: card.title,
    url: card.url,
    date: card.date,
    date_long: card.date_long,
    summary: card.summary,
    excerpt: card.excerpt,
    reading_minutes: card.reading_minutes,
    tags: card.tags,
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  };
}

export function run(input) {
  LINK_CACHE.clear();
  SLUG_CACHE.clear();
  const base = input.site.base_url.replace(/\/+$/, '');

  // 1. les gabarits
  const templates = new Map();
  const report = [];
  const names = Object.keys(input.templates).sort(byCodeUnits);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  // 2. les sources et les fichiers statiques
  const files = input.files.slice().sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else statics.push({ path: f.path, content: f.content });
  }

  // 3. le front matter, les refus et les brouillons
  const kept = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const fm = parseFrontMatter(s.text);
    if (fm.error !== undefined) { report.push('refused ' + s.path + ': ' + fm.error); continue; }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) { report.push(`refused ${s.path}: ${own}/ is the generator's own`); continue; }
    if (s.post && !Object.hasOwn(s.data, 'date')) { report.push(`refused ${s.path}: a post needs a date`); continue; }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) { report.push(`refused ${s.path}: layout "${layout}" is no template that parses`); continue; }
    s.layout = layout;
    if (s.data.draft === true) { report.push('draft ' + s.path); continue; }
    kept.push(s);
  }

  // 4. les permaliens
  const taken = new Map();
  const bySource = new Map();
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) { set = new Set(dir === '' ? RESERVED : []); taken.set(dir, set); }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }

  // 5. le Markdown, liens résolus
  const staticPaths = new Set();
  for (let i = 0; i < statics.length; i++) staticPaths.add(statics[i].path);
  CUR_BY_SOURCE = bySource;
  CUR_STATICS = staticPaths;
  CUR_BASE = base;
  CUR_BROKEN = new Set();
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    CUR_PATH = s.path;
    CUR_DIR = dirOf(s.path);
    const md = renderMarkdown(s.body);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }
  const broken = CUR_BROKEN;
  CUR_BY_SOURCE = CUR_STATICS = CUR_BROKEN = null;

  // 6. les billets, du plus récent au plus ancien
  const posts = [];
  for (let i = 0; i < kept.length; i++) if (kept[i].post) posts.push(kept[i]);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // 7. les étiquettes
  const bySlug = new Map();
  const ownTags = (s) => {
    const src = s.data.tags ?? [];
    const seen = new Set();
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const slug = slugify(src[i]);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(src[i]);
    }
    return out;
  };
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    p.tagRefs = [];
    const own = ownTags(p);
    for (let j = 0; j < own.length; j++) {
      const name = own[j];
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) { tag = { name, slug, url: base + '/tags/' + slug + '/', posts: [] }; bySlug.set(slug, tag); }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    if (s.post) continue;
    const own = ownTags(s);
    const refs = [];
    for (let j = 0; j < own.length; j++) {
      const name = own[j];
      const slug = slugify(name);
      refs.push(bySlug.get(slug) ?? { name, slug, url: '', posts: [] });
    }
    s.tagRefs = refs;
  }
  const tags = [...bySlug.values()].sort((x, y) => (y.posts.length - x.posts.length) || byCodeUnits(x.slug, y.slug));

  // 8. les pages
  const cards = new Map();
  for (let i = 0; i < posts.length; i++) cards.set(posts[i], cardOf(posts[i]));
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = [];
  const recentCount = Math.min(input.site.recent, posts.length);
  for (let i = 0; i < recentCount; i++) recent.push(cards.get(posts[i]));

  const ctx = {
    templates,
    esc,
    text: textOf,
    truthy,
    get: lookup,
    inc: (name, scope, depth) => {
      if (depth >= INCLUDE_DEPTH) return '';
      // un gabarit invariant rendu a profondeur 0 ne depend pas de la portee : on le rend une fois
      const frozen = INV_CACHE.get(name);
      if (frozen !== undefined) return frozen;
      const nodes = templates.get(name);
      if (nodes === undefined) return '';
      const text = compileTemplate(nodes)(scope, ctx, depth + 1);
      if (depth === 0 && INVARIANT.has(name)) INV_CACHE.set(name, text);
      return text;
    },
  };

  const INVARIANT = new Set();
  {
    const memo = new Map();
    for (const name of templates.keys()) {
      const a = analyzeTemplate(templates.get(name), templates, memo, name, new Set());
      if (a.pure && a.nest <= INCLUDE_DEPTH) INVARIANT.add(name);
    }
  }
  const INV_CACHE = new Map();

  const output = {};
  const render = (name, vars, keys) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const scopeVars = { site, tags: allTags, recent };
    for (let i = 0; i < keys.length; i++) scopeVars[keys[i]] = vars[i];
    const text = compileTemplate(nodes)({ vars: scopeVars, parent: null }, ctx, 0);
    // une chaîne bâtie par += est une chaîne de morceaux : une copie contiguë coûte moins cher à sérialiser
    return text.length > 4096 ? (' ' + text).slice(1) : text;
  };

  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    output[s.outDir + '/index.html'] = render(s.layout, [pageOf(s, cards.get(s) ?? cardOf(s))], ['page']);
  }

  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
  for (let k = 1; k <= pages; k++) {
    const slice = [];
    for (let j = (k - 1) * per; j < k * per && j < posts.length; j++) slice.push(cards.get(posts[j]));
    const html = render('index', [slice, {
      number: k,
      total: pages,
      url: indexUrl(k),
      newer_url: k === 1 ? '' : indexUrl(k - 1),
      older_url: k === pages ? '' : indexUrl(k + 1),
    }], ['posts', 'pager']);
    if (html !== null) output[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = html;
  }

  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    const tagCards = [];
    for (let j = 0; j < t.posts.length; j++) tagCards.push(cards.get(t.posts[j]));
    const html = render('tag', [{ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: tagCards }], ['tag']);
    if (html !== null) output['tags/' + t.slug + '/index.html'] = html;
  }
  const tagsHtml = render('tags', [], []);
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;

  for (let i = 0; i < statics.length; i++) {
    const f = statics[i];
    if (Object.hasOwn(output, f.path)) report.push('shadowed ' + f.path + ': a built page has its path');
    else output[f.path] = f.content;
  }

  // 9. le rapport
  const lines = report.concat([...broken]).sort(byCodeUnits);
  let pageCount = 0;
  for (let i = 0; i < kept.length; i++) if (!kept[i].post) pageCount++;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = lines.join('\n') + '\n';
  return output;
}
