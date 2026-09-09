const APP_BASE_URL = "https://kuma885.github.io/tdnet-radar/";
const DETAIL_TTL_SECONDS = 60 * 60 * 24 * 35;

const RULES = [
  {
    label: "上方修正",
    words: [/上方修正/, /上方に修正/, /上方へ修正/]
  },
  {
    label: "増配",
    words: [/増配/, /配当予想.*引き上げ/, /配当.*増額/]
  },
  {
    label: "自社株買い",
    words: [
      /自己株式取得に係る事項の決定/,
      /自己株式の取得に係る事項の決定/,
      /自己株式の取得及び自己株式立会外買付取引/,
      /自己株式.*買付けに関するお知らせ/
    ],
    exclude: [/取得状況/, /取得結果/, /取得終了/, /取得実績/]
  },
  {
    label: "大型受注",
    words: [
      /大型受注/,
      /大口受注/,
      /大型案件.*受注/,
      /受注獲得/,
      /大型案件.*落札/,
      /大型契約.*締結/
    ]
  },
  {
    label: "業務提携",
    words: [
      /業務提携契約/,
      /資本業務提携/,
      /事業提携/,
      /戦略的業務提携/,
      /協業開始/,
      /共同事業.*開始/
    ]
  },
  {
    label: "M&A",
    words: [
      /吸収合併/,
      /合併契約/,
      /株式交換契約/,
      /株式移転/,
      /株式取得.*子会社化/,
      /子会社化に関するお知らせ/,
      /事業譲受/,
      /事業譲渡/,
      /会社分割/,
      /連結子会社の異動/
    ]
  },
  {
    label: "TOB",
    words: [
      /公開買付けの開始/,
      /公開買付け開始/,
      /公開買付けに関する意見表明/,
      /\bTOB\b/i
    ]
  },
  {
    label: "株式分割",
    words: [/株式分割/]
  },
  {
    label: "下方修正",
    words: [/下方修正/, /下方に修正/, /下方へ修正/]
  },
  {
    label: "減配",
    words: [/減配/, /無配/, /配当予想.*引き下げ/]
  },
  {
    label: "赤字転落",
    words: [/赤字転落/, /黒字予想.*赤字/, /黒字.*赤字へ/]
  },
  {
    label: "希薄化",
    words: [
      /第三者割当.*新株式.*発行/,
      /第三者割当.*新株予約権.*発行/,
      /第三者割当増資/,
      /公募増資/,
      /行使価額修正条項付.*新株予約権.*発行/,
      /転換社債型新株予約権付社債.*発行/,
      /MSワラント.*発行/i
    ],
    exclude: [
      /月間行使状況/,
      /行使状況/,
      /行使結果/,
      /大量行使/,
      /発行状況/,
      /払込完了/
    ]
  }
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/detail") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (request.method !== "GET") {
        return jsonResponse({ error: "method not allowed" }, 405, corsHeaders());
      }
      return getDetailResponse(url, env);
    }

    const result = await readTdnetAll();
    const matches = [];

    for (const item of result.items) {
      const categories = classifyTitle(item.title);
      if (categories.length > 0) {
        matches.push({
          ...item,
          categories,
          explanation: buildExplanation(item.title, categories),
          explanations: buildExplanations(item.title, categories)
        });
      }
    }

    const stateKey = `seen:${result.date}`;
    const saved = await env.TDNET_STATE.get(stateKey, "json");
    const oldIds = new Set(saved?.ids || []);

    const newItems = saved
      ? result.items.filter(item => !oldIds.has(makeId(item)))
      : [];

    return jsonResponse({
      version: "2.1",
      date: result.date,
      totalCount: result.items.length,
      matchedCount: matches.length,
      matches,
      stateExists: !!saved,
      rememberedCount: saved?.ids?.length || 0,
      newCount: newItems.length,
      newItems: newItems.map(item => ({
        ...item,
        categories: classifyTitle(item.title)
      }))
    });
  },

  async scheduled(controller, env, ctx) {
    const result = await readTdnetAll();
    const stateKey = `seen:${result.date}`;
    const saved = await env.TDNET_STATE.get(stateKey, "json");
    const currentIds = result.items.map(makeId);

    // その日の初回は、その時点の全件を既読として保存。
    if (!saved) {
      await env.TDNET_STATE.put(
        stateKey,
        JSON.stringify({
          ids: currentIds,
          updatedAt: new Date().toISOString()
        }),
        { expirationTtl: 60 * 60 * 24 * 7 }
      );

      console.log(`初期化完了: ${result.date} ${currentIds.length}件`);
      return;
    }

    const oldIds = new Set(saved.ids || []);
    const newItems = result.items.filter(item => !oldIds.has(makeId(item)));

    if (newItems.length === 0) {
      console.log(`新着なし: 現在${result.items.length}件`);
      return;
    }

    console.log(`TDnet新着 ${newItems.length}件`);

    // 1件の通知失敗で他の処理や既読更新まで止めない。
    for (const item of newItems) {
      const categories = classifyTitle(item.title);

      if (categories.length === 0) {
        console.log(
          `OTHER | ${item.time} | ${item.code} | ${item.company} | ${item.title}`
        );
        continue;
      }

      try {
        const explanation = buildExplanation(item.title, categories);
        const detailId = await makeDetailId(result.date, item);

        const detail = {
          id: detailId,
          date: result.date,
          time: item.time,
          code: item.code,
          company: item.company,
          title: item.title,
          categories,
          explanation,
          explanations: buildExplanations(item.title, categories),
          explanationSource: "title",
          originalUrl: safeTdnetUrl(item.originalUrl) || makeTdnetListUrl(result.date),
          createdAt: new Date().toISOString()
        };

        // 説明の保存失敗で原文への通知まで失わない。
        try {
          await env.TDNET_STATE.put(
            `detail:${detailId}`,
            JSON.stringify(detail),
            { expirationTtl: DETAIL_TTL_SECONDS }
          );
        } catch (error) {
          console.error(`詳細保存失敗 | ${detailId} | ${error?.message || error}`);
        }

        console.log(
          `MATCH | ${categories.join(", ")} | ${item.time} | ${item.code} | ${item.company} | ${item.title}`
        );

        await sendPush(env, item, categories, detailId, result.date);
      } catch (error) {
        console.error(
          `通知処理失敗 | ${item.code} | ${item.title} | ${error?.message || error}`
        );
      }
    }

    // 通知の成否にかかわらず、その巡回で見たTDnet新着は既読にする。
    // これにより、一時的な通知エラーで同じ通知を2分ごとに連打しない。
    await env.TDNET_STATE.put(
      stateKey,
      JSON.stringify({
        ids: currentIds,
        updatedAt: new Date().toISOString()
      }),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
  }
};

