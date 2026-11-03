const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

function deviceId() {
  try {
    let d = localStorage.getItem('sr_device');
    if (!d) {
      d = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(16).slice(2)).replace(/[^a-zA-Z0-9-]/g, '');
      localStorage.setItem('sr_device', d);
    }
    return d;
  } catch {
    return 'anon-' + Math.random().toString(16).slice(2, 12);
  }
}

/* ---------- 進行制御 (スキップ対応) ---------- */
const SKIP = Symbol('skip');
let skipNow;
const skipP = new Promise((r) => (skipNow = r));
const orSkip = (p) => Promise.race([p, skipP.then(() => { throw SKIP; })]);
const sleep = (ms) => orSkip(new Promise((r) => setTimeout(r, reduce ? Math.min(ms, 80) : ms)));
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

const state = { rally: null, spot: null, spots: [], collected: new Set(), already: false, app: {}, memory: null };

function fail(title, body) {
  $('#loading').hidden = true;
  $('#errTitle').textContent = title;
  $('#errBody').textContent = body;
  $('#error').hidden = false;
}

async function main() {
  const code = location.pathname.split('/').filter(Boolean).pop();
  let data;
  try {
    const res = await fetch('/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, device: deviceId() }),
    });
    data = await res.json();
  } catch {
    return fail('通信に失敗しました', '電波の良いところで、もう一度QRコードを読み取ってください。');
  }
  if (!data.ok) {
    return data.error === 'rally_inactive'
      ? fail('このスタンプラリーは終了しています', 'ご参加ありがとうございました。')
      : fail('読み取れませんでした', 'QRコードが正しくないようです。もう一度お試しください。');
  }
  state.rally = data.rally;
  state.spot = data.spot;
  state.spots = data.spots;
  // スタンプを集めるにはアプリが必要。ウェブでは、いま発見したスポットだけを獲得扱いにする
  state.collected = new Set([data.spot.id]);
  state.already = data.already;
  state.app = data.app || {};
  state.memory = data.memory || null;

  setup();
  // フォントと写真を先に読み込み、演出の途中でちらつかないようにする
  const photo = safeUrl(state.spot.photo_url);
  await withTimeout(
    Promise.all([
      document.fonts ? document.fonts.ready : null,
      photo ? new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = photo; }) : null,
    ]),
    2500,
  );
  $('#loading').hidden = true;
  run();
}

function setup() {
  document.title = `${state.spot.name} | Spot Memory`;
  document.querySelectorAll('.rallyName').forEach((n) => (n.textContent = state.rally.title));
  const photo = safeUrl(state.spot.photo_url);
  if (photo) {
    const css = `url("${photo.replace(/["\\\s]/g, encodeURIComponent)}")`;
    $('#bg').style.backgroundImage = css;
    $('#hero').style.backgroundImage = css;
  }
  $('#spotTitle').textContent = state.spot.name;
  $('#spotName').textContent = state.spot.name;
  $('#summary').textContent = state.spot.description || '';
  $('#summary').hidden = !state.spot.description;
  setupDownload();
  setupGacha();
}

/* ---------- 思い出ガチャ ---------- */
function showMemory(m) {
  $('#memBody').textContent = m.body;
  $('#memAuthor').textContent = m.author ? `― ${m.author}` : '';
  $('#memAuthor').hidden = !m.author;
  $('#memory').hidden = false;
  $('#gachaIdle').hidden = true;
  $('#gachaRun').hidden = true;
  const note = $('#gachaNote');
  note.textContent = '思い出は、ひとつのスポットにつき1回だけ引けます。';
  note.hidden = false;
}

function gachaMessage(text) {
  const note = $('#gachaNote');
  note.textContent = text;
  note.hidden = false;
}

