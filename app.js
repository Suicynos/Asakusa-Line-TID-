// ===== 設定 =====
const TRAIN_POLL_MS = 15 * 1000;        // 列車位置: 15秒間隔
const INFO_POLL_MS = 90 * 1000;         // 運行情報: 90秒間隔
const DELAY_THRESHOLD_SEC = 60;         // 1分以上の遅れからバッジ表示
const STACK_VISIBLE_MAX = 2;            // 縦スタックで無条件表示する本数
const API_BASE = "https://api.odpt.org/api/v4";

const stationIndexById = new Map(STATIONS.map((s, i) => [s.id, i]));

function getApiKey() {
  return localStorage.getItem("odpt_api_key") || "";
}

// ===== ODPT フルID変換ヘルパー =====
function stationFullId(shortId) {
  return `odpt.Station:Toei.Asakusa.${shortId}`;
}
function stationShortIdFromFull(fullId) {
  if (!fullId) return null;
  const parts = fullId.split(".");
  return parts[parts.length - 1] || null;
}

// ===== データ取得 =====

async function fetchTrains() {
  const key = getApiKey();
  if (!key) {
    return generateSampleTrains();
  }
  const url = `${API_BASE}/odpt:Train?odpt:railway=${ASAKUSA_RAILWAY}&acl:consumerKey=${encodeURIComponent(key)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    // fetch自体が失敗する場合、多くはCORSまたはネットワーク不通
    throw new Error(
      "APIへの接続に失敗しました(CORS制限、通信不可、またはURL誤りの可能性)。" +
      "ブラウザのDevTools(コンソール/ネットワークタブ)を確認してください。"
    );
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Train API error: HTTP ${res.status} ${bodyText.slice(0, 200)}`);
  }
  const raw = await res.json();
  console.log(`[odpt:Train] 取得件数: ${raw.length}件`, raw.length ? raw[0] : null);
  const normalized = raw.map(normalizeTrain).filter(Boolean);
  if (raw.length > 0 && normalized.length === 0) {
    console.warn(
      "[odpt:Train] APIからデータは取得できましたが、全件フィルタで除外されました。" +
      "raw[0]の odpt:railDirection / odpt:fromStation の値が stations.js の定義と" +
      "一致しているか確認してください。", raw[0]
    );
  }
  return normalized;
}