async function getDetailResponse(url, env) {
  const id = url.searchParams.get("id");

  if (!id || !/^[a-f0-9]{24}$/.test(id)) {
    return jsonResponse(
      { error: "valid id is required" },
      400,
      corsHeaders()
    );
  }

  const detail = await env.TDNET_STATE.get(`detail:${id}`, "json");

  if (!detail) {
    return jsonResponse(
      { error: "detail not found or expired" },
      404,
      corsHeaders()
    );
  }

  return jsonResponse(detail, 200, corsHeaders());
}

function classifyTitle(title) {
  const result = [];
  const investment = isThirdPartyInvestmentByCompany(title);

  if (investment) {
    result.push("出資・投資");
  }

  for (const rule of RULES) {
    // 「他社の第三者割当増資を当社が引き受ける」は
    // 当社自身の希薄化ではないので、希薄化判定を抑止。
    if (investment && rule.label === "希薄化") {
      continue;
    }

    if (rule.exclude && rule.exclude.some(regex => regex.test(title))) {
      continue;
    }

    if (rule.words.some(regex => regex.test(title))) {
      result.push(rule.label);
    }
  }

  return [...new Set(result)];
}

function isThirdPartyInvestmentByCompany(title) {
  const hasThirdParty = /第三者割当増資|第三者割当.*新株/.test(title);
  const companyAccepts =
    /当社.{0,20}(引き受け|引受|取得)/.test(title) ||
    /(引き受け|引受).{0,20}当社/.test(title);

  return hasThirdParty && companyAccepts;
}

// 複数材料を省略せず表示する。通知判定ルールには影響しない。
function buildExplanations(title, categories) {
  return categories.map(category => ({
    category,
    ...buildExplanation(title, [category])
  }));
}