async function drawMemory() {
  const btn = $('#gachaBtn');
  btn.disabled = true;
  $('#gachaNote').hidden = true;
  $('#gachaIdle').hidden = true;
  $('#gachaRun').hidden = false;
  const minWait = new Promise((r) => setTimeout(r, reduce ? 50 : 1500));
  let result;
  try {
    const [res] = await Promise.all([
      fetch('/api/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spot_id: state.spot.id, device: deviceId() }),
      }).then((r) => r.json()),
      minWait,
    ]);
    result = res;
  } catch {
    result = { ok: false, error: 'network' };
  }
  $('#gachaRun').hidden = true;
  if (result.ok && result.memory) return showMemory((state.memory = result.memory));
  $('#gachaIdle').hidden = false;
  btn.disabled = false;
  if (result.ok && result.empty) {
    btn.hidden = true;
    $('#gachaLead').hidden = true;
    return gachaMessage('このスポットの思い出は、まだ登録されていません。');
  }
  gachaMessage(
    result.error === 'not_collected'
      ? 'スタンプを獲得してから引けます。スポットのQRコードを読み取ってください。'
      : '通信に失敗しました。もう一度お試しください。',
  );
}

function setupGacha() {
  $('#gachaBtn').onclick = drawMemory;
  if (state.memory) showMemory(state.memory);
}

function setupDownload() {
  const ios = safeUrl(state.app.ios);
  const android = safeUrl(state.app.android);
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const url = isIOS ? ios || android : isAndroid ? android || ios : ios || android;
  const a = $('#dl');
  if (url) {
    a.href = url;
  } else {
    a.removeAttribute('href');
    a.setAttribute('aria-disabled', 'true');
    a.textContent = 'アプリは公開準備中です';
  }
}

/* ---------- スタンプカード描画 ---------- */
const MAX_ROWS = () => (innerHeight >= 820 ? 4 : 3);

function makeArt(spot, index, cls) {
  const art = el('div', 'art');
  const url = safeUrl(spot.stamp_image_url);
  if (url) {
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = url;
    img.onerror = () => img.replaceWith(el('div', 'seal', String(index + 1)));
    art.append(img);
  } else {
    art.append(el('div', 'seal', String(index + 1)));
  }
  art.append(el('span', 'burst'));
  return art;
}

function renderCard(root, opts = {}) {
  root.replaceChildren();
  const total = state.spots.length;
  const got = state.spots.filter((s) => state.collected.has(s.id)).length - (opts.pendingNew ? 1 : 0);
  const prog = el('div', 'progress');
  const num = el('span', 'num', `${got} / ${total}`);
  prog.append(num, el('span', null, 'スタンプ'));
  if (total > 0 && got >= total) prog.append(el('span', 'done', 'コンプリート！'));
  root.append(prog);
  root._num = num;

  const wrap = el('div', 'gridwrap');
  const grid = el('div', 'grid');
  state.spots.forEach((s, i) => {
    const isNew = !state.already && s.id === state.spot.id;
    const have = state.collected.has(s.id);
    const cell = el('div', 'cell ' + (have ? 'on' : 'off') + (isNew ? ' fresh' : ''));
    cell.dataset.id = s.id;
    if (isNew && opts.pendingNew) cell.classList.add('pending');
    cell.append(makeArt(s, i), el('div', 'label', s.name));
    grid.append(cell);
  });
  wrap.append(grid);
  root.append(wrap);

  // 初期表示は最大 3列×MAX_ROWS 行。それ以上はカード内スクロール、ボタンで展開
  const limit = MAX_ROWS() * 3;
  requestAnimationFrame(() => {
    const first = grid.firstElementChild;
    if (!first || total <= limit) return;
    const rowH = first.getBoundingClientRect().height;
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 8;
    const collapsed = MAX_ROWS() * rowH + (MAX_ROWS() - 1) * gap + 16;
    wrap.style.maxHeight = collapsed + 'px';
    const btn = el('button', 'toggle', 'すべてのスタンプを見る');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.onclick = () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? '閉じる' : 'すべてのスタンプを見る';
      wrap.style.maxHeight = open ? 'none' : collapsed + 'px';
      if (!open) wrap.scrollTop = 0;
    };
    root.append(btn);
  });
  return root;
}

