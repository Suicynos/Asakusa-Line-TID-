// 都営浅草線 駅一覧（西馬込→押上の順）
// odptId は odpt:Station の末尾（"odpt.Station:Toei.Asakusa." に続く部分）
const STATIONS = [
  { id: "NishiMagome",     name: "西馬込",     no: "A01" },
  { id: "Magome",          name: "馬込",       no: "A02" },
  { id: "Nakanobu",        name: "中延",       no: "A03" },
  { id: "Togoshi",         name: "戸越",       no: "A04" },
  { id: "Gotanda",         name: "五反田",     no: "A05" },
  { id: "Takanawadai",     name: "高輪台",     no: "A06" },
  { id: "Sengakuji",       name: "泉岳寺",     no: "A07" },
  { id: "Mita",            name: "三田",       no: "A08" },
  { id: "Daimon",          name: "大門",       no: "A09" },
  { id: "Shimbashi",       name: "新橋",       no: "A10" },
  { id: "HigashiGinza",    name: "東銀座",     no: "A11" },
  { id: "Takaracho",       name: "宝町",       no: "A12" },
  { id: "Nihombashi",      name: "日本橋",     no: "A13" },
  { id: "Ningyocho",       name: "人形町",     no: "A14" },
  { id: "HigashiNihombashi", name: "東日本橋", no: "A15" },
  { id: "Asakusabashi",    name: "浅草橋",     no: "A16" },
  { id: "Kuramae",         name: "蔵前",       no: "A17" },
  { id: "Asakusa",         name: "浅草",       no: "A18" },
  { id: "HonjoAzumabashi", name: "本所吾妻橋", no: "A19" },
  { id: "Oshiage",         name: "押上",       no: "A20" },
];

// odpt:railDirection の値 → レーン（"up"=押上方面/上段, "down"=西馬込方面/下段）
// 実データで確認済み: 都営浅草線は事業者名を含まない Northbound/Southbound 形式。
// Northbound = 押上方面(北行), Southbound = 西馬込方面(南行)
const DIRECTION_LANE = {
  "odpt.RailDirection:Northbound": "up",
  "odpt.RailDirection:Southbound": "down",
};

// 列車種別 → { label, color }
// odpt:trainType は「odpt.TrainType:Toei.{種別名}」の形式。
// 実データで確認済み: Local, LimitedExpress, RapidLimitedExpress, Rapid(→快速),
// Express(→急行), AirportRapidLimitedExpress(→エアポート快特), AccessExpress(→アクセス特急)
// "odpt.TrainType:Toei.Rapid" は当初「急行」→「アクセス特急」と誤認していたが、
// 正しくは「快速」に対応する値。
// "odpt.TrainType:Toei.Express" が実際の「急行」に対応する値(南行・羽田空港行きで確認。
// 急行は南行専用という調査結果とも整合)。
// AirportRapidLimitedExpress と AccessExpress は当初「同じtrainTypeが方向で呼び分け」
// だと誤認していたが、実際は別々のtrainTypeで、それぞれ固定の表示名を持つ。
// RapidLimitedExpress のみ、同じtrainTypeが方向によって表示名が変わる
// (京成方面/北行=快速特急、京急方面/南行=快特)。
// 未確認（命名パターンからの推測。表示されない場合はコンソールログの実際の値で要修正）:
// CommuterLimitedExpress
// color は背景色（文字は白固定）
const TRAIN_TYPE_STYLE = {
  "odpt.TrainType:Toei.Local":               { label: "普通",       bg: "#000000", fg: "#ffffff" },
  "odpt.TrainType:Toei.Rapid":               { label: "快速",       bg: "#EC407A", fg: "#ffffff" }, // 実データ確認済み
  "odpt.TrainType:Toei.Express":             { label: "急行",       bg: "#1E5FCC", fg: "#ffffff" }, // 実データ確認済み(南行専用)
  "odpt.TrainType:Toei.LimitedExpress":      { label: "特急",       bg: "#D32F2F", fg: "#ffffff" },
  "odpt.TrainType:Toei.CommuterLimitedExpress": { label: "通勤特急", bg: "#4FC3F7", fg: "#ffffff" }, // 未確認
  "odpt.TrainType:Toei.RapidLimitedExpress": {
    labelByLane: { up: "快速特急", down: "快特" }, // 京成方面=快速特急 / 京急方面=快特
    bg: "#2E7D32", fg: "#ffffff",
  },
  "odpt.TrainType:Toei.AirportRapidLimitedExpress": { label: "エアポート快特", bg: "#F57C00", fg: "#ffffff" }, // 実データ確認済み
  "odpt.TrainType:Toei.AccessExpress":       { label: "アクセス特急", bg: "#F57C00", fg: "#ffffff" }, // 実データ確認済み
};