function buildExplanation(title, categories) {
  if (categories.includes("出資・投資") && isThirdPartyInvestmentByCompany(title)) {
    return {
      headline: "他社への出資・投資です",
      summary:
        "他社が発行する新株などを、この会社が引き受ける（買う）という内容です。会社自身が第三者割当増資をする話ではありません。",
      points: [
        "この会社は「お金を出す側」です。",
        "このタイトルだけを見る限り、自社株の希薄化を直接意味する開示ではありません。",
        "投資額・取得比率・投資先の財務状況・目的は原文で確認すると判断しやすいです。"
      ],
      caution:
        "これはタイトルからの自動説明です。投資の良し悪しや金額の大きさまでは原文を確認してください。"
    };
  }

  if (categories.includes("自社株買い")) {
    return {
      headline: "会社が自社株を買い戻す決定です",
      summary:
        "会社自身が市場などから自社株を取得する方針を決めた開示です。",
      points: [
        "取得する株数・金額の上限を見ると規模感が分かります。",
        "取得期間も確認すると、いつまで買う予定か分かります。"
      ],
      caution:
        "取得枠は上限であり、必ず全額・全株数を買うとは限りません。"
    };
  }

  if (categories.includes("株式分割")) {
    return {
      headline: "1株を複数株に分ける開示です",
      summary:
        "保有価値そのものを増やす施策ではありませんが、1株あたりの価格を下げて売買しやすくする目的などで行われます。",
      points: [
        "「1株を何株に分割するか」を確認してください。",
        "基準日と効力発生日も重要です。"
      ],
      caution:
        "株式分割だけで企業価値そのものが増えるわけではありません。"
    };
  }

  if (categories.includes("TOB")) {
    return {
      headline: "公開買付け（TOB）に関する開示です",
      summary:
        "特定の買付者が、価格と期間を示して株式をまとめて買い付ける案件に関する情報です。",
      points: [
        "買付価格はいくらか。",
        "誰が誰を買うのか。",
        "買付期間と上場維持・上場廃止の予定があるか。"
      ],
      caution:
        "「訂正」の開示の場合は、どの条件が変更されたか原文確認が必要です。"
    };
  }

  if (categories.includes("上方修正")) {
    return {
      headline: "会社予想を上向きに見直した開示です",
      summary:
        "従来の業績予想などを、より高い数字へ修正した内容です。",
      points: [
        "売上高だけでなく営業利益・経常利益・最終利益の修正幅を確認してください。",
        "一時的な要因か、本業の改善かも重要です。"
      ],
      caution:
        "タイトルだけでは修正幅までは分かりません。原文の新旧予想値を確認してください。"
    };
  }

  if (categories.includes("下方修正")) {
    return {
      headline: "会社予想を下向きに見直した開示です",
      summary:
        "従来の業績予想などを、より低い数字へ修正した内容です。",
      points: [
        "営業利益・経常利益・最終利益の下げ幅を確認してください。",
        "原因が一時的か継続的かを見ると影響を判断しやすいです。"
      ],
      caution:
        "タイトルだけでは修正幅や原因までは分かりません。"
    };
  }

  if (categories.includes("増配")) {
    return {
      headline: "配当を増やす開示です",
      summary:
        "従来予想より配当金を増やす、または増配を決めた内容です。",
      points: [
        "1株あたり配当が何円から何円になるか確認してください。",
        "記念配当など一時的な増配か、普通配当の増額かも重要です。"
      ],
      caution:
        "翌期以降も同じ配当が続くとは限りません。"
    };
  }

  if (categories.includes("減配")) {
    return {
      headline: "配当を減らす開示です",
      summary:
        "従来予想より配当金を減らす、または無配にする内容です。",
      points: [
        "1株あたり何円減るか確認してください。",
        "業績悪化・財務改善など、減配理由を見ることが重要です。"
      ],
      caution:
        "一時的な減配か、配当方針そのものの変更かで意味が変わります。"
    };
  }

  if (categories.includes("希薄化")) {
    return {
      headline: "新株発行などによる希薄化に関係する開示です",
      summary:
        "新しい株式や新株予約権などを発行し、既存株主の1株あたり持分が薄まる可能性がある内容です。",
      points: [
        "新たに発行される株数・潜在株数を確認してください。",
        "調達金額と資金使途も重要です。",
        "発行済株式数に対して何％増えるかを見ると規模感が分かります。"
      ],
      caution:
        "タイトルだけの判定なので、発行主体や条件によっては意味が異なる場合があります。"
    };
  }

  if (categories.includes("大型受注")) {
    return {
      headline: "大きな受注・契約を獲得した開示です",
      summary:
        "会社が大口案件を受注・落札したことに関する情報です。",
      points: [
        "受注金額を年間売上高と比べるとインパクトを判断しやすいです。",
        "売上・利益に計上される時期も確認してください。"
      ],
      caution:
        "受注金額がそのまま利益になるわけではありません。"
    };
  }

  if (categories.includes("業務提携")) {
    return {
      headline: "他社との提携・協業に関する開示です",
      summary:
        "他社と事業を一緒に進める、共同開発するなどの関係を作る内容です。",
      points: [
        "相手企業と具体的に何をするのか。",
        "売上や利益への影響時期が示されているか。"
      ],
      caution:
        "提携発表だけでは業績への具体的な効果がまだ分からない場合があります。"
    };
  }

  if (categories.includes("M&A")) {
    return {
      headline: "買収・合併・子会社化などに関する開示です",
      summary:
        "会社や事業を取得・統合・売却するなど、企業構造が変わる案件です。",
      points: [
        "誰が誰を取得するのか。",
        "取得金額や持株比率。",
        "業績への影響と資金調達方法。"
      ],
      caution:
        "案件の規模や条件によって影響が大きく変わるので原文確認が重要です。"
    };
  }

  if (categories.includes("赤字転落")) {
    return {
      headline: "利益が赤字になることに関する開示です",
      summary:
        "黒字から損失へ転じる、または損失を計上する内容です。",
      points: [
        "営業損失なのか、特別損失など一時要因なのか確認してください。",
        "通期業績への影響も重要です。"
      ],
      caution:
        "一時的な損失と本業の悪化では意味が大きく違います。"
    };
  }

  return {
    headline: "重要開示を検出しました",
    summary: "タイトルから重要そうな開示を検出しました。",
    points: [
      "内容の詳細はTDnet原文で確認してください。"
    ],
    caution:
      "これはAIを使わないルールベースの自動説明です。"
  };
}

