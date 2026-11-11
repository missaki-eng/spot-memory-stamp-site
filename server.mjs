import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const APP_DEEPLINK_SCHEME = process.env.APP_DEEPLINK_SCHEME || '';
const APP_STORE_URL = process.env.APP_STORE_URL || '';
const PLAY_STORE_URL = process.env.PLAY_STORE_URL || '';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Za-z0-9_-]{6,64}$/;

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      // 従来の anon キー(JWT)のときだけ Bearer も付ける。新形式の publishable キーは apikey のみ。
      ...(SUPABASE_ANON_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

const rest = (q) => sb(`/rest/v1/${q}`);
const rpc = (fn, body) => sb(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });

const css = `
:root{--bg:#fafaf7;--fg:#222;--sub:#666;--card:#fff;--line:#e6e3dc;--accent:#e4572e}
@media (prefers-color-scheme:dark){:root{--bg:#18181a;--fg:#eee;--sub:#aaa;--card:#232326;--line:#38383c;--accent:#ff7a52}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.5rem;margin:0 0 16px}h2{font-size:1.1rem}a{color:var(--accent)}
.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0;color:inherit;text-decoration:none}
.sub{color:var(--sub);font-size:.9rem}
.spot{display:flex;gap:12px;align-items:center}.stamp{flex:none;width:44px;height:44px;border-radius:50%;border:2px dashed var(--line);display:grid;place-items:center;font-size:1.3rem}
.stamp.on{border:2px solid var(--accent);background:var(--accent);color:#fff}
.btn{display:inline-block;background:var(--accent);color:#fff;border-radius:999px;padding:10px 20px;text-decoration:none;margin:4px 8px 4px 0}
.btn.ghost{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden}.bar>i{display:block;height:100%;background:var(--accent)}
`;

const page = (title, body, script = '') => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${css}</style></head>
<body><main>${body}</main>
<script>
function deviceId(){try{let d=localStorage.getItem('sr_device');if(!d){d=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2)).replace(/[^a-zA-Z0-9-]/g,'');localStorage.setItem('sr_device',d)}return d}catch(e){return 'anon-'+Math.random().toString(16).slice(2,12)}}
${script}
</script></body></html>`;

const appLinks = (path = '') => {
  const out = [];
  if (APP_DEEPLINK_SCHEME) out.push(`<a class="btn" href="${esc(APP_DEEPLINK_SCHEME)}://${esc(path)}">アプリで開く</a>`);
  if (APP_STORE_URL) out.push(`<a class="btn ghost" href="${esc(APP_STORE_URL)}">App Store</a>`);
  if (PLAY_STORE_URL) out.push(`<a class="btn ghost" href="${esc(PLAY_STORE_URL)}">Google Play</a>`);
  return out.length ? `<p>${out.join('')}</p>` : '';
};

async function listPage() {
  const rallies = await rest('sr_rallies?select=id,title,description&order=created_at.desc');
  const items = rallies.length
    ? rallies
        .map((r) => `<a class="card" href="/rallies/${esc(r.id)}"><strong>${esc(r.title)}</strong><div class="sub">${esc(r.description)}</div></a>`)
        .join('')
    : '<p class="sub">現在開催中のスタンプラリーはありません。</p>';
  return page('スタンプラリー', `<h1>スタンプラリー</h1>${items}<h2>アプリでもっと楽しむ</h2>${appLinks()}`);
}

async function detailPage(id) {
  const [rally] = await rest(`sr_rallies?select=id,title,description&id=eq.${id}`);
  if (!rally) return null;
  const spots = await rest(`sr_spots?select=id,name,description&rally_id=eq.${id}&order=sort_order.asc`);
  const rows = spots
    .map(
      (s) => `<div class="card spot" data-spot="${esc(s.id)}"><div class="stamp">・</div><div><strong>${esc(s.name)}</strong><div class="sub">${esc(s.description)}</div></div></div>`,
    )
    .join('');
  const body = `<p><a href="/">← 一覧</a></p><h1>${esc(rally.title)}</h1><p>${esc(rally.description)}</p>
<p class="sub" id="prog">読み込み中…</p><div class="bar"><i id="barfill" style="width:0"></i></div>
${rows}
<p class="sub">各スポットに掲示されたQRコードを読み取るとスタンプが集まります。</p>${appLinks(`rallies/${esc(id)}`)}`;
  const script = `
fetch('/api/rallies/${id}/stamps?device='+encodeURIComponent(deviceId())).then(r=>r.json()).then(ids=>{
  const set=new Set(ids);let n=0;
  document.querySelectorAll('[data-spot]').forEach(el=>{if(set.has(el.dataset.spot)){n++;const s=el.querySelector('.stamp');s.classList.add('on');s.textContent='✓'}});
  const t=document.querySelectorAll('[data-spot]').length;
  document.getElementById('prog').textContent=n+' / '+t+' 個 獲得';
  document.getElementById('barfill').style.width=(t?n/t*100:0)+'%';
}).catch(()=>{document.getElementById('prog').textContent='進捗を取得できませんでした'});`;
  return page(rally.title, body, script);
}

const send = (res, status, type, body) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
};
const html = (res, status, body) => send(res, status, 'text/html; charset=utf-8', body);
const json = (res, status, obj) => send(res, status, 'application/json', JSON.stringify(obj));
const notFound = (res) => html(res, 404, page('見つかりません', '<h1>ページが見つかりません</h1><p><a href="/">トップへ</a></p>'));

const accountDeletionPage = () => page(
  'アカウント削除について｜スポットメモリー',
  `<h1>アカウント削除について</h1>
