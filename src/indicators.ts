// Indicator math — byte-for-byte the same formulas as the user's live
// hook (myx_wave_check.sh) and the LazyBear WaveTrend original:
//   ap = (h+l+c)/3; esa = EMA(ap,10); d = EMA(|ap-esa|,10);
//   ci = (ap-esa)/(0.015*d); WT1 = EMA(ci,21); WT2 = SMA(WT1,4)
// RSI(14) Wilder. Divergence: pivot 5/5 confirmed 5 bars later, max 60
// bars between pivots; bull needs RSI at pivot < 45, bear needs > 55.

export type Candle = {
  time: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function ema(values: number[], len: number): number[] {
  const k = 2 / (len + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function sma(values: (number | null)[], len: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < len - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    let ok = true;
    for (let j = i - len + 1; j <= i; j++) {
      const v = values[j];
      if (v == null) {
        ok = false;
        break;
      }
      sum += v;
    }
    out.push(ok ? sum / len : null);
  }
  return out;
}

export function wavetrend(candles: Candle[]): {
  wt1: (number | null)[];
  wt2: (number | null)[];
} {
  const n = candles.length;
  if (n === 0) return { wt1: [], wt2: [] };
  const ap = candles.map((c) => (c.high + c.low + c.close) / 3);
  const esa = ema(ap, 10);
  const d = ema(
    ap.map((v, i) => Math.abs(v - (esa[i] ?? 0))),
    10,
  );
  const ci = ap.map((v, i) => {
    const denom = 0.015 * (d[i] ?? 0);
    return denom === 0 ? 0 : (v - (esa[i] ?? 0)) / denom;
  });
  const wt1raw = ema(ci, 21);
  const wt1: (number | null)[] = wt1raw.map((v) => v);
  const wt2 = sma(wt1, 4);
  return { wt1, wt2 };
}

/** The user's "10 in 1 MAs" set from TradingView (MA 6–10 off):
 * EMA 200 yellow, SMA 50 red, EMA 30 magenta, EMA 9 green, EMA 5 white.
 * Four lines are computed on the closes of the displayed timeframe;
 * EMA 30 is MULTI-TIMEFRAME (the screenshot's "Multitimeframe" mode):
 * it is computed from 4h candles and projected onto the chart — see
 * mtfEmaSeries below. */
export const MA_CONFIG: {
  type: "EMA" | "SMA";
  len: number;
  color: string;
  /** True when the line is sourced from 4h candles, not the display TF. */
  mtf?: boolean;
}[] = [
  { type: "EMA", len: 200, color: "#f0b90b" },
  { type: "SMA", len: 50, color: "#ef5350" },
  { type: "EMA", len: 30, color: "#e040fb", mtf: true },
  { type: "EMA", len: 9, color: "#00e676" },
  { type: "EMA", len: 5, color: "#ffffff" },
];

export type MovingAverage = {
  label: string;
  color: string;
  values: (number | null)[];
};

export function movingAverages(closes: number[]): MovingAverage[] {
  return MA_CONFIG.map((cfg) => ({
    label: `${cfg.type} ${cfg.len}`,
    color: cfg.color,
    values:
      cfg.type === "EMA"
        ? ema(closes, cfg.len).map((v) => v)
        : sma(closes, cfg.len),
  }));
}

/**
 * Multi-timeframe EMA, step-projected onto the display candles.
 *
 * The EMA is computed over the higher-timeframe (4h) closes, but ONLY
 * closed 4h candles contribute: the still-forming 4h candle is excluded
 * so the line never repaints. Each closed 4h candle's EMA value applies
 * to every display bar inside that 4h candle's time span (a step line);
 * display bars inside the currently open 4h candle keep the last closed
 * 4h value, and bars before the first closed 4h candle get null.
 */
export function mtfEmaSeries(
  display: Candle[],
  htf: Candle[],
  len: number,
  htfSeconds: number,
): (number | null)[] {
  const out: (number | null)[] = new Array(display.length).fill(null);
  if (display.length === 0 || htf.length === 0) return out;
  const nowSec = Math.floor(Date.now() / 1000);
  // Index of the last CLOSED htf candle (its span has fully elapsed).
  let lastClosed = -1;
  for (let i = 0; i < htf.length; i++) {
    const c = htf[i];
    if (c && c.time + htfSeconds <= nowSec) lastClosed = i;
    else break;
  }
  if (lastClosed < 0) return out;
  const htfEma = ema(
    htf.slice(0, lastClosed + 1).map((c) => c.close),
    len,
  );
  // Two-pointer walk: both candle arrays ascend by time.
  let j = 0;
  for (let i = 0; i < display.length; i++) {
    const t = display[i]?.time ?? 0;
    while (j < lastClosed && (htf[j + 1]?.time ?? Infinity) <= t) j++;
    const hc = htf[j];
    if (hc && hc.time <= t) out[i] = htfEma[j] ?? null;
  }
  return out;
}

/** RSI(14) Wilder over closes; null until bar 14. Returns full-length. */
export function rsiSeries(closes: number[], len = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= len) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= len; i++) {
    const diff = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / len;
  let avgLoss = loss / len;
  out[len] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = len + 1; i < closes.length; i++) {
    const diff = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    avgGain = (avgGain * (len - 1) + Math.max(diff, 0)) / len;
    avgLoss = (avgLoss * (len - 1) + Math.max(-diff, 0)) / len;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export type Divergence = {
  kind: "bull" | "bear";
  /** Index of the confirming (second) pivot bar. */
  pivotIndex: number;
  /** Index where the pivot becomes known (pivotIndex + 5). */
  confirmIndex: number;
  prevIndex: number;
};

const PIVOT = 5;
const RANGE = 60;

export function findDivergences(
  candles: Candle[],
  rsi: (number | null)[],
): Divergence[] {
  const out: Divergence[] = [];
  const isPivotLow = (i: number): boolean => {
    if (i < PIVOT || i + PIVOT >= candles.length) return false;
    const v = candles[i]?.low ?? Infinity;
    for (let k = i - PIVOT; k <= i + PIVOT; k++) {
      if (k !== i && (candles[k]?.low ?? Infinity) <= v) return false;
    }
    return rsi[i] != null;
  };
  const isPivotHigh = (i: number): boolean => {
    if (i < PIVOT || i + PIVOT >= candles.length) return false;
    const v = candles[i]?.high ?? -Infinity;
    for (let k = i - PIVOT; k <= i + PIVOT; k++) {
      if (k !== i && (candles[k]?.high ?? -Infinity) >= v) return false;
    }
    return rsi[i] != null;
  };

  let lastLow: number | null = null;
  let lastHigh: number | null = null;
  for (let i = PIVOT; i + PIVOT < candles.length; i++) {
    if (isPivotLow(i)) {
      if (
        lastLow != null &&
        i - lastLow <= RANGE &&
        (candles[i]?.low ?? 0) < (candles[lastLow]?.low ?? 0) &&
        (rsi[i] ?? 0) > (rsi[lastLow] ?? 0) &&
        (rsi[i] ?? 100) < 45
      ) {
        out.push({
          kind: "bull",
          pivotIndex: i,
          confirmIndex: i + PIVOT,
          prevIndex: lastLow,
        });
      }
      lastLow = i;
    }
    if (isPivotHigh(i)) {
      if (
        lastHigh != null &&
        i - lastHigh <= RANGE &&
        (candles[i]?.high ?? 0) > (candles[lastHigh]?.high ?? 0) &&
        (rsi[i] ?? 0) < (rsi[lastHigh] ?? 0) &&
        (rsi[i] ?? 0) > 55
      ) {
        out.push({
          kind: "bear",
          pivotIndex: i,
          confirmIndex: i + PIVOT,
          prevIndex: lastHigh,
        });
      }
      lastHigh = i;
    }
  }
  return out;
}

export type WtCross = { index: number; dir: "up" | "down" };

export function findCrosses(
  wt1: (number | null)[],
  wt2: (number | null)[],
): WtCross[] {
  const out: WtCross[] = [];
  for (let i = 1; i < wt1.length; i++) {
    const a0 = wt1[i - 1];
    const b0 = wt2[i - 1];
    const a1 = wt1[i];
    const b1 = wt2[i];
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
    if (a0 <= b0 && a1 > b1) out.push({ index: i, dir: "up" });
    else if (a0 >= b0 && a1 < b1) out.push({ index: i, dir: "down" });
  }
  return out;
}

export function zoneLabel(wt1: number | null): string {
  if (wt1 == null) return "—";
  if (wt1 < -60) return "Quá bán sâu";
  if (wt1 < -53) return "Quá bán";
  if (wt1 > 60) return "Quá mua sâu";
  if (wt1 > 53) return "Quá mua";
  return "Trung tính";
}

// =====================================================================
// MMIS Holy Grail Suite (PRO) — a faithful TypeScript port of the
// user's MMIS_HolyGrail_MM_Suite.pine (Pine v6, calibrated on 172,779
// MYX candles), which replaced the older Engine build on 2026-11-15.
// This is a SEPARATE layer with its own formulas: its WaveTrend uses
// SMA(WT1, 3) (the chart's classic WT uses SMA 4) and its RSI
// divergence uses pivots ON the RSI series (4/4, gap 4–40 bars)
// instead of price pivots. Nothing here alters the classic WT/RSI/div
// math above. The Suite adds an 8-tactic MM classifier per bar, new
// Bull/Bear weights, an apex-or-UTAD exit in the latching FSM, and the
// "MM MUA" bottom-buy signal.
// =====================================================================

/** VWMA(source, len) — Pine ta.vwma: SMA(src·vol) / SMA(vol); null until
 * a full window exists or the window volume is zero. */
export function vwmaSeries(
  values: number[],
  volumes: number[],
  len: number,
): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sumPV = 0;
  let sumV = 0;
  for (let i = 0; i < values.length; i++) {
    sumPV += (values[i] ?? 0) * (volumes[i] ?? 0);
    sumV += volumes[i] ?? 0;
    if (i >= len) {
      sumPV -= (values[i - len] ?? 0) * (volumes[i - len] ?? 0);
      sumV -= volumes[i - len] ?? 0;
    }
    if (i >= len - 1) out[i] = sumV > 0 ? sumPV / sumV : null;
  }
  return out;
}

/** ATR(len) Wilder (Pine ta.atr): RMA of the true range, seeded with
 * the SMA of the first `len` TRs; null before bar len−1. */
export function atrSeries(candles: Candle[], len = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return out;
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1]?.close ?? c.close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - pc),
      Math.abs(c.low - pc),
    );
  });
  let atr = 0;
  for (let i = 0; i < tr.length; i++) {
    const t = tr[i] ?? 0;
    if (i < len - 1) {
      atr += t;
      continue;
    }
    if (i === len - 1) {
      atr = (atr + t) / len;
    } else {
      atr = (atr * (len - 1) + t) / len;
    }
    out[i] = atr;
  }
  return out;
}