function makeId(item) {
  return `${item.time}|${item.code}|${item.title}`;
}

async function makeDetailId(date, item) {
  const input = `${date}|${makeId(item)}`;
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .slice(0, 12)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readTdnetAll() {
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const date = nowJst.toISOString().slice(0, 10).replaceAll("-", "");

  const allItems = [];
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page++) {
    const pageNo = String(page).padStart(3, "0");
    const url = `https://www.release.tdnet.info/inbs/I_list_${pageNo}_${date}.html`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "TDnet-Radar/2.1"
      }
    });

    if (!response.ok) {
      break;
    }

    const html = await response.text();
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const pageItems = [];

    for (const row of rows) {
      const time = getCell(row, "kjTime");
      const code = getCell(row, "kjCode");
      const company = getCell(row, "kjName");
      const title = getCell(row, "kjTitle");
      const originalUrl = getLink(row, "kjTitle");

      if (!time || !code || !company || !title) {
        continue;
      }

      pageItems.push({
        time,
        code,
        company,
        title,
        originalUrl: originalUrl || url
      });
    }

    if (pageItems.length === 0) {
      break;
    }

    allItems.push(...pageItems);

    if (pageItems.length < 100) {
      break;
    }
  }

  return { date, items: allItems };
}

function getCell(row, className) {
  const regex = new RegExp(
    `<td[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
    "i"
  );

  const match = row.match(regex);
  if (!match) return "";

  return decodeHtml(
    match[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function getLink(row, className) {
  const regex = new RegExp(
    `<td[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
    "i"
  );

  const cellMatch = row.match(regex);
  if (!cellMatch) return "";

  const hrefMatch = cellMatch[1].match(/<a[^>]*href=["']([^"']+)["']/i);
  if (!hrefMatch) return "";

  const href = decodeHtml(hrefMatch[1].trim());

  try {
    return safeTdnetUrl(new URL(href, "https://www.release.tdnet.info/inbs/").href);
  } catch {
    return "";
  }
}

// 通知・リンクに使うのはTDnetのHTTPS原文/一覧だけ。
function safeTdnetUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.release.tdnet.info" ||
        url.username || url.password || url.port || !url.pathname.startsWith("/inbs/")) return "";
    return url.href;
  } catch { return ""; }
}

function makeTdnetListUrl(date) {
  return `https://www.release.tdnet.info/inbs/I_list_001_${date}.html`;
}

function decodeHtml(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function sendPush(env, item, categories, detailId, date) {
  const originalUrl = safeTdnetUrl(item.originalUrl) || makeTdnetListUrl(date);
  const detailLink = new URL("detail.html", APP_BASE_URL);
  detailLink.search = new URLSearchParams({ id: detailId, date, original: originalUrl }).toString();
  const detailUrl = detailLink.href;

  const body = {
    app_id: env.ONESIGNAL_APP_ID,
    include_subscription_ids: [
      env.ONESIGNAL_SUBSCRIPTION_ID
    ],
    headings: {
      en: `TDnetレーダー【${categories.join("・")}】`
    },
    contents: {
      en: `${item.company}（${item.code}）\n${item.title}`
    },
    // Web PushはOneSignalの専用SWがこのURLを開く。
    url: originalUrl,
    web_buttons: [{ id: "explanation", text: "かんたん説明", url: detailUrl }]
  };

  const response = await fetch(
    "https://api.onesignal.com/notifications",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${env.ONESIGNAL_API_KEY}`
      },
      body: JSON.stringify(body)
    }
  );

  const result = await response.json();
  console.log("OneSignal response:", JSON.stringify(result));

  if (!response.ok) {
    console.error("OneSignal送信失敗:", response.status, result);
    throw new Error("OneSignal push failed");
  }

  if (!result.id) {
    console.error("通知は作成されませんでした:", result);
    throw new Error("OneSignal returned no notification id");
  }

  console.log("OneSignal送信成功:", result.id);
  return result;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        ...extraHeaders
      }
    }
  );
}

function corsHeaders() {
  return {
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "https://kuma885.github.io",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