// 不明・回送などフォールバック
const UNKNOWN_TYPE_STYLE = { label: null, bg: null, fg: null };

// 都営浅草線の事業者ID（TrainInformationのフィルタに使用）
const TOEI_OPERATOR = "odpt.Operator:Toei";
const ASAKUSA_RAILWAY = "odpt.Railway:Toei.Asakusa";

// 直通先（京急・京成・北総・芝山）の主要駅名テーブル
// odpt:destinationStation のフルID(例: "odpt.Station:Keikyu.Airport.HanedaAirportTerminal1and2")
// → 日本語表示名。一般知識ベースの一覧で全駅網羅はしていない。
// ここに無い駅は行き先欄が非表示になる(既存の仕様通り)ので、
// 表示させたい駅があれば追記すること。
const OTHER_OPERATOR_STATION_NAMES = {
  // 京急（泉岳寺から先、西馬込方面と反対側で直通）
  "odpt.Station:Keikyu.Main.Shinaga": "品川",
  "odpt.Station:Keikyu.Main.KeikyuKamata": "京急蒲田",
　"odpt.Station:Keikyu.Main.Kamioooka": "上大岡",
　"odpt.Station:Keikyu.Main.Yokohama": "横浜",
  "odpt.Station:Keikyu.Main.Kanazawabunko": "金沢文庫",
  "odpt.Station:Keikyu.Main.Uraga": "浦賀",
  "odpt.Station:Keikyu.Kurihama.KeikyuKurihama": "京急久里浜",
  "odpt.Station:Keikyu.Zushi.ZushiHayama": "逗子・葉山",
  "odpt.Station:Keikyu.Kurihama.Misakiguchi": "三崎口",
  "odpt.Station:Keikyu.Airport.HanedaAirportTerminal1and2": "羽田空港",
  "odpt.Station:Keikyu.Airport.HanedaAirportTerminal3": "羽田空港第3ターミナル",

  // 京成・北総・芝山（押上から先）
  "odpt.Station:Keisei.Main.Aoto": "青砥",
  "odpt.Station:Keisei.Main.KeiseiTakasago": "京成高砂",
  "odpt.Station:Keisei.Main.KeiseiSakura": "京成佐倉",
  "odpt.Station:Keisei.Main.KeiseiNarita": "京成成田",
  "odpt.Station:Keisei.Main.Sogosando": "宗吾参道",
  "odpt.Station:Keisei.Main.NaritaAirportTerminal1": "成田空港",
　"odpt.Station:Keisei.Main.NaritaAirportTerminal2and3": "空港第２ビル",
  "odpt.Station:Keisei.NaritaAirport.NaritaAirportTerminal1": "成田空港",
  "odpt.Station:Keisei.NaritaSkyAccess.NaritaAirportTerminal1": "成田空港",
  "odpt.Station:Keisei.NaritaSkyAccess.NaritaAirportTerminal2and3": "空港第２ビル",
  "odpt.Station:Keisei.Oshiage.Aoto": "青砥",
  "odpt.Station:Hokuso.Hokuso.ImbaNihonIdai": "印旛日本医大",
  "odpt.Station:Hokuso.Hokuso.InzaiMakinohara": "印西牧の原",
  "odpt.Station:Hokuso.Hokuso.Shinkamagaya": "新鎌ヶ谷",
　"odpt.Station:Hokuso.Hokuso.Yagiri": "矢切",
  "odpt.Station:Shibayama.Shibayama.ShibayamaChiyoda": "芝山千代田",
};