/** WaveTrend exactly as the MMIS Pine computes it: same LazyBear CI as
 * the classic WT, but WT2 = SMA(WT1, 3) instead of 4. */
export function wavetrendMmis(candles: Candle[]): {
  wt1: (number | null)[];
  wt2: (number | null)[];
} {
  const n = candles.length;
  if (n === 0) return { wt1: [], wt2: [] };
  const ap = candles.map((c) => (c.high + c.low + c.close) / 3);
  const esa = ema(ap, 10);
  const d = ema(
    ap.map((v, i) => Math.abs(v - (esa[i] ?? 0))),
    10,
  );
  const ci = ap.map((v, i) => {
    const denom = 0.015 * (d[i] ?? 0);
    return denom === 0 ? 0 : (v - (esa[i] ?? 0)) / denom;
  });
  const wt1: (number | null)[] = ema(ci, 21).map((v) => v);
  const wt2 = sma(wt1, 3);
  return { wt1, wt2 };
}

export type MmisDivergence = {
  kind: "bull" | "bear";
  /** Index of the pivot bar on the RSI series. */
  pivotIndex: number;
  /** Index where the pivot is confirmed (pivotIndex + 4). */
  confirmIndex: number;
  prevIndex: number;
};

export type MmisEvent = {
  index: number;
  kind: "hold_start" | "apex_sell" | "stop_loss" | "mm_buy" | "utad_trap";
};

