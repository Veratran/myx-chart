// The single integrated chart block: ONE Lightweight Charts instance with
// three panes sharing one time axis and crosshair — price candles (top),
// WaveTrend (middle), RSI (bottom). This is the "1 khối" the user asked
// for: no embedded widget, no detached panel.
//
// Each indicator layer can be toggled from the row above the chart:
// volume hides inside the price pane; WaveTrend / RSI remove their series
// entirely so their pane collapses; divergence markers clear off the
// price pane.

import { useEffect, useMemo, useRef } from "react";
import {
CandlestickSeries,
CrosshairMode,
HistogramSeries,
LineSeries,
LineStyle,
createChart,
createSeriesMarkers,
type IChartApi,
type ISeriesApi,
type ISeriesMarkersPluginApi,
type SeriesMarker,
type Time,
} from "lightweight-charts";
import {
computeMmis,
findCrosses,
findDivergences,
rsiSeries,
wavetrend,
type Candle,
} from "./indicators";

export type PriceAlertLine = {
  id: number;
  level: number;
  title: string;
};

/** Which of the indicator layers are drawn on the chart. */
export type IndicatorVisibility = {
  volume: boolean;
  wavetrend: boolean;
  rsi: boolean;
  divergence: boolean;
  mmis: boolean;
};

type Props = {
  candles: Candle[];
  symbol: string;
  alertLines: PriceAlertLine[];
  onPickPrice: (price: number) => void;
  visibility: IndicatorVisibility;
};

const UP = "#26a69a";
const DOWN = "#ef5350";
const WT1_COLOR = "#22d3ee";
const WT2_COLOR = "#f0b90b";
const RSI_COLOR = "#b39ddb";
const AMBER = "#f0b90b";

type SeriesRefs = {
  price?: ISeriesApi<"Candlestick">;
  volume?: ISeriesApi<"Histogram">;
  wt1?: ISeriesApi<"Line">;
  wt2?: ISeriesApi<"Line">;
  wtDiff?: ISeriesApi<"Histogram">;
  rsi?: ISeriesApi<"Line">;
};

type PaneBuilders = {
  addWt: () => void;
  removeWt: () => void;
  addRsi: () => void;
  removeRsi: () => void;
};

