import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const WORKER = 'tdnet-monitor';
const PUBLIC_URL = 'https://tdnet-monitor.sanndora388.workers.dev/';
const REPO = 'kuma885/tdnet-radar';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function credentials(env) {
  if (!env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '')) {
    throw new Error('GitHub SecretsにCLOUDFLARE_API_TOKENとCLOUDFLARE_ACCOUNT_IDを登録してください。');
  }
  return { token: env.CLOUDFLARE_API_TOKEN, account: env.CLOUDFLARE_ACCOUNT_ID };
}

// /content は設定・メタデータを変更しないCloudflare公式API。
export function uploadBody(source, filename = 'worker.js') {
  const form = new FormData();
  form.set('metadata', JSON.stringify({ main_module: filename }));
  form.set(filename, new Blob([source], { type: 'application/javascript+module' }), filename);
  return form;
}

export async function readModule(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('multipart/form-data')) throw new Error('既存Workerの形式が想定外です。変更を停止しました。');
  let form;
  try { form = await response.formData(); } catch { throw new Error('既存コードの応答を解析できません。'); }
  const files = [...form.entries()].filter(([key, value]) => key !== 'metadata' && typeof value !== 'string');
  if (files.length !== 1) throw new Error('複数モジュールのWorkerは自動置換しません。');
  const [part, file] = files[0];
  const source = await file.text();
  const filename = response.headers.get('cf-worker-main-module-part') || part;
  if (filename !== part || !/export\s+default\s*\{/.test(source)) throw new Error('既存Workerのエントリーポイントを確認できません。');
  return { filename, source };
}

function crons(result) {
  if (!Array.isArray(result?.schedules)) throw new Error('Cron設定を読み取れません。');
  const values = result.schedules.map(s => s.cron).sort();
  if (!values.length || !values.every(s => typeof s === 'string')) throw new Error('既存Cronがありません。変更を停止しました。');
  return values;
}

export async function deploy({ env = process.env, source, fetchImpl = fetch, wait = pause, log = console.log }) {
  const { token, account } = credentials(env);
  if (!source || !/export\s+default\s*\{/.test(source)) throw new Error('Workerソースが不正です。');
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${WORKER}`;
  async function request(url, options = {}, auth = true) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: auth ? { Authorization: `Bearer ${token}`, ...options.headers } : options.headers });
    } catch { throw new Error('接続に失敗しました。APIキーや応答本文はログへ出力しません。'); }
    if (!response.ok) throw new Error(`HTTP ${response.status}。設定・認証情報を確認してください。`);
    return response;
  }
  async function api(path, options) {
    const r = await request(base + path, options);
    let data;
    try { data = await r.json(); } catch { throw new Error('Cloudflare APIの応答を解析できません。'); }
    if (!data.success) throw new Error('Cloudflare APIが処理を拒否しました。');
    return data.result;
  }
  async function current() { return readModule(await request(base + '/content/v2')); }
  async function snapshot() {
    const settings = await api('/settings');
    if (!Array.isArray(settings?.bindings) || !settings.compatibility_date) throw new Error('本番設定を確認できません。');
    const bindings = settings.bindings.toSorted((a, b) => a.name.localeCompare(b.name));
    if (!bindings.some(b => b.name === 'TDNET_STATE' && b.type === 'kv_namespace' && b.namespace_id) ||
        !['ONESIGNAL_APP_ID', 'ONESIGNAL_API_KEY', 'ONESIGNAL_SUBSCRIPTION_ID'].every(name =>
          bindings.some(b => b.name === name && ['secret_text', 'plain_text'].includes(b.type)))) {
      throw new Error('既存のKVまたは通知用変数がありません。変更を停止しました。');
    }
    // バージョンごとの注釈・照合結果はコード更新で変わり得るため比較対象外。
    const { annotations, exports_reconciliation, ...runtime } = settings;
    return { settings: { ...runtime, bindings }, schedules: crons(await api('/schedules')) };
  }
  async function latest() {
    if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') || env.GITHUB_REPOSITORY !== REPO || env.GITHUB_REF !== 'refs/heads/main') {
      throw new Error('mainブランチのGitHub Actionsからだけデプロイできます。');
    }
    const r = await request(`https://api.github.com/repos/${REPO}/git/ref/heads/main`, {
      headers: { Accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? {Authorization:`Bearer ${env.GITHUB_TOKEN}`} : {}) }
    }, false);
    return (await r.json()).object?.sha === env.GITHUB_SHA;
  }
  if (!await latest()) { log('後続コミットがあるため、古い実行のデプロイを省略しました。'); return 'stale'; }
  const previous = await current(); // 存在しないWorkerを新規作成しない。
  const before = await snapshot();
  async function verify() {
    const after = await snapshot();
    if (!isDeepStrictEqual(before, after)) throw new Error('設定またはCronの変化を検出しました。');
    const published = await current();
    if (published.source !== source) throw new Error('公開コードが一致しません。');
    const r = await request(PUBLIC_URL, { headers: { 'Cache-Control': 'no-cache' } }, false);
    const data = await r.json();
    if (typeof data.version !== 'string' || !Number.isInteger(data.totalCount) || !Array.isArray(data.matches)) {
      throw new Error('公開Workerの応答が想定外です。');
    }
  }
  if (previous.source === source) { await verify(); log('コードは反映済み。設定・Cron・公開応答を確認しました。'); return 'unchanged'; }
  if (!await latest()) { log('後続コミットがあるためデプロイを省略しました。'); return 'stale'; }
  if ((await current()).source !== previous.source || !isDeepStrictEqual(before, await snapshot())) {
    throw new Error('確認中に本番が変更されたため、デプロイを停止しました。');
  }
  // このPUT以外に書き込みAPIは使わない。KV/Secrets/Cron/課金プランは変更しない。
  // タイムアウト時は反映済みの可能性があるため、アップロードを自動再試行しない。
  await api('/content', { method: 'PUT', body: uploadBody(source) });
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await verify(); log('デプロイ成功。コード一致・設定保持・Cron保持・公開応答を確認しました。'); return 'deployed'; }
    catch { if (attempt < 3) await wait(5000); }
  }
  // 後から人が変更したコードは上書きしない。
  const now = await current();
  if (now.source === source) {
    await api('/content', { method: 'PUT', body: uploadBody(previous.source, previous.filename) });
    if ((await current()).source !== previous.source) throw new Error('検証失敗。旧コードへの復元を確認できませんでした。');
    throw new Error('公開後の検証に失敗し、直前のコードへ戻しました。Cloudflareログを確認してください。');
  }
  throw new Error('公開後の検証に失敗。別の更新があるため自動復元は停止しました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = await readFile(new URL('../cloudflare/worker.js', import.meta.url), 'utf8');
    await deploy({ source });
  } catch (error) {
    // API応答や設定値、Secretを標準出力に流さない。
    console.error(error.message);
    process.exitCode = 1;
  }
}