function pressNew() {
  const root = $('#card3');
  const cell = root.querySelector('.cell.pending');
  if (!cell) return;
  const wrap = root.querySelector('.gridwrap');
  const top = cell.offsetTop - wrap.offsetTop - 8;
  if (top + cell.offsetHeight > wrap.scrollTop + wrap.clientHeight || top < wrap.scrollTop) wrap.scrollTop = top;
  cell.classList.remove('pending');
  cell.classList.add('press');
  const total = state.spots.length;
  const got = state.spots.filter((s) => state.collected.has(s.id)).length;
  root._num.textContent = `${got} / ${total}`;
}

/* ---------- シーン進行 ---------- */
function showScene(id) {
  document.querySelectorAll('.scene').forEach((s) => s.classList.toggle('on', s.id === id));
}

function glitter() {
  const box = $('#glitter');
  if (reduce) return;
  for (let i = 0; i < 16; i++) {
    const p = el('i');
    p.style.left = 8 + Math.random() * 84 + '%';
    p.style.top = 20 + Math.random() * 60 + '%';
    p.style.animationDelay = (Math.random() * 1.6).toFixed(2) + 's';
    p.style.animationDuration = (1.6 + Math.random() * 1.4).toFixed(2) + 's';
    box.append(p);
  }
}

async function run() {
  $('#stage').hidden = false;
  document.body.classList.add('locked');
  $('#skip').onclick = () => skipNow();
  requestAnimationFrame(() => $('#bg').classList.add('in'));
  try {
    showScene('s1');
    glitter();
    await sleep(3000);

    const s2 = $('#s2');
    $('#cTitle').textContent = state.already ? 'このスタンプは獲得済みです' : 'スタンプを獲得しました！';
    $('#cSub').textContent = state.already ? 'スタンプカードを確認しましょう。' : 'この街の思い出を、ひとつ見つけました。';
    renderCard($('#card3'), { pendingNew: !state.already });
    showScene('s2');
    if (!state.already) {
      await sleep(1100);
      pressNew();
      await sleep(1600);
    } else {
      await sleep(300);
    }
    s2.classList.add('phase3');
    await orSkip(new Promise((r) => ($('#next').onclick = r)));
  } catch (e) {
    if (e !== SKIP) throw e;
  }
  toPage();
}

function toPage() {
  renderCard($('#card4'));
  $('#page').hidden = false;
  const stage = $('#stage');
  stage.classList.add('out');
  document.body.classList.remove('locked');
  scrollTo(0, 0);
  setTimeout(() => (stage.hidden = true), 550);
}

/* ---------- シェア画像 (Canvas) ---------- */
const FONT_MARU = "'Zen Maru Gothic','Hiragino Maru Gothic ProN',sans-serif";
const FONT_MINCHO = "'Zen Old Mincho','Hiragino Mincho ProN',serif";
const FONT_SANS = "'Noto Sans JP',sans-serif";

