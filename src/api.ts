// Static (GitHub Pages) replacement for the Space server actions.
//
// - get_candles: fetches Bitget Spot klines DIRECTLY from the browser.
//   Bitget's public REST sends `access-control-allow-origin: *` (verified
//   2026-11-15), so no server proxy is needed.
// - Alerts: the Space version persisted alerts in a DB and mirrored them
//   to a Telegram hook. A static page has no server, so alerts here are
//   stored in this browser's localStorage and only draw price lines on
//   the chart. Telegram alerting stays with the Space + MYX hooks.

import type { Candle } from "./indicators";

export type SymbolT = "MYXUSDT" | "BTCUSDT";
export type TimeframeT = "15m" | "1h" | "4h" | "1d";
export type ConditionT =
  | "price_cross_up"
  | "price_cross_down"
  | "wt_cross_up_oversold"
  | "wt_cross_down_overbought"
  | "wt_deep_oversold"
  | "wt_deep_overbought"
  | "rsi_div_bull"
  | "rsi_div_bear";

export interface AlertItem {
  id: number;
  symbol: SymbolT;
  timeframe: TimeframeT;
  condition: ConditionT;
  level: number | null;
  repeat: boolean;
  note: string;
  active: boolean;
  fired_count: number;
  created_at: string;
  last_fired_at: string | null;
}

export interface CandlesResponse {
  ok: boolean;
  error: string | null;
  candles: Candle[];
}

const BITGET_GRANULARITY: Record<string, string> = {
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
};

async function get_candles(args: {
  symbol: SymbolT;
  timeframe: TimeframeT;
}): Promise<CandlesResponse> {
  try {
    const granularity = BITGET_GRANULARITY[args.timeframe] ?? args.timeframe;
    const url = `https://api.bitget.com/api/v2/spot/market/candles?symbol=${args.symbol}&granularity=${granularity}&limit=500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bitget HTTP ${res.status}`);
    const body = (await res.json()) as {
      code?: string;
      msg?: string;
      data?: unknown[][];
    };
    if (body.code !== "00000") {
      throw new Error(
        `Bitget lỗi ${body.code ?? "?"}${body.msg ? `: ${body.msg}` : ""}`,
      );
    }
    const candles: Candle[] = [];
    for (const k of body.data ?? []) {
      // Row: [ts_ms, open, high, low, close, baseVolume, quoteVolume, quoteVolume]
      const openTime = Number(k[0]);
      const open = Number(k[1]);
      const high = Number(k[2]);
      const low = Number(k[3]);
      const close = Number(k[4]);
      const volume = Number(k[5]);
      if (
        Number.isFinite(openTime) &&
        Number.isFinite(open) &&
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        Number.isFinite(close)
      ) {
        candles.push({
          time: Math.floor(openTime / 1000),
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) ? volume : 0,
        });
      }
    }
    candles.sort((a, b) => a.time - b.time);
    return { ok: true, error: null, candles };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Không tải được nến từ Bitget",
      candles: [],
    };
  }
}

// --- Alerts in localStorage -------------------------------------------------

const ALERTS_KEY = "myx-chart-alerts-v1";

function loadAlerts(): AlertItem[] {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AlertItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAlerts(alerts: AlertItem[]): void {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  } catch {
    // Storage full/blocked: the in-memory list still works for this session.
  }
}

async function list_alerts(_args: Record<string, never>): Promise<{
  alerts: AlertItem[];
}> {
  return { alerts: loadAlerts().slice().sort((a, b) => b.id - a.id) };
}

async function create_alert(args: {
  symbol: SymbolT;
  timeframe: TimeframeT;
  condition: ConditionT;
  level: number | null;
  repeat: boolean;
  note: string;
}): Promise<{ alert: AlertItem }> {
  const needsLevel =
    args.condition === "price_cross_up" || args.condition === "price_cross_down";
  if (needsLevel && (args.level == null || args.level <= 0)) {
    throw new Error("Điều kiện giá cần một mức giá hợp lệ");
  }
  const alerts = loadAlerts();
  const alert: AlertItem = {
    id: alerts.reduce((m, a) => Math.max(m, a.id), 0) + 1,
    symbol: args.symbol,
    timeframe: args.timeframe,
    condition: args.condition,
    level: needsLevel ? args.level : null,
    repeat: args.repeat,
    note: (args.note ?? "").trim(),
    active: true,
    fired_count: 0,
    created_at: new Date().toISOString(),
    last_fired_at: null,
  };
  alerts.push(alert);
  saveAlerts(alerts);
  return { alert };
}

async function update_alert(args: {
  id: number;
  symbol?: SymbolT;
  timeframe?: TimeframeT;
  condition?: ConditionT;
  level?: number | null;
  repeat?: boolean;
  note?: string;
  active?: boolean;
}): Promise<{ alert: AlertItem }> {
  const alerts = loadAlerts();
  const idx = alerts.findIndex((a) => a.id === args.id);
  if (idx < 0) throw new Error("Không tìm thấy cảnh báo");
  const cur = alerts[idx]!;
  const next: AlertItem = {
    ...cur,
    ...(args.symbol !== undefined ? { symbol: args.symbol } : {}),
    ...(args.timeframe !== undefined ? { timeframe: args.timeframe } : {}),
    ...(args.condition !== undefined ? { condition: args.condition } : {}),
    ...(args.level !== undefined ? { level: args.level } : {}),
    ...(args.repeat !== undefined ? { repeat: args.repeat } : {}),
    ...(args.note !== undefined ? { note: args.note.trim() } : {}),
    ...(args.active !== undefined ? { active: args.active } : {}),
  };
  alerts[idx] = next;
  saveAlerts(alerts);
  return { alert: next };
}

async function delete_alert(args: { id: number }): Promise<{ ok: boolean }> {
  saveAlerts(loadAlerts().filter((a) => a.id !== args.id));
  return { ok: true };
}

export const api = {
  get_candles,
  list_alerts,
  create_alert,
  update_alert,
  delete_alert,
};

// Mirrors the SDK's ApiResponse helper: ApiResponse<typeof api, "list_alerts">
// resolves to that action's resolved return type.
export type ApiResponse<
  T extends Record<string, (...args: never[]) => unknown>,
  K extends keyof T,
> = Awaited<ReturnType<T[K]>>;