export function ChartBlock({
  candles,
  symbol,
  alertLines,
  onPickPrice,
  visibility,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesRefs>({});
  const buildersRef = useRef<PaneBuilders | null>(null);
  const markersRef = useRef<{
    wt?: ISeriesMarkersPluginApi<Time>;
    price?: ISeriesMarkersPluginApi<Time>;
  }>({});
  const fittedRef = useRef(false);
  const pickRef = useRef(onPickPrice);
  pickRef.current = onPickPrice;

  const computed = useMemo(() => {
    const { wt1, wt2 } = wavetrend(candles);
    const rsi = rsiSeries(candles.map((c) => c.close));
    const crosses = findCrosses(wt1, wt2);
    const divs = findDivergences(candles, rsi);
    const mmis = computeMmis(candles);
    return { wt1, wt2, rsi, crosses, divs, mmis };
  }, [candles]);

  // Create the chart once, plus builders that add/remove the WaveTrend
  // and RSI panes on demand (their pane collapses when the last series
  // in it is removed, and is recreated at the right position on re-add).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { color: "#131722" },
        textColor: "#d1d4dc",
        fontSize: 11,
        panes: { separatorColor: "#2a3247", separatorHoverColor: "#363f58" },
      },
      grid: {
        vertLines: { color: "#1e2536" },
        horzLines: { color: "#1e2536" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2a3247" },
      timeScale: {
        borderColor: "#2a3247",
        timeVisible: true,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;

    const price = chart.addSeries(
      CandlestickSeries,
      {
        upColor: UP,
        downColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
      },
      0,
    );
    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: "volume" }, priceScaleId: "" },
      0,
    );
    chart.priceScale("", 0).applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    // No MA/EMA lines are drawn (user removed them 2026-11-15 for a
    // clean chart); EMA20/EMA50 still exist inside computeMmis as math
    // for tactics/FSM, they are just not rendered as series.
    seriesRef.current = { price, volume };

    const addWt = () => {
      const pane = chart.addPane();
      const idx = pane.paneIndex();
      const wt1 = chart.addSeries(
        LineSeries,
        { color: WT1_COLOR, lineWidth: 2, priceLineVisible: false },
        idx,
      );
      const wt2 = chart.addSeries(
        LineSeries,
        { color: WT2_COLOR, lineWidth: 1, priceLineVisible: false },
        idx,
      );
      const wtDiff = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        idx,
      );
      for (const [value, color, style] of [
        [60, "#ef5350", LineStyle.Solid],
        [53, "#ef5350", LineStyle.Dashed],
        [0, "#787b86", LineStyle.Dotted],
        [-53, "#26a69a", LineStyle.Dashed],
        [-60, "#26a69a", LineStyle.Solid],
      ] as const) {
        wt1.createPriceLine({
          price: value,
          color,
          lineWidth: 1,
          lineStyle: style,
          axisLabelVisible: true,
          title: "",
        });
      }
      seriesRef.current.wt1 = wt1;
      seriesRef.current.wt2 = wt2;
      seriesRef.current.wtDiff = wtDiff;
      // WaveTrend always sits directly under the price pane.
      pane.moveTo(1);
    };
    const removeWt = () => {
      const s = seriesRef.current;
      markersRef.current.wt?.detach();
      markersRef.current.wt = undefined;
      if (s.wt1) chart.removeSeries(s.wt1);
      if (s.wt2) chart.removeSeries(s.wt2);
      if (s.wtDiff) chart.removeSeries(s.wtDiff);
      s.wt1 = undefined;
      s.wt2 = undefined;
      s.wtDiff = undefined;
    };
    const addRsi = () => {
      // RSI is always the last pane, so appending is the right spot.
      const pane = chart.addPane();
      const idx = pane.paneIndex();
      const rsi = chart.addSeries(
        LineSeries,
        { color: RSI_COLOR, lineWidth: 2, priceLineVisible: false },
        idx,
      );
      for (const value of [70, 50, 30]) {
        rsi.createPriceLine({
          price: value,
          color: "#787b86",
          lineWidth: 1,
          lineStyle: value === 50 ? LineStyle.Dotted : LineStyle.Dashed,
          axisLabelVisible: true,
          title: "",
        });
      }
      seriesRef.current.rsi = rsi;
    };
    const removeRsi = () => {
      const s = seriesRef.current;
      if (s.rsi) chart.removeSeries(s.rsi);
      s.rsi = undefined;
    };
    buildersRef.current = { addWt, removeWt, addRsi, removeRsi };
    addWt();
    addRsi();

    const panes = chart.panes();
    panes[0]?.setHeight(320);
    panes[1]?.setHeight(130);
    panes[2]?.setHeight(100);

    chart.subscribeClick((param) => {
      if (!param.point) return;
      const p = seriesRef.current.price?.coordinateToPrice(param.point.y);
      if (p != null && Number.isFinite(p)) pickRef.current(p);
    });

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = {};
      buildersRef.current = null;
      markersRef.current = {};
      fittedRef.current = false;
    };
  }, []);

  // Price-axis precision per symbol: MYX trades at 0.04x, so the axis
  // needs 5 decimals (default 2 would label 0.04782 as "0.05"); BTC gets 2.
  useEffect(() => {
    seriesRef.current.price?.applyOptions({
      priceFormat:
        symbol === "BTCUSDT"
          ? { type: "price", precision: 2, minMove: 0.01 }
          : { type: "price", precision: 5, minMove: 0.00001 },
    });
  }, [symbol]);

  // Apply the indicator toggles (declared before the data effect so a
  // re-added pane's series exist before data is pushed into them):
  // WaveTrend / RSI panes are added or removed wholesale; volume just
  // hides inside the price pane.
  useEffect(() => {
    const chart = chartRef.current;
    const b = buildersRef.current;
    if (!chart || !b) return;
    const s = seriesRef.current;
    if (visibility.wavetrend && !s.wt1) b.addWt();
    if (!visibility.wavetrend && s.wt1) b.removeWt();
    if (visibility.rsi && !s.rsi) b.addRsi();
    if (!visibility.rsi && s.rsi) b.removeRsi();
    s.volume?.applyOptions({ visible: visibility.volume });
    const panes = chart.panes();
    panes[0]?.setHeight(320);
    let idx = 1;
    if (visibility.wavetrend) panes[idx++]?.setHeight(130);
    if (visibility.rsi) panes[idx]?.setHeight(100);
  }, [visibility]);

  // Push data whenever candles or computed series change.
  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s.price || !chart || candles.length === 0) return;
    const t = (i: number) => (candles[i]?.time ?? 0) as Time;

    // With MMIS on, candles are recolored by MM tactic like the Pine's
    // barcolor (priority: apex fuchsia, utad maroon, sweep/absorption
    // yellow, markup aqua); all other bars keep the standard colors.
    s.price.setData(
      candles.map((c, i) => {
        const base = {
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        };
        if (!visibility.mmis) return base;
        const color = computed.mmis.barColor[i];
        if (!color) return base;
        return { ...base, color, borderColor: color, wickColor: color };
      }),
    );
    s.volume?.setData(
      candles.map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? "#26a69a55" : "#ef535055",
      })),
    );
    const line = (arr: (number | null)[]) =>
      arr.flatMap((v, i) => (v == null ? [] : [{ time: t(i), value: v }]));
    s.wt1?.setData(line(computed.wt1));
    s.wt2?.setData(line(computed.wt2));
    s.wtDiff?.setData(
      computed.wt1.flatMap((v, i) => {
        const w2 = computed.wt2[i];
        if (v == null || w2 == null) return [];
        const diff = v - w2;
        return [
          {
            time: t(i),
            value: diff,
            color: diff >= 0 ? "#22d3ee44" : "#f2364544",
          },
        ];
      }),
    );
    s.rsi?.setData(line(computed.rsi));

    // WT cross dots on the WT pane (green up / red down, like WT_CROSS_LB).
    if (s.wt1) {
      const markers: SeriesMarker<Time>[] = computed.crosses.flatMap((c) => {
        const v = computed.wt1[c.index];
        if (v == null) return [];
        return [
          {
            time: t(c.index),
            position: "inBar" as const,
            shape: "circle" as const,
            color: c.dir === "up" ? UP : DOWN,
            size: 0.9,
          },
        ];
      });
      markersRef.current.wt?.detach();
      markersRef.current.wt = createSeriesMarkers(s.wt1, markers);
    }

    // Divergence labels on the price pane, at the confirming candle.
    {
      const markers: SeriesMarker<Time>[] = [];
      for (const d of visibility.divergence ? computed.divs : []) {
        const pivotCandle = candles[d.pivotIndex];
        const confirmCandle = candles[d.confirmIndex];
        if (!pivotCandle || !confirmCandle) continue;
        if (d.kind === "bull") {
          markers.push({
            time: pivotCandle.time as Time,
            position: "belowBar",
            shape: "circle",
            color: UP,
            size: 0.7,
          });
          markers.push({
            time: confirmCandle.time as Time,
            position: "belowBar",
            shape: "arrowUp",
            color: UP,
            text: "Phân kỳ +",
            size: 1.1,
          });
        } else {
          markers.push({
            time: pivotCandle.time as Time,
            position: "aboveBar",
            shape: "circle",
            color: DOWN,
            size: 0.7,
          });
          markers.push({
            time: confirmCandle.time as Time,
            position: "aboveBar",
            shape: "arrowDown",
            color: DOWN,
            text: "Phân kỳ −",
            size: 1.1,
          });
        }
      }
      // MMIS markers share the price-pane marker plugin with the classic
      // divergence labels: FSM events (VÀO HÀNG / BÁN ĐỈNH / STOP LOSS),
      // the MM MUA bottom-buy and BẪY ĐỈNH trap markers, and the MMIS
      // RSI-divergence labels at their pivot bars.
      if (visibility.mmis) {
        for (const ev of computed.mmis.events) {
          const c = candles[ev.index];
          if (!c) continue;
          if (ev.kind === "hold_start") {
            markers.push({
              time: c.time as Time,
              position: "belowBar",
              shape: "arrowUp",
              color: "#00e5ff",
              text: "VÀO HÀNG",
              size: 1.1,
            });
          } else if (ev.kind === "mm_buy") {
            markers.push({
              time: c.time as Time,
              position: "belowBar",
              shape: "arrowUp",
              color: "#00e676",
              text: "MM MUA",
              size: 1.1,
            });
          } else if (ev.kind === "apex_sell") {
            markers.push({
              time: c.time as Time,
              position: "aboveBar",
              shape: "arrowDown",
              color: "#ff1744",
              text: "BÁN ĐỈNH",
              size: 1.1,
            });
          } else if (ev.kind === "utad_trap") {
            markers.push({
              time: c.time as Time,
              position: "aboveBar",
              shape: "arrowDown",
              color: "#d50000",
              text: "BẪY ĐỈNH",
              size: 1.1,
            });
          } else {
            markers.push({
              time: c.time as Time,
              position: "aboveBar",
              shape: "arrowDown",
              color: "#ff9100",
              text: "STOP LOSS",
              size: 1.1,
            });
          }
        }
        for (const d of computed.mmis.divs) {
          const pivotCandle = candles[d.pivotIndex];
          if (!pivotCandle) continue;
          markers.push(
            d.kind === "bull"
              ? {
                  time: pivotCandle.time as Time,
                  position: "belowBar",
                  shape: "arrowUp",
                  color: "#2e7d32",
                  text: "Bull",
                  size: 1,
                }
              : {
                  time: pivotCandle.time as Time,
                  position: "aboveBar",
                  shape: "arrowDown",
                  color: "#c62828",
                  text: "Bear",
                  size: 1,
                },
          );
        }
      }
      markers.sort((a, b) => Number(a.time) - Number(b.time));
      markersRef.current.price?.detach();
      markersRef.current.price = createSeriesMarkers(s.price, markers);
    }

    if (!fittedRef.current) {
      chart.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [candles, computed, visibility]);

  // Alert price lines on the price pane (rebuilt when the set changes).
  const linesKey = alertLines.map((l) => `${l.id}:${l.level}`).join("|");
  useEffect(() => {
    const s = seriesRef.current;
    if (!s.price) return;
    const created = alertLines.map((l) =>
      s.price!.createPriceLine({
        price: l.level,
        color: AMBER,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: l.title,
      }),
    );
    return () => {
      for (const line of created) {
        try {
          s.price?.removePriceLine(line);
        } catch {
          // series may already be gone during teardown
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey]);

  return (
    <div
      ref={containerRef}
      aria-label="Chart nến tích hợp WaveTrend và RSI"
      className="h-[62vh] min-h-[430px] w-full overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[#131722] md:h-[560px]"
    />
  );
}