function loadImg(url) {
  const u = safeUrl(url);
  if (!u) return Promise.resolve(null);
  return withTimeout(
    new Promise((resolve) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = u;
    }),
    8000,
  ).then((v) => v || null);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fitText(g, text, maxW, font, size, minSize) {
  let s = size;
  g.font = font(s);
  while (g.measureText(text).width > maxW && s > minSize) g.font = font((s -= 1));
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function drawSeal(g, img, cx, cy, s, have, index) {
  const main = have ? '#F36B50' : '#D6CCC3';
  if (img) {
    if (have) {
      g.drawImage(img, cx - s / 2, cy - s / 2, s, s);
    } else {
      const t = document.createElement('canvas');
      t.width = t.height = Math.ceil(s);
      const tg = t.getContext('2d');
      tg.drawImage(img, 0, 0, s, s);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = '#DDD4CB';
      tg.fillRect(0, 0, s, s);
      g.drawImage(t, cx - s / 2, cy - s / 2);
    }
    return;
  }
  g.strokeStyle = main;
  g.lineWidth = Math.max(2, s * 0.04);
  g.beginPath(); g.arc(cx, cy, s / 2 - g.lineWidth, 0, Math.PI * 2); g.stroke();
  g.lineWidth = Math.max(1, s * 0.015);
  g.beginPath(); g.arc(cx, cy, s / 2 - s * 0.1, 0, Math.PI * 2); g.stroke();
  g.fillStyle = main;
  g.font = `600 ${Math.round(s * 0.36)}px ${FONT_MINCHO}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(index + 1), cx, cy + s * 0.02);
}

const NO_START = '、。，．」』）〕】！？ー…ぁぃぅぇぉっゃゅょ,.!?)';

function wrapLines(g, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && g.measureText(line + ch).width > maxW) {
        if (NO_START.includes(ch)) { line += ch; continue; } // 句読点は行頭に送らない
        out.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

// 画像の縦の配分を決める。思い出が長いときは文字を小さくし、それでも入らなければ末尾を省略する。
function planShare(g, W, H, memory) {
  const top = 236, bottom = H - 160, gap = 28, nameH = 84, ring = 40;
  const avail = bottom - top;
  const innerW = W - 120 - 96;
  const MIN_S = 210, MAX_S = 380;
  const lh = (fs) => Math.round(fs * 1.75);
  const extras = 30 + 36 + 16 + (memory && memory.author ? 54 : 0) + 30; // 余白・見出し・署名
  if (!memory) {
    const cardH = 200;
    return { cardH, lines: [], fs: 0, truncated: false, s: Math.min(MAX_S, avail - cardH - gap * 2 - nameH - ring), top, gap, nameH, ring };
  }
  const stampMin = MIN_S + ring + nameH + gap;
  for (let fs = 44; fs >= 26; fs -= 2) {
    g.font = `600 ${fs}px ${FONT_MINCHO}`;
    const lines = wrapLines(g, memory.body, innerW);
    const cardH = extras + lines.length * lh(fs);
    if (cardH + gap + stampMin <= avail) {
      return { cardH, lines, fs, truncated: false, s: Math.min(MAX_S, avail - cardH - gap * 2 - nameH - ring), top, gap, nameH, ring };
    }
  }
  const fs = 26;
  g.font = `600 ${fs}px ${FONT_MINCHO}`;
  let lines = wrapLines(g, memory.body, innerW);
  const maxLines = Math.max(2, Math.floor((avail - stampMin - gap - extras) / lh(fs)));
  let truncated = false;
  if (lines.length > maxLines) {
    truncated = true;
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 1 && g.measureText(last + '…').width > innerW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  const cardH = extras + lines.length * lh(fs);
  return { cardH, lines, fs, truncated, s: Math.min(MAX_S, Math.max(MIN_S, avail - cardH - gap * 2 - nameH - ring)), top, gap, nameH, ring };
}

async function shareFonts() {
  await withTimeout(
    Promise.all([
      document.fonts.load(`700 40px ${FONT_MARU}`, 'スタンプ'),
      document.fonts.load(`600 30px ${FONT_MINCHO}`, 'スタンプ思い出'),
      document.fonts.load(`500 30px ${FONT_SANS}`, 'スタンプ'),
    ]).then(() => document.fonts.ready),
    5000,
  );
}

async function buildShareBlob(ratio) {
  const W = 1080;
  const H = ratio === '4:5' ? 1350 : 1080;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  await shareFonts();
  const img = await loadImg(state.spot.stamp_image_url);
  const spotIndex = Math.max(0, state.spots.findIndex((s) => s.id === state.spot.id));
  const memory = state.memory;
  const P = planShare(g, W, H, memory);

  g.fillStyle = '#FAF7F2'; g.fillRect(0, 0, W, H);

  // ヘッダ
  g.fillStyle = '#F36B50'; roundRect(g, 60, 52, 58, 58, 16); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(89, 81, 15, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#342820'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = `700 40px ${FONT_MARU}`; g.fillText('Spot Memory', 138, 96);
  g.fillText(fitText(g, state.rally.title, W - 120, (s) => `700 ${s}px ${FONT_MARU}`, 44, 28), 60, 176);

  // スタンプ
  const cx = W / 2;
  const cy = P.top + P.ring / 2 + P.s / 2;
  g.fillStyle = '#FFF0E8'; g.beginPath(); g.arc(cx, cy, P.s / 2 + P.ring / 2, 0, Math.PI * 2); g.fill();
  drawSeal(g, img, cx, cy, P.s, true, spotIndex);

  // スポット名
  const nameY = cy + P.s / 2 + P.ring / 2 + 16;
  g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#342820';
  g.fillText(fitText(g, state.spot.name, W - 140, (s) => `600 ${s}px ${FONT_MINCHO}`, 56, 30), cx, nameY);

  // 思い出
  const cardY = nameY + P.nameH - 8 + P.gap - 12;
  g.fillStyle = '#fff'; roundRect(g, 60, cardY, W - 120, P.cardH, 28); g.fill();
  g.strokeStyle = '#EAE3DA'; g.lineWidth = 2; g.stroke();
  g.textBaseline = 'top';
  g.textAlign = 'left'; g.fillStyle = '#F36B50'; g.font = `700 28px ${FONT_MARU}`;
  g.fillText('この場所の思い出', 108, cardY + 30);
  if (memory) {
    g.fillStyle = '#342820'; g.font = `600 ${P.fs}px ${FONT_MINCHO}`;
    const lh = Math.round(P.fs * 1.75);
    P.lines.forEach((ln, i) => g.fillText(ln, 108, cardY + 30 + 36 + 16 + i * lh));
    if (memory.author) {
      g.textAlign = 'right'; g.fillStyle = '#746D68'; g.font = `500 26px ${FONT_SANS}`;
      g.fillText(`― ${memory.author}`, W - 108, cardY + P.cardH - 30 - 30);
    }
  } else {
    g.fillStyle = '#342820'; g.font = `600 36px ${FONT_MINCHO}`;
    g.fillText('この場所に眠る思い出を、', 108, cardY + 30 + 36 + 16);
    g.fillText('あなたも探しに来ませんか。', 108, cardY + 30 + 36 + 16 + 62);
  }

  // フッタ
  g.textBaseline = 'alphabetic'; g.textAlign = 'center';
  g.fillStyle = '#342820'; g.font = `700 36px ${FONT_MARU}`;
  g.fillText('街に眠る思い出を、もっと見つけよう。', W / 2, H - 82);
  g.fillStyle = '#F36B50'; g.font = `700 30px ${FONT_MARU}`;
  g.fillText('Spot Memory', W / 2, H - 36);

  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return { blob };
}

let shareBlob = null;
let shareUrl = null;
let shareRatio = '1:1';
let building = 0;

async function refreshShare(ratio) {
  const mine = ++building;
  shareRatio = ratio;
  document.querySelectorAll('.ratio button').forEach((b) => b.classList.toggle('on', b.dataset.r === ratio));
  const { blob } = await buildShareBlob(ratio);
  if (mine !== building) return;
  if (shareUrl) URL.revokeObjectURL(shareUrl);
  shareBlob = blob;
  shareUrl = URL.createObjectURL(blob);
  $('#prevImg').src = shareUrl;
}

async function openShare() {
  $('#sheet').hidden = false;
  document.body.classList.add('locked');
  // 1:1 に収まらないほど思い出が長い場合は 4:5 を初期選択
  await shareFonts();
  const g = document.createElement('canvas').getContext('2d');
  const plan = planShare(g, 1080, 1080, state.memory);
  await refreshShare(plan.fs < 32 || plan.truncated || plan.s < 240 ? '4:5' : '1:1');
}

function closeShare() {
  $('#sheet').hidden = true;
  document.body.classList.remove('locked');
}

function download() {
  if (!shareBlob) return;
  const a = document.createElement('a');
  a.href = shareUrl;
  a.download = 'spot-memory.png';
  document.body.append(a);
  a.click();
  a.remove();
}

async function share() {
  if (!shareBlob) return;
  const file = new File([shareBlob], 'spot-memory.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Spot Memory' });
    } catch (e) {
      if (e.name !== 'AbortError') download();
    }
  } else {
    download();
  }
}

$('#share').onclick = openShare;
$('#closeSheet').onclick = closeShare;
$('#doShare').onclick = share;
$('#doSave').onclick = download;
document.querySelectorAll('.ratio button').forEach((b) => (b.onclick = () => refreshShare(b.dataset.r)));
$('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) closeShare(); });

main();