/** The Suite's 8 MM tactic classifiers, one boolean per bar each. */
export type MmisTactics = {
  /** 1. Liquidity sweep / Wyckoff spring. */
  sweep: boolean[];
  /** 2. Passive absorption wall. */
  absorption: boolean[];
  /** 3. Supply-dry test. */
  test: boolean[];
  /** 4. Supply-vacuum markup. */
  markup: boolean[];
  /** 5. Mid-trend shakeout. */
  shakeout: boolean[];
  /** 6. Apex blow-off climax. */
  apex: boolean[];
  /** 7. UTAD bull trap. */
  utad: boolean[];
  /** 8. Bid-withdrawal dump. */
  dump: boolean[];
};

export type MmisResult = {
  /** close / VWMA(close, 200); null until 200 bars exist. */
  mvrv: (number | null)[];
  absorptionScore: (number | null)[];
  volRatio: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  wt1: (number | null)[];
  bullIntent: number[];
  bearIntent: number[];
  tactics: MmisTactics;
  /** Candle color per bar from the tactic priority (Pine barcolor), or null. */
  barColor: (string | null)[];
  /** FSM position state AFTER processing each bar (0 idle, 1 holding). */
  posState: number[];
  /** FSM cooldown remaining AFTER processing each bar. */
  cooldown: number[];
  events: MmisEvent[];
  divs: MmisDivergence[];
};

