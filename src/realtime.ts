// Realtime Bitget feed for the static GitHub Pages build.
//
// Connects the browser straight to Bitget's public WebSocket
// (wss://ws.bitget.com/v2/ws/public — the same endpoint the myx-ws-watch
// service uses server-side) and merges live candle/ticker updates into
// the react-query candle cache, so the chart, status strip and every
// indicator recompute on each push instead of the old 15s REST poll.
// REST remains as a 60s fallback refetch in App.tsx.

import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Candle } from "./indicators";
import type { CandlesResponse } from "./api";

export type WsStatus = "connecting" | "live" | "down";

const CHANNEL_BY_TF: Record<string, string> = {
  "15m": "candle15m",
  "1h": "candle1H",
  "4h": "candle4H",
  "1d": "candle1D",
};
const TF_BY_CHANNEL: Record<string, string> = Object.fromEntries(
  Object.entries(CHANNEL_BY_TF).map(([tf, ch]) => [ch, tf]),
);

function mergeCandleRows(
  old: CandlesResponse | undefined,
  rows: unknown[][],
): CandlesResponse | undefined {
  if (!old) old = { ok: true, error: null, candles: [] };
  // A subscribe snapshot carries up to 500 historical rows; an update
  // carries just the live candle. Merge by time in one cache write.
  const byTime = new Map<number, Candle>(
    old.candles.map((c) => [c.time, c]),
  );
  let changed = false;
  for (const row of rows) {
    const time = Math.floor(Number(row[0]) / 1000);
    const candle: Candle = {
      time,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]) || 0,
    };
    if (!Number.isFinite(candle.time) || !Number.isFinite(candle.close))
      continue;
    byTime.set(candle.time, candle);
    changed = true;
  }
  if (!changed) return old;
  const candles = Array.from(byTime.values())
    .sort((a, b) => a.time - b.time)
    .slice(-500);
  return { ...old, ok: true, error: null, candles };
}

function mergeTickerPrice(
  old: CandlesResponse | undefined,
  price: number,
): CandlesResponse | undefined {
  if (!old || old.candles.length === 0 || !Number.isFinite(price)) return old;
  const candles = old.candles.slice();
  const last = candles[candles.length - 1]!;
  candles[candles.length - 1] = {
    ...last,
    close: price,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
  };
  return { ...old, candles };
}

export function useBitgetRealtime(
  queryClient: QueryClient,
  symbol: string,
  timeframe: string,
): WsStatus {
  const [status, setStatus] = useState<WsStatus>("connecting");

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let pingTimer: number | undefined;
    let retryTimer: number | undefined;
    let retry = 0;

    // Displayed timeframe + always 4h (feeds the MTF EMA 30 pane overlay).
    const channels = Array.from(
      new Set([CHANNEL_BY_TF[timeframe] ?? "candle4H", "candle4H"]),
    );

    function connect() {
      if (closed) return;
      setStatus("connecting");
      ws = new WebSocket("wss://ws.bitget.com/v2/ws/public");
      ws.onopen = () => {
        retry = 0;
        setStatus("live");
        ws?.send(
          JSON.stringify({
            op: "subscribe",
            args: [
              ...channels.map((channel) => ({
                instType: "SPOT",
                channel,
                instId: symbol,
              })),
              { instType: "SPOT", channel: "ticker", instId: symbol },
            ],
          }),
        );
        pingTimer = window.setInterval(() => {
          try {
            ws?.send("ping");
          } catch {
            // socket already closing; onclose handles reconnect
          }
        }, 25_000);
      };
      ws.onmessage = (ev) => {
        if (ev.data === "pong") return;
        try {
          const j = JSON.parse(ev.data as string) as {
            arg?: { channel?: string };
            data?: unknown;
          };
          const ch = j.arg?.channel;
          if (!ch || !Array.isArray(j.data)) return;
          if (ch === "ticker") {
            for (const d of j.data as { lastPr?: string }[]) {
              const price = Number(d?.lastPr);
              for (const tf of [timeframe, "4h"]) {
                queryClient.setQueryData<CandlesResponse>(
                  ["candles", symbol, tf],
                  (old) => mergeTickerPrice(old, price),
                );
              }
            }
            return;
          }
          const tf = TF_BY_CHANNEL[ch];
          if (!tf) return;
          queryClient.setQueryData<CandlesResponse>(
            ["candles", symbol, tf],
            (old) => mergeCandleRows(old, j.data as unknown[][]),
          );
        } catch {
          // Malformed push: ignore, REST fallback keeps the chart fresh.
        }
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          // already closed
        }
      };
      ws.onclose = () => {
        if (pingTimer) window.clearInterval(pingTimer);
        if (closed) return;
        setStatus("down");
        retry = Math.min(retry + 1, 6);
        retryTimer = window.setTimeout(
          connect,
          Math.min(1000 * 2 ** retry, 30_000),
        );
      };
    }

    connect();
    return () => {
      closed = true;
      if (pingTimer) window.clearInterval(pingTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
      try {
        ws?.close();
      } catch {
        // already closed
      }
    };
  }, [queryClient, symbol, timeframe]);

  return status;
}