<p>位置情報アプリ「スポットメモリー」をご利用のお客様が、アカウントおよびそれに紐づくデータの削除をリクエストするための手順です。</p>

<h2>アプリ内からアカウントを削除する方法</h2>
<ol>
<li>「スポットメモリー」アプリにログインする</li>
<li>下部タブの「マイページ」を開く</li>
<li>右上の設定（歯車）アイコンをタップする</li>
<li>「アカウントを削除する」をタップする</li>
<li>本人確認のためパスワードを入力し、確認ダイアログで「削除する」をタップする</li>
</ol>
<p>削除が完了すると、同じメールアドレス・パスワードで再びログインすることはできなくなります。</p>

<h2>削除されるデータと保持期間</h2>
<p>上記の操作を行うと、以下のデータが<strong>即時に完全削除</strong>されます（削除後に保持される期間はありません）。</p>
<ul>
<li>投稿したすべてのノート（テキスト・写真・位置情報・タグ）</li>
<li>作成したフォルダ、共有フォルダのメンバー情報</li>
<li>いいね・保存したノート・送受信した手紙</li>
<li>プロフィール情報（表示名・アバター・生年月日等）およびプレミアム会員情報</li>
<li>ログイン情報（メールアドレス・パスワード）を含むアカウント自体</li>
</ul>

<h2>アカウントを削除せずに一部データのみ削除したい場合</h2>
<p>アカウント自体は残したまま、特定の投稿や情報のみ削除・訂正してほしい場合は、アプリ内のハンバーガーメニューにある「お問い合わせ」フォームから削除したい内容を添えてご連絡ください。内容を確認のうえ対応いたします。</p>`
);

async function serveFile(res, rel, cache) {
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return notFound(res);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    notFound(res);
  }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 10_000) throw new Error('too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') return send(res, 200, 'text/plain', 'ok');
    if (req.method === 'GET' && p === '/account-deletion') return html(res, 200, accountDeletionPage());
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return html(res, 500, page('設定エラー', '<h1>設定エラー</h1><p>SUPABASE_URL / SUPABASE_ANON_KEY が未設定です。</p>'));

    if (req.method === 'GET' && p === '/') return html(res, 200, await listPage());

    let m;
    if (req.method === 'GET' && (m = p.match(/^\/rallies\/([^/]+)$/))) {
      if (!UUID_RE.test(m[1])) return notFound(res);
      const body = await detailPage(m[1]);
      return body ? html(res, 200, body) : notFound(res);
    }
    if (req.method === 'GET' && (m = p.match(/^\/c\/([^/]+)$/))) {
      return CODE_RE.test(m[1]) ? serveFile(res, 'collect.html', 'no-store') : notFound(res);
    }
    if (req.method === 'GET' && p.startsWith('/assets/')) {
      return serveFile(res, p.slice(1), 'public, max-age=300');
    }
    if (req.method === 'GET' && (m = p.match(/^\/api\/rallies\/([^/]+)\/stamps$/))) {
      const device = url.searchParams.get('device') || '';
      if (!UUID_RE.test(m[1]) || device.length < 8 || device.length > 64) return json(res, 400, []);
      return json(res, 200, await rpc('sr_my_stamps', { p_rally_id: m[1], p_device_id: device }));
    }
    if (req.method === 'POST' && p === '/api/collect') {
      const { code, device } = await readJson(req);
      if (!CODE_RE.test(code || '') || typeof device !== 'string' || device.length < 8 || device.length > 64) {
        return json(res, 400, { ok: false, error: 'bad_request' });
      }
      const result = await rpc('sr_collect_stamp', { p_code: code, p_device_id: device });
      if (!result.ok) return json(res, 200, result);
      const [[spot], [rally], spots, memory] = await Promise.all([
        rest(`sr_spots?select=id,name,description,photo_url,stamp_image_url,sort_order&id=eq.${result.spot_id}`),
        rest(`sr_rallies?select=id,title&id=eq.${result.rally_id}`),
        rest(`sr_spots?select=id,name,stamp_image_url,sort_order&rally_id=eq.${result.rally_id}&order=sort_order.asc,created_at.asc`),
        rpc('sr_my_draw', { p_spot_id: result.spot_id, p_device_id: device }),
      ]);
      if (!spot || !rally) return json(res, 200, { ok: false, error: 'invalid_code' });
      return json(res, 200, {
        ok: true,
        already: result.already,
        rally,
        spot,
        spots,
        memory,
        app: { ios: APP_STORE_URL, android: PLAY_STORE_URL },
      });
    }
    if (req.method === 'POST' && p === '/api/draw') {
      const { spot_id: spotId, device } = await readJson(req);
      if (!UUID_RE.test(spotId || '') || typeof device !== 'string' || device.length < 8 || device.length > 64) {
        return json(res, 400, { ok: false, error: 'bad_request' });
      }
      return json(res, 200, await rpc('sr_draw_memory', { p_spot_id: spotId, p_device_id: device }));
    }
    return notFound(res);
  } catch (e) {
    console.error(e);
    return html(res, 500, page('エラー', '<h1>エラーが発生しました</h1><p>時間をおいてもう一度お試しください。</p>'));
  }
});

server.listen(PORT, () => console.log(`stamp-rally-site listening on ${PORT}`));