/**
 * Full MMIS computation over the displayed candles, mirroring the Pine
 * bar by bar — including the latching position FSM, which is inherently
 * sequential (state + cooldown carried across bars).
 */
export function computeMmis(candles: Candle[]): MmisResult {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const ranges = candles.map((c) => c.high - c.low);

  // --- MVRV proxy ---
  const basis = vwmaSeries(closes, volumes, 200);
  const mvrv: (number | null)[] = basis.map((b, i) =>
    b != null && b > 0 ? (closes[i] ?? 0) / b : null,
  );

  // --- VSA absorption ---
  const avgVol = sma(volumes, 20);
  const avgRange = sma(ranges, 20);
  const volRatio: (number | null)[] = volumes.map((v, i) => {
    const a = avgVol[i];
    return a != null && a > 0 ? v / a : null;
  });
  const absorptionScore: (number | null)[] = ranges.map((r, i) => {
    const ar = avgRange[i];
    const vr = volRatio[i];
    if (ar == null || vr == null) return null;
    const spreadRatio = ar > 0 ? r / ar : 1;
    return vr / Math.max(spreadRatio, 0.1);
  });
  const upperWick: number[] = candles.map(
    (c) => c.high - Math.max(c.open, c.close),
  );
  const lowerWick: number[] = candles.map(
    (c) => Math.min(c.open, c.close) - c.low,
  );
  const upperWickRatio: number[] = candles.map((c, i) => {
    const r = ranges[i] ?? 0;
    return r > 0 ? (upperWick[i] ?? 0) / r : 0;
  });
  const lowerWickRatio: number[] = candles.map((c, i) => {
    const r = ranges[i] ?? 0;
    return r > 0 ? (lowerWick[i] ?? 0) / r : 0;
  });

  // --- Trend lines & ATR ---
  const ema20: (number | null)[] = ema(closes, 20).map((v) => v);
  const ema50: (number | null)[] = ema(closes, 50).map((v) => v);
  const atr = atrSeries(candles, 14);

  // --- WaveTrend MMIS + crosses ---
  const { wt1, wt2 } = wavetrendMmis(candles);
  const goldCross: boolean[] = new Array(n).fill(false);
  const deathCross: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const a0 = wt1[i - 1];
    const b0 = wt2[i - 1];
    const a1 = wt1[i];
    const b1 = wt2[i];
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
    if (a0 <= b0 && a1 > b1 && a1 <= -30) goldCross[i] = true;
    if (a0 >= b0 && a1 < b1 && a1 >= 40) deathCross[i] = true;
  }

  // --- RSI (Wilder, shared with the classic layer) ---
  const rsi = rsiSeries(closes, 14);

  // --- RSI divergence: pivots ON the RSI series, 4 left / 4 right,
  // valid pivot gap 4–40 bars (Pine inRange via barssince). The event
  // fires on the confirmation bar (pivot + 4), like the Pine. ---
  const divs: MmisDivergence[] = [];
  const bullDivAt: boolean[] = new Array(n).fill(false);
  const LB = 4;
  const isRsiPivotLow = (i: number): boolean => {
    const v = rsi[i];
    if (v == null) return false;
    for (let k = i - LB; k <= i + LB; k++) {
      if (k === i) continue;
      const o = rsi[k];
      if (o == null || o <= v) return false;
    }
    return true;
  };
  const isRsiPivotHigh = (i: number): boolean => {
    const v = rsi[i];
    if (v == null) return false;
    for (let k = i - LB; k <= i + LB; k++) {
      if (k === i) continue;
      const o = rsi[k];
      if (o == null || o >= v) return false;
    }
    return true;
  };
  let lastPl: number | null = null;
  let lastPh: number | null = null;
  for (let p = LB; p + LB < n; p++) {
    const confirm = p + LB;
    if (isRsiPivotLow(p)) {
      if (
        lastPl != null &&
        confirm - (lastPl + LB) >= 4 &&
        confirm - (lastPl + LB) <= 40 &&
        (candles[p]?.low ?? 0) < (candles[lastPl]?.low ?? 0) &&
        (rsi[p] ?? 0) > (rsi[lastPl] ?? 0)
      ) {
        divs.push({
          kind: "bull",
          pivotIndex: p,
          confirmIndex: confirm,
          prevIndex: lastPl,
        });
        bullDivAt[confirm] = true;
      }
      lastPl = p;
    }
    if (isRsiPivotHigh(p)) {
      if (
        lastPh != null &&
        confirm - (lastPh + LB) >= 4 &&
        confirm - (lastPh + LB) <= 40 &&
        (candles[p]?.high ?? 0) > (candles[lastPh]?.high ?? 0) &&
        (rsi[p] ?? 0) < (rsi[lastPh] ?? 0)
      ) {
        divs.push({
          kind: "bear",
          pivotIndex: p,
          confirmIndex: confirm,
          prevIndex: lastPh,
        });
      }
      lastPh = p;
    }
  }

  // --- The 8 MM tactic classifiers (Suite), per bar ---
  const tactics: MmisTactics = {
    sweep: new Array(n).fill(false),
    absorption: new Array(n).fill(false),
    test: new Array(n).fill(false),
    markup: new Array(n).fill(false),
    shakeout: new Array(n).fill(false),
    apex: new Array(n).fill(false),
    utad: new Array(n).fill(false),
    dump: new Array(n).fill(false),
  };
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (!c) continue;
    const a = atr[i];
    const r = rsi[i];
    const w = wt1[i];
    const vr = volRatio[i];
    const range = ranges[i] ?? 0;
    const uwr = upperWickRatio[i] ?? 0;
    const lwr = lowerWickRatio[i] ?? 0;
    const e20 = ema20[i];
    const e50 = ema50[i];
    // Highest of the 15 bars BEFORE this one (Pine: ta.highest(high[1], 15)).
    let highestPrev15: number | null = null;
    if (i >= 15) {
      let m = -Infinity;
      for (let k = i - 15; k < i; k++) {
        m = Math.max(m, candles[k]?.high ?? -Infinity);
      }
      highestPrev15 = m;
    }
    const new15High = highestPrev15 != null && c.high >= highestPrev15;
    const volDrying = i > 0 && c.volume < (candles[i - 1]?.volume ?? 0) * 0.95;

    // 1. Liquidity sweep / Wyckoff spring — the Suite drops the old
    // volume condition entirely.
    tactics.sweep[i] =
      lwr >= 0.35 && c.close >= c.low + range * 0.45 && w != null && w <= -30;
    // 2. Passive absorption wall: huge volume, tight range, WT not hot.
    tactics.absorption[i] =
      vr != null &&
      vr >= 1.8 &&
      a != null &&
      range <= 0.9 * a &&
      w != null &&
      w <= 10;
    // 3. Supply-dry test: tiny volume and range, holding above EMA 50.
    tactics.test[i] =
      vr != null &&
      vr <= 0.5 &&
      a != null &&
      range <= 0.7 * a &&
      e50 != null &&
      c.close >= e50;
    // 4. Supply-vacuum markup.
    tactics.markup[i] =
      e20 != null &&
      e50 != null &&
      c.close >= e20 &&
      e20 >= e50 &&
      c.close > c.open &&
      w != null &&
      w > 0 &&
      uwr < 0.2;
    // 5. Mid-trend shakeout: dip under EMA 20, recovered by the close.
    tactics.shakeout[i] =
      e50 != null &&
      e20 != null &&
      c.close >= e50 &&
      c.low < e20 &&
      c.close >= e20 &&
      lwr >= 0.3;
    // 6. Apex blow-off climax — formula unchanged from the Engine.
    tactics.apex[i] =
      a != null &&
      range >= 1.2 * a &&
      uwr >= 0.18 &&
      r != null &&
      (r >= 85 || (r >= 75 && w != null && w >= 38)) &&
      ((vr != null && vr >= 2) || (new15High && volDrying));
    // 7. UTAD bull trap: pokes above the prior 15-bar high, closes back under.
    tactics.utad[i] =
      highestPrev15 != null &&
      c.high > highestPrev15 &&
      c.close < highestPrev15 &&
      uwr >= 0.3 &&
      r != null &&
      r >= 68;
    // 8. Bid-withdrawal dump (replaces the Engine's falling knife).
    tactics.dump[i] =
      c.close < c.open &&
      e20 != null &&
      c.close < e20 &&
      lwr < 0.18 &&
      w != null &&
      w < -35 &&
      vr != null &&
      vr < 1.5;
  }

  // --- Latching FSM (sequential, exactly like the Pine var state) ---
  // Suite exits: apex OR utad -> BÁN ĐỈNH with a 6-bar cooldown (the
  // Engine's parabolic-blowoff variant is gone); stop-loss breach ->
  // 4-bar cooldown. Entry is blocked while a dump tactic is active.
  const posState: number[] = new Array(n).fill(0);
  const cooldownState: number[] = new Array(n).fill(0);
  const events: MmisEvent[] = [];
  const apexSellAt: boolean[] = new Array(n).fill(false);
  const holdStartAt: boolean[] = new Array(n).fill(false);
  let state = 0;
  let cooldown = 0;
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (!c) {
      posState[i] = state;
      cooldownState[i] = cooldown;
      continue;
    }
    const e20 = ema20[i];
    const e50 = ema50[i];
    const w = wt1[i];
    const uptrendLaunch =
      e20 != null &&
      e50 != null &&
      c.close >= e20 &&
      e20 >= e50 &&
      w != null &&
      w > -10 &&
      !tactics.dump[i];
    const slBreach =
      e50 != null &&
      e20 != null &&
      c.close < e50 &&
      c.close < e20 &&
      c.close < c.open;
    let firedExit = false;
    if (state === 0) {
      if (uptrendLaunch && cooldown === 0) {
        state = 1;
        holdStartAt[i] = true;
        events.push({ index: i, kind: "hold_start" });
      }
    } else if (tactics.apex[i] || tactics.utad[i]) {
      state = 0;
      firedExit = true;
      cooldown = 6;
      apexSellAt[i] = true;
      events.push({ index: i, kind: "apex_sell" });
    } else if (slBreach) {
      state = 0;
      firedExit = true;
      cooldown = 4;
      events.push({ index: i, kind: "stop_loss" });
    }
    if (cooldown > 0 && !firedExit) cooldown--;
    posState[i] = state;
    cooldownState[i] = cooldown;
  }

  // UTAD bars that did NOT trigger the FSM apex-sell still get the
  // trap marker (Pine: is_tactic_utad and not trigger_apex_sell).
  for (let i = 0; i < n; i++) {
    if (tactics.utad[i] && !apexSellAt[i]) {
      events.push({ index: i, kind: "utad_trap" });
    }
  }

  // --- "MM MUA" bottom-buy signal: fires only on the FIRST bar of a
  // raw run, and never on the same bar as a hold entry (VÀO HÀNG wins).
  for (let i = 0; i < n; i++) {
    const rawBuy =
      (tactics.sweep[i] ||
        (goldCross[i] && (lowerWickRatio[i] ?? 0) >= 0.25) ||
        tactics.absorption[i] ||
        bullDivAt[i]) &&
      !tactics.dump[i];
    const prevRaw =
      i > 0 &&
      (tactics.sweep[i - 1] ||
        (goldCross[i - 1] && (lowerWickRatio[i - 1] ?? 0) >= 0.25) ||
        tactics.absorption[i - 1] ||
        bullDivAt[i - 1]) &&
      !tactics.dump[i - 1];
    if (rawBuy && !prevRaw && !holdStartAt[i]) {
      events.push({ index: i, kind: "mm_buy" });
    }
  }
  events.sort((x, y) => x.index - y.index);

  // --- MM intent scores 0–100 (Suite weights) ---
  const bullIntent: number[] = new Array(n).fill(0);
  const bearIntent: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let bull = 0;
    if (tactics.sweep[i]) bull += 35;
    if (goldCross[i]) bull += 25;
    if (tactics.absorption[i]) bull += 20;
    if ((lowerWickRatio[i] ?? 0) >= 0.35) bull += 10;
    if (bullDivAt[i]) bull += 10;
    if (tactics.dump[i]) bull = 0;
    bullIntent[i] = Math.min(100, Math.max(0, bull));

    let bear = 0;
    if (tactics.apex[i]) bear += 50;
    if (tactics.utad[i]) bear += 35;
    if (deathCross[i]) bear += 25;
    const a = atr[i];
    const r = rsi[i];
    if (
      (upperWickRatio[i] ?? 0) >= 0.3 &&
      r != null &&
      r >= 75 &&
      a != null &&
      (ranges[i] ?? 0) >= 1.2 * a
    ) {
      bear += 25;
    }
    bearIntent[i] = Math.min(100, Math.max(0, bear));
  }

  // --- Candle colors by tactic priority (Pine barcolor): apex
  // fuchsia, utad maroon, sweep/absorption yellow, markup aqua. The
  // Engine's purple absorption-sell color is gone. ---
  const barColor: (string | null)[] = candles.map((_, i) => {
    if (tactics.apex[i]) return "#FF00FF";
    if (tactics.utad[i]) return "#800000";
    if (tactics.sweep[i] || tactics.absorption[i]) return "#FFFF00";
    if (tactics.markup[i]) return "#00FFFF";
    return null;
  });

  return {
    mvrv,
    absorptionScore,
    volRatio,
    ema20,
    ema50,
    wt1,
    bullIntent,
    bearIntent,
    tactics,
    barColor,
    posState,
    cooldown: cooldownState,
    events,
    divs,
  };
}