async function fetchTrainInformation() {
  const key = getApiKey();
  if (!key) {
    return generateSampleInformation();
  }
  const url = `${API_BASE}/odpt:TrainInformation?odpt:operator=${TOEI_OPERATOR}&acl:consumerKey=${encodeURIComponent(key)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    throw new Error("運行情報APIへの接続に失敗しました(CORS制限または通信不可の可能性)。");
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`TrainInformation API error: HTTP ${res.status} ${bodyText.slice(0, 200)}`);
  }
  const raw = await res.json();
  return raw
    .filter((it) => (it["odpt:railway"] || "").includes("Asakusa") || !it["odpt:railway"])
    .map(normalizeInformation)
    .filter(Boolean);
}

function normalizeTrain(t) {
  const fromFull = t["odpt:fromStation"];
  const fromShort = stationShortIdFromFull(fromFull);
  if (!fromShort || !stationIndexById.has(fromShort)) {
    // 境界駅など、この路線の駅として解決できない場合は表示対象外
    return null;
  }
  const direction = t["odpt:railDirection"];
  const lane = DIRECTION_LANE[direction] || null;
  if (!lane) return null;

  const typeId = t["odpt:trainType"];
  const typeStyle = TRAIN_TYPE_STYLE[typeId] || null;

  if (typeId && !typeStyle) {
    console.warn(
      `[trainType未対応] "${typeId}" はTRAIN_TYPE_STYLEに未登録のためグレーのアイコンのみで表示しています。` +
      `列車番号=${t["odpt:trainNumber"]}, 行き先=${JSON.stringify(t["odpt:destinationStation"])}, ` +
      `方向=${direction}。正しい種別名が分かれば stations.js に追加してください。`
    );
  }

  const typeLabel = typeStyle
    ? (typeStyle.labelByLane ? typeStyle.labelByLane[lane] : typeStyle.label)
    : null;

  const destArr = t["odpt:destinationStation"] || [];
  const destFull = destArr.length ? destArr[0] : null;
  const destShort = destFull ? stationShortIdFromFull(destFull) : null;
  const destStation = destShort ? STATIONS.find((s) => s.id === destShort) : null;
  // 自社線(浅草線内)の駅名は STATIONS から、直通先は OTHER_OPERATOR_STATION_NAMES から解決。
  // どちらでも解決できない場合のみ行き先欄を非表示にする。
  const destName = destStation
    ? destStation.name
    : (destFull && OTHER_OPERATOR_STATION_NAMES[destFull]) || null;

  if (destFull && !destStation && !destName) {
    console.warn(
      `[destination未解決] "${destFull}" はOTHER_OPERATOR_STATION_NAMESに未登録のため行き先欄を非表示にしています。` +
      `表示したい場合は stations.js のOTHER_OPERATOR_STATION_NAMESに追加してください。`
    );
  }

  const delaySec = typeof t["odpt:delay"] === "number" ? t["odpt:delay"] : 0;

  // 駅間走行中(odpt:toStation あり)なら、出発駅から次駅へ向かう方向を求める。
  // +1 = 右隣の駅へ(北行), -1 = 左隣の駅へ(南行), 0 = 停車中/判定不能
  const toShort = stationShortIdFromFull(t["odpt:toStation"]);
  const fromIdx = stationIndexById.get(fromShort);
  const toIdx = toShort ? stationIndexById.get(toShort) : undefined;
  const betweenDir =
    toIdx !== undefined && Math.abs(toIdx - fromIdx) === 1 ? Math.sign(toIdx - fromIdx) : 0;

  return {
    id: t["owl:sameAs"] || `${t["odpt:trainNumber"]}-${fromShort}`,
    trainNumber: t["odpt:trainNumber"] || "",
    typeId,
    typeLabel,
    typeBg: typeStyle ? typeStyle.bg : null,
    typeFg: typeStyle ? typeStyle.fg : null,
    destName,
    stationId: fromShort,
    lane,
    delaySec,
    betweenDir,
  };
}

function normalizeInformation(info) {
  const text = info["odpt:trainInformationText"];
  const status = info["odpt:trainInformationStatus"];
  const ja = (obj) => (obj && typeof obj === "object" ? obj.ja : obj) || "";
  const statusJa = ja(status);
  const textJa = ja(text);
  if (!textJa) return null;
  const isNormal = statusJa.includes("平常");
  return { text: textJa, isNormal };
}

// ===== サンプルデータ（APIキー未設定時のデモ用） =====

function generateSampleTrains() {
  return [
    { id: "s1", trainNumber: "505K", typeId: "odpt.TrainType:Express", typeLabel: "快速", typeBg: "#EC407A", typeFg: "#fff", destName: "西馬込", stationId: "Kuramae", lane: "down", delaySec: 0, betweenDir: -1 },
    { id: "s2", trainNumber: "5511T", typeId: "odpt.TrainType:CommuterLimitedExpress", typeLabel: "通勤特急", typeBg: "#4FC3F7", typeFg: "#fff", destName: "押上", stationId: "Asakusa", lane: "up", delaySec: 0 },
    { id: "s3", trainNumber: "1213T", typeId: "odpt.TrainType:AccessExpress", typeLabel: "快特", typeBg: "#F57C00", typeFg: "#fff", destName: "羽田空港第1・第2ターミナル", stationId: "Asakusa", lane: "up", delaySec: 120 },
    { id: "s4", trainNumber: "9021", typeId: "odpt.TrainType:NonReservedSeat", typeLabel: null, typeBg: null, typeFg: null, destName: null, stationId: "HonjoAzumabashi", lane: "up", delaySec: 0 },
    { id: "s5", trainNumber: "23T", typeId: "odpt.TrainType:RapidLimitedExpress", typeLabel: "快速特急", typeBg: "#2E7D32", typeFg: "#fff", destName: "西馬込", stationId: "Oshiage", lane: "down", delaySec: 0 },
    { id: "s6", trainNumber: "812K", typeId: "odpt.TrainType:Local", typeLabel: "普通", typeBg: "#000", typeFg: "#fff", destName: "西馬込", stationId: "Sengakuji", lane: "down", delaySec: 90 },
  ];
}

function generateSampleInformation() {
  return [{ text: "人身事故の影響で西馬込方面に遅れが出ています", isNormal: false }];
}

// ===== 描画 =====

let expandedStack = new Set(); // "lane:stationId" のセットで展開状態を保持

function groupTrainsByLaneStation(trains) {
  const map = new Map(); // key: `${lane}:${stationId}` -> trains[]
  for (const t of trains) {
    const key = `${t.lane}:${t.stationId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return map;
}

function formatDelay(sec) {
  const min = Math.floor(sec / 60);
  return `${min}分遅れ`;
}

// ピクセル調の電車アイコン(角ばった車体・屋根の突起・下端で車体と一体化する車輪)
// currentColor を使うので、.train-icon 側の color で色を制御する
const TRAIN_ICON_SVG = `
<svg viewBox="0 0 140 74" xmlns="http://www.w3.org/2000/svg">
  <rect x="14" y="8" width="6" height="8" fill="currentColor"/>
  <rect x="120" y="8" width="6" height="8" fill="currentColor"/>
  <rect x="6" y="14" width="128" height="44" rx="4" fill="currentColor"/>
  <rect x="18" y="24" width="18" height="18" fill="var(--panel-bg,#fff)"/>
  <rect x="46" y="24" width="18" height="18" fill="var(--panel-bg,#fff)"/>
  <rect x="76" y="24" width="18" height="18" fill="var(--panel-bg,#fff)"/>
  <rect x="104" y="24" width="18" height="18" fill="var(--panel-bg,#fff)"/>
  <circle cx="34" cy="58" r="11" fill="currentColor"/>
  <circle cx="106" cy="58" r="11" fill="currentColor"/>
</svg>`;

function trainIconHTML(extraClass) {
  return `<span class="train-icon ${extraClass}" aria-hidden="true">${TRAIN_ICON_SVG}</span>`;
}

function trainBadgeHTML(t) {
  const flipClass = t.lane === "down" ? "train-icon--flip" : "";
  // 駅間走行中は、出発駅の列から次駅側へ半マス(駅間の中央)ずらして表示する
  const dir = t.betweenDir || 0;
  const betweenAttr = dir !== 0 ? ` data-between="1" style="--between-dir:${dir}"` : "";

  if (!t.typeLabel) {
    // 回送・不明種別: アイコンのみ(グレー)
    return `<div class="train-stack-item"${betweenAttr}>
      ${trainIconHTML(`train-icon--unknown ${flipClass}`)}
    </div>`;
  }
  const destHTML = t.destName ? `<span class="train-badge__dest">${escapeHTML(t.destName)}</span>` : "";
  const delayHTML = t.delaySec >= DELAY_THRESHOLD_SEC
    ? `<div class="delay-bubble">
         <div class="delay-bubble__text">${formatDelay(t.delaySec)}</div>
         <div class="delay-bubble__tail"></div>
       </div>`
    : "";
  return `<div class="train-stack-item"${betweenAttr}>
    <div class="train-badge">
      <span class="train-badge__number">${escapeHTML(t.trainNumber)}</span>
      <span class="train-badge__type" style="background:${t.typeBg};color:${t.typeFg}">${escapeHTML(t.typeLabel)}</span>
      ${destHTML}
    </div>
    <div class="train-with-delay">
      ${delayHTML}
      ${trainIconHTML(flipClass)}
    </div>
  </div>`;
}

function stackHTML(trains, lane, stationId) {
  if (!trains || trains.length === 0) return "";
  const key = `${lane}:${stationId}`;
  const expanded = expandedStack.has(key);
  if (trains.length <= STACK_VISIBLE_MAX || expanded) {
    return trains.map(trainBadgeHTML).join("");
  }
  const visible = trains.slice(0, STACK_VISIBLE_MAX - 1);
  const restCount = trains.length - visible.length;
  return `${visible.map(trainBadgeHTML).join("")}
    <button class="more-badge" data-stack-key="${key}">+${restCount}本</button>`;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function render(trains, infoList) {
  const board = document.getElementById("board");

  if (lastError) {
    board.innerHTML = `<div class="diag diag--error">
      <strong>取得エラー</strong><br>${escapeHTML(lastError)}
    </div>`;
    renderBanner(infoList);
    return;
  }

  if (getApiKey() && trains.length === 0) {
    board.innerHTML = `<div class="diag">
      APIからのデータは0件でした（現在この路線区間に列車がいないか、
      <code>odpt:railDirection</code> / <code>odpt:fromStation</code> の値が
      stations.js の定義と一致していない可能性があります。
      ブラウザのDevToolsコンソールに詳細ログを出力しています）。
    </div>`;
    renderBanner(infoList);
    return;
  }

  const grouped = groupTrainsByLaneStation(trains);

  const upperCols = STATIONS.map((s) => {
    const list = grouped.get(`up:${s.id}`) || [];
    return `<div class="station-col">${stackHTML(list, "up", s.id)}</div>`;
  }).join("");

  const dotCols = STATIONS.map((s) => {
    return `<div class="station-dot-col"><div class="station-dot">${s.no}</div></div>`;
  }).join("");

  const nameCols = STATIONS.map((s) => {
    return `<div class="station-name">${escapeHTML(s.name)}</div>`;
  }).join("");

  const lowerCols = STATIONS.map((s) => {
    const list = grouped.get(`down:${s.id}`) || [];
    return `<div class="station-col">${stackHTML(list, "down", s.id)}</div>`;
  }).join("");

  board.innerHTML = `
    <div class="board-inner">
      <div class="lane-row lane-row--upper">${upperCols}</div>
      <div class="spine-row">
        <div class="spine-line"></div>
        <div class="spine-grid">${dotCols}</div>
      </div>
      <div class="name-row">${nameCols}</div>
      <div class="lane-row lane-row--lower">${lowerCols}</div>
    </div>
  `;

  board.querySelectorAll(".more-badge").forEach((btn) => {
    btn.addEventListener("click", () => {
      expandedStack.add(btn.dataset.stackKey);
      render(trains, infoList);
    });
  });

  renderBanner(infoList);
}

function renderBanner(infoList) {
  const banner = document.getElementById("info-banner");
  const textEl = document.getElementById("info-banner__text");
  const abnormal = infoList.find((i) => !i.isNormal);
  if (abnormal) {
    textEl.textContent = abnormal.text;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function updateClock() {
  const el = document.getElementById("updated-time");
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function setConnStatus(msg, isError) {
  const el = document.getElementById("conn-status");
  el.textContent = msg;
  el.classList.toggle("is-error", !!isError);
}

// ===== ポーリング =====

let latestTrains = [];
let latestInfo = [];
let lastError = null;

async function pollTrains() {
  try {
    latestTrains = await fetchTrains();
    lastError = null;
    updateClock();
    setConnStatus("", false);
  } catch (e) {
    console.error(e);
    lastError = e.message || String(e);
    setConnStatus("列車位置の取得に失敗しました", true);
  }
  render(latestTrains, latestInfo);
}

async function pollInformation() {
  try {
    latestInfo = await fetchTrainInformation();
  } catch (e) {
    console.error(e);
  }
  render(latestTrains, latestInfo);
}

function startPolling() {
  pollTrains();
  pollInformation();
  setInterval(pollTrains, TRAIN_POLL_MS);
  setInterval(pollInformation, INFO_POLL_MS);
}

// ===== 設定パネル =====

function initSettings() {
  const btn = document.getElementById("settings-btn");
  const panel = document.getElementById("settings-panel");
  const input = document.getElementById("api-key-input");
  const save = document.getElementById("settings-save");
  const close = document.getElementById("settings-close");
  const themeToggle = document.getElementById("theme-toggle-input");

  input.value = getApiKey();
  themeToggle.checked = localStorage.getItem("theme") === "dark";

  btn.addEventListener("click", () => { panel.hidden = false; });
  close.addEventListener("click", () => { panel.hidden = true; });
  save.addEventListener("click", () => {
    localStorage.setItem("odpt_api_key", input.value.trim());
    location.reload();
  });
  themeToggle.addEventListener("change", () => {
    const isDark = themeToggle.checked;
    localStorage.setItem("theme", isDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  });
}

// ===== 初期化 =====

window.addEventListener("DOMContentLoaded", () => {
  initSettings();
  startPolling();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.error("SW登録失敗", e));
  }
});