/** HUD "Động thái MM" for the last bar, in the Pine's priority order. */
export function mmisTactic(m: MmisResult): { label: string; color: string } {
  const n = m.bullIntent.length;
  if (n === 0) return { label: "TRUNG LẬP / SIDELINES", color: "#787b86" };
  const i = n - 1;
  const t = m.tactics;
  if (t.apex[i])
    return { label: "6. ĐỈNH CAO TRÀO BÁN GẤP", color: "#ff00ff" };
  if (t.utad[i])
    return { label: "7. BẪY BREAKOUT GIẢ (UTAD)", color: "#ff5252" };
  if (t.dump[i])
    return { label: "8. BUÔNG XẢ DAO RƠI (CẤM MUA)", color: "#ef5350" };
  if (t.sweep[i])
    return { label: "1. CÁ VOI QUÉT ĐÁY GOM HÀNG", color: "#26a69a" };
  if (t.absorption[i])
    return { label: "2. KÊ TƯỜNG GOM THỤ ĐỘNG", color: "#ffeb3b" };
  if (t.markup[i])
    return { label: "4. ĐẨY GIÁ CHÂN KHÔNG (HOLD)", color: "#00ffff" };
  if (t.shakeout[i])
    return { label: "5. RUNG LẮC RŨ BỎ (GIỮ TIẾP)", color: "#009688" };
  if (t.test[i])
    return { label: "3. TEST CẠN CUNG (SẮP BÙNG NỔ)", color: "#2962ff" };
  return { label: "TRUNG LẬP / SIDELINES", color: "#787b86" };
}

/** HUD "Trạng thái vị thế" for the last bar, from the FSM state. */
export function mmisPosition(m: MmisResult): { label: string; color: string } {
  const n = m.posState.length;
  if (n === 0) return { label: "ĐỨNG NGOÀI (WAIT)", color: "#787b86" };
  const i = n - 1;
  if (m.posState[i] === 1)
    return { label: "ĐANG GIỮ (HOLD)", color: "#00ffff" };
  if ((m.cooldown[i] ?? 0) > 0)
    return { label: "CHỜ COOLDOWN", color: "#ff9800" };
  return { label: "ĐỨNG NGOÀI (WAIT)", color: "#787b86" };
}

/** Pine Script v6 for real TradingView: WaveTrend Crosses (LazyBear /
 * Woodfield parameters) + RSI divergence, with alertcondition() wired
 * for the same eight conditions this app offers. */
export const PINE_SCRIPT = `//@version=6
indicator("MYX — WaveTrend Crosses + Phân kỳ RSI [LazyBear]", shorttitle="MYX WT+RSI Div", overlay=false)

// ——— WaveTrend [LazyBear], thông số Woodfield: Channel 10 / Average 21 ———
n1 = input.int(10, "Channel Length")
n2 = input.int(21, "Average Length")
obLevel1 = input.int(60, "Quá mua 1")
obLevel2 = input.int(53, "Quá mua 2")
osLevel1 = input.int(-60, "Quá bán 1")
osLevel2 = input.int(-53, "Quá bán 2")

ap = hlc3
esa = ta.ema(ap, n1)
d = ta.ema(math.abs(ap - esa), n1)
ci = (ap - esa) / (0.015 * d)
wt1 = ta.ema(ci, n2)
wt2 = ta.sma(wt1, 4)

plot(0, color=color.new(color.gray, 50))
plot(obLevel1, "OB1", color=color.red)
plot(obLevel2, "OB2", color=color.new(color.red, 50))
plot(osLevel1, "OS1", color=color.green)
plot(osLevel2, "OS2", color=color.new(color.green, 50))
plot(wt1, "WT1", color=color.new(#22d3ee, 0), linewidth=2)
plot(wt2, "WT2", color=color.new(#f23645, 0))
plot(wt1 - wt2, "WT1−WT2", color=color.new(color.blue, 70), style=plot.style_area)

// Chấm cắt kiểu WT_CROSS_LB: xanh = cắt lên, đỏ = cắt xuống
crossUp = ta.crossover(wt1, wt2)
crossDown = ta.crossunder(wt1, wt2)
plotshape(crossUp, style=shape.circle, location=location.absolute, color=color.new(#26a69a, 0), size=size.small)
plotshape(crossDown, style=shape.circle, location=location.absolute, color=color.new(#ef5350, 0), size=size.small)

// ——— RSI(14) + phân kỳ pivot 5/5, range tối đa 60 nến ———
// (Nhãn phân kỳ hiện ở mép pane WaveTrend; muốn xem đường RSI thì thêm
// indicator "Relative Strength Index" mặc định của TradingView vào pane mới.)
rsi = ta.rsi(close, 14)
lbL = input.int(5, "Pivot trái")
lbR = input.int(5, "Pivot phải")
maxRange = input.int(60, "Range tối đa giữa 2 pivot (nến)")

pl = ta.pivotlow(low, lbL, lbR)
ph = ta.pivothigh(high, lbL, lbR)
var float lastPlPrice = na
var float lastPlRsi = na
var int lastPlBar = na
var float lastPhPrice = na
var float lastPhRsi = na
var int lastPhBar = na
bullDiv = false
bearDiv = false
if not na(pl)
    if not na(lastPlPrice) and low[lbR] < lastPlPrice and rsi[lbR] > lastPlRsi and rsi[lbR] < 45 and (bar_index - lbR - lastPlBar) <= maxRange
        bullDiv := true
    lastPlPrice := low[lbR]
    lastPlRsi := rsi[lbR]
    lastPlBar := bar_index - lbR
if not na(ph)
    if not na(lastPhPrice) and high[lbR] > lastPhPrice and rsi[lbR] < lastPhRsi and rsi[lbR] > 55 and (bar_index - lbR - lastPhBar) <= maxRange
        bearDiv := true
    lastPhPrice := high[lbR]
    lastPhRsi := rsi[lbR]
    lastPhBar := bar_index - lbR
plotshape(bullDiv, "Phân kỳ +", style=shape.labelup, location=location.bottom, color=color.new(#26a69a, 0), text="Phân kỳ +", textcolor=color.white, size=size.small)
plotshape(bearDiv, "Phân kỳ −", style=shape.labeldown, location=location.top, color=color.new(#ef5350, 0), text="Phân kỳ −", textcolor=color.white, size=size.small)

// ——— alertcondition: tạo cảnh báo ngay trong TradingView ———
alertcondition(crossUp and wt1 < osLevel2, title="WT cắt lên trong quá bán", message="WT1 cắt lên WT2 trong vùng quá bán — {{exchange}}:{{ticker}} {{interval}}")
alertcondition(crossDown and wt1 > obLevel2, title="WT cắt xuống trong quá mua", message="WT1 cắt xuống WT2 trong vùng quá mua — {{exchange}}:{{ticker}} {{interval}}")
alertcondition(ta.crossunder(wt1, osLevel1), title="WT vào quá bán sâu (−60)", message="WT1 rơi vào quá bán sâu — {{exchange}}:{{ticker}} {{interval}}")
alertcondition(ta.crossover(wt1, obLevel1), title="WT vào quá mua sâu (+60)", message="WT1 vọt vào quá mua sâu — {{exchange}}:{{ticker}} {{interval}}")
alertcondition(bullDiv, title="Phân kỳ dương RSI", message="Phân kỳ dương RSI (pivot 5/5) — {{exchange}}:{{ticker}} {{interval}}")
alertcondition(bearDiv, title="Phân kỳ âm RSI", message="Phân kỳ âm RSI (pivot 5/5) — {{exchange}}:{{ticker}} {{interval}}")
`;
