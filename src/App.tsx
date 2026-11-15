import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { useBitgetRealtime } from "./realtime";
import {
ChartBlock,
type IndicatorVisibility,
type PriceAlertLine,
} from "./ChartBlock";
import {
PINE_SCRIPT,
computeMmis,
mmisPosition,
mmisTactic,
rsiSeries,
wavetrend,
zoneLabel,
type Candle,
} from "./indicators";
import { MMIS_PINE_SCRIPT } from "./mmis-pine";

type Alert = ApiResponse<typeof api, "list_alerts">["alerts"][number];
type Condition = Alert["condition"];
type Symbol = Alert["symbol"];
type Timeframe = Alert["timeframe"];

const SYMBOLS: Symbol[] = ["MYXUSDT", "BTCUSDT"];
const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h", "1d"];

const CONDITIONS: { value: Condition; label: string; needsLevel: boolean }[] = [
  { value: "price_cross_up", label: "Giá cắt lên mức", needsLevel: true },
  { value: "price_cross_down", label: "Giá cắt xuống mức", needsLevel: true },
  {
    value: "wt_cross_up_oversold",
    label: "WT cắt lên trong quá bán (WT1 < −53)",
    needsLevel: false,
  },
  {
    value: "wt_cross_down_overbought",
    label: "WT cắt xuống trong quá mua (WT1 > +53)",
    needsLevel: false,
  },
  { value: "wt_deep_oversold", label: "WT vào quá bán sâu (−60)", needsLevel: false },
  { value: "wt_deep_overbought", label: "WT vào quá mua sâu (+60)", needsLevel: false },
  { value: "rsi_div_bull", label: "Phân kỳ dương RSI", needsLevel: false },
  { value: "rsi_div_bear", label: "Phân kỳ âm RSI", needsLevel: false },
];

const conditionLabel = (c: Condition): string =>
  CONDITIONS.find((x) => x.value === c)?.label ?? c;
const conditionNeedsLevel = (c: Condition): boolean =>
  CONDITIONS.find((x) => x.value === c)?.needsLevel ?? false;

function fmtPrice(symbol: Symbol, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (symbol === "BTCUSDT")
    return v.toLocaleString("vi-VN", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  return v.toFixed(5);
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const selectCls =
  "rounded-md border border-[var(--border)] bg-[#131722] px-2 py-2 text-sm text-[var(--text)]";
const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[#131722] px-2 py-2 font-mono text-sm text-[var(--text)]";

export function App() {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState<Symbol>("MYXUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("4h");
  const [section, setSection] = useState<"alerts" | "pine">("alerts");
  const [visibility, setVisibility] = useState<IndicatorVisibility>({
    volume: true,
    ma: true,
    wavetrend: true,
    rsi: true,
    divergence: true,
    mmis: true,
  });

  // --- alert form state ---
  const [editingId, setEditingId] = useState<number | null>(null);
  const [fSymbol, setFSymbol] = useState<Symbol>("MYXUSDT");
  const [fTimeframe, setFTimeframe] = useState<Timeframe>("4h");
  const [fCondition, setFCondition] = useState<Condition>("price_cross_up");
  const [fLevel, setFLevel] = useState("");
  const [fRepeat, setFRepeat] = useState(false);
  const [fNote, setFNote] = useState("");
  const [pickedHint, setPickedHint] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedMmis, setCopiedMmis] = useState(false);

  const candlesQuery = useQuery({
    queryKey: ["candles", symbol, timeframe],
    queryFn: () => api.get_candles({ symbol, timeframe }),
    refetchInterval: 60_000,
  });
  const candles: Candle[] = useMemo(
    () => candlesQuery.data?.candles ?? [],
    [candlesQuery.data],
  );

  // 4h candles feed the multi-timeframe EMA 30 on the price pane,
  // whatever timeframe is on display (shares the cache when TF = 4h).
  const candles4hQuery = useQuery({
    queryKey: ["candles", symbol, "4h"],
    queryFn: () => api.get_candles({ symbol, timeframe: "4h" }),
    refetchInterval: 60_000,
  });
  const candles4h: Candle[] = useMemo(
    () => candles4hQuery.data?.candles ?? [],
    [candles4hQuery.data],
  );

  const wsStatus = useBitgetRealtime(queryClient, symbol, timeframe);

  const alertsQuery = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.list_alerts({}),
  });
  const alerts: Alert[] = alertsQuery.data?.alerts ?? [];

  const status = useMemo(() => {
    if (candles.length === 0) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    if (!last) return null;
    const { wt1, wt2 } = wavetrend(candles);
    const rsi = rsiSeries(candles.map((c) => c.close));
    const lastVal = (arr: (number | null)[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const v = arr[i];
        if (v != null) return v;
      }
      return null;
    };
    const w1 = lastVal(wt1);
    const change =
      prev && prev.close !== 0
        ? ((last.close - prev.close) / prev.close) * 100
        : null;
    return {
      price: last.close,
      change,
      wt1: w1,
      wt2: lastVal(wt2),
      rsi: lastVal(rsi),
      zone: zoneLabel(w1),
    };
  }, [candles]);

  // MMIS Suite over the displayed candles — drives the HUD below.
  const mmis = useMemo(() => computeMmis(candles), [candles]);
  const mmisLast = useMemo(() => {
    const n = candles.length;
    if (n === 0) return null;
    const i = n - 1;
    return {
      bull: mmis.bullIntent[i] ?? 0,
      bear: mmis.bearIntent[i] ?? 0,
      tactic: mmisTactic(mmis),
      position: mmisPosition(mmis),
    };
  }, [candles, mmis]);

  const alertLines: PriceAlertLine[] = useMemo(
    () =>
      alerts
        .filter(
          (a) =>
            a.active &&
            a.symbol === symbol &&
            a.timeframe === timeframe &&
            a.level != null &&
            (a.condition === "price_cross_up" ||
              a.condition === "price_cross_down"),
        )
        .map((a) => ({
          id: a.id,
          level: a.level as number,
          title: a.note || conditionLabel(a.condition),
        })),
    [alerts, symbol, timeframe],
  );

  const invalidateAlerts = () =>
    queryClient.invalidateQueries({ queryKey: ["alerts"] });

  const createMut = useMutation({
    mutationFn: api.create_alert,
    onSuccess: () => {
      invalidateAlerts();
      resetForm();
    },
  });
  const updateMut = useMutation({
    mutationFn: api.update_alert,
    onSuccess: () => {
      invalidateAlerts();
      resetForm();
    },
  });
  const deleteMut = useMutation({
    mutationFn: api.delete_alert,
    onSuccess: () => {
      invalidateAlerts();
      setConfirmDeleteId(null);
    },
  });

  function resetForm() {
    setEditingId(null);
    setFLevel("");
    setFNote("");
    setFRepeat(false);
    setPickedHint(null);
  }

  function startEdit(a: Alert) {
    setEditingId(a.id);
    setFSymbol(a.symbol);
    setFTimeframe(a.timeframe);
    setFCondition(a.condition);
    setFLevel(a.level != null ? String(a.level) : "");
    setFRepeat(a.repeat);
    setFNote(a.note);
    setPickedHint(null);
    setSection("alerts");
  }

  function submitForm() {
    const needsLevel = conditionNeedsLevel(fCondition);
    const level = needsLevel ? Number(fLevel.replace(",", ".")) : null;
    if (needsLevel && (level == null || !Number.isFinite(level) || level <= 0))
      return;
    if (editingId != null) {
      updateMut.mutate({
        id: editingId,
        symbol: fSymbol,
        timeframe: fTimeframe,
        condition: fCondition,
        level,
        repeat: fRepeat,
        note: fNote,
      });
    } else {
      createMut.mutate({
        symbol: fSymbol,
        timeframe: fTimeframe,
        condition: fCondition,
        level,
        repeat: fRepeat,
        note: fNote,
      });
    }
  }

  function onPickPrice(price: number) {
    const lastClose = status?.price ?? price;
    setFSymbol(symbol);
    setFTimeframe(timeframe);
    setFCondition(price >= lastClose ? "price_cross_up" : "price_cross_down");
    setFLevel(
      symbol === "BTCUSDT" ? price.toFixed(1) : price.toFixed(5),
    );
    setPickedHint(
      `Đã lấy giá ${fmtPrice(symbol, price)} từ chart — kiểm tra điều kiện rồi bấm "${editingId != null ? "Lưu thay đổi" : "Tạo cảnh báo"}".`,
    );
    setSection("alerts");
  }

  async function copyPine() {
    try {
      await navigator.clipboard.writeText(PINE_SCRIPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function downloadPine() {
    const blob = new Blob([PINE_SCRIPT], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "myx-wavetrend-rsi-div.pine";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyMmisPine() {
    try {
      await navigator.clipboard.writeText(MMIS_PINE_SCRIPT);
      setCopiedMmis(true);
      setTimeout(() => setCopiedMmis(false), 2000);
    } catch {
      setCopiedMmis(false);
    }
  }

  function downloadMmisPine() {
    const blob = new Blob([MMIS_PINE_SCRIPT], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "MMIS_HolyGrail_MM_Suite.pine";
    a.click();
    URL.revokeObjectURL(url);
  }

  const formBusy = createMut.isPending || updateMut.isPending;
  const formError =
    (createMut.error as Error | null)?.message ??
    (updateMut.error as Error | null)?.message ??
    null;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <main className="mx-auto max-w-5xl px-3 pb-10 pt-3">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex overflow-hidden rounded-md border border-[var(--border)]"
            role="group"
            aria-label="Chọn mã"
          >
            {SYMBOLS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSymbol(s)}
                aria-pressed={symbol === s}
                className={`px-3 py-2 font-mono text-sm font-semibold ${
                  symbol === s
                    ? "bg-[var(--surface)] text-[var(--accent)]"
                    : "bg-transparent text-[var(--dim)]"
                }`}
              >
                {s.replace("USDT", "/USDT")}
              </button>
            ))}
          </div>
          <div
            className="flex overflow-hidden rounded-md border border-[var(--border)]"
            role="group"
            aria-label="Chọn khung thời gian"
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                aria-pressed={timeframe === tf}
                className={`px-3 py-2 font-mono text-sm ${
                  timeframe === tf
                    ? "bg-[var(--surface)] text-[var(--accent)]"
                    : "bg-transparent text-[var(--dim)]"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          <span className="ml-auto font-mono text-xs text-[var(--dim)]">
            {wsStatus === "live"
              ? "🟢 Realtime · Bitget WS"
              : wsStatus === "connecting"
                ? "🟡 Đang nối WS…"
                : "🔴 WS đứt — đang nối lại"}{" "}
            · GitHub Pages
          </span>
        </div>

        {/* Status strip */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          {status ? (
            <>
              <span className="font-mono text-2xl font-bold">
                {fmtPrice(symbol, status.price)}
              </span>
              {status.change != null && (
                <span
                  className={`font-mono text-sm font-semibold ${
                    status.change >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"
                  }`}
                >
                  {status.change >= 0 ? "+" : ""}
                  {status.change.toFixed(2)}%
                </span>
              )}
              <span className="font-mono text-sm">
                WT1{" "}
                <span className="text-[#22d3ee]">
                  {status.wt1?.toFixed(1) ?? "—"}
                </span>{" "}
                · WT2{" "}
                <span className="text-[#f0b90b]">
                  {status.wt2?.toFixed(1) ?? "—"}
                </span>{" "}
                · RSI{" "}
                <span className="text-[#b39ddb]">
                  {status.rsi?.toFixed(1) ?? "—"}
                </span>
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                  status.zone.includes("sâu")
                    ? "border-[#ef5350] text-[#ef5350]"
                    : status.zone.includes("quá")
                      ? "border-[#f0b90b] text-[#f0b90b]"
                      : "border-[var(--border)] text-[var(--dim)]"
                }`}
              >
                {status.zone}
              </span>
            </>
          ) : (
            <span className="text-sm text-[var(--dim)]">Đang tải nến…</span>
          )}
        </div>

        {/* Indicator toggles */}
        <div
          className="mt-3 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Bật tắt chỉ báo trên chart"
        >
          <span className="text-xs text-[var(--dim)]">Chỉ báo:</span>
          {(
            [
              { key: "volume", label: "Volume" },
              { key: "ma", label: "MA" },
              { key: "wavetrend", label: "WaveTrend" },
              { key: "rsi", label: "RSI" },
              { key: "divergence", label: "Phân kỳ RSI" },
              { key: "mmis", label: "MMIS" },
            ] as { key: keyof IndicatorVisibility; label: string }[]
          ).map(({ key, label }) => {
            const on = visibility[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                aria-label={`${on ? "Tắt" : "Bật"} chỉ báo ${label}`}
                onClick={() =>
                  setVisibility((v) => ({ ...v, [key]: !v[key] }))
                }
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  on
                    ? "border-[var(--accent)] bg-[var(--surface)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--dim)] opacity-60"
                }`}
              >
                {on ? "✓ " : ""}
                {label}
              </button>
            );
          })}
        </div>

        {/* MMIS HUD — mirrors the Suite Pine's top-right table, values
            from the last displayed candle. Hidden with the MMIS layer. */}
        {visibility.mmis && mmisLast && (
          <div
            className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            aria-label="Bảng ý đồ MM (MMIS)"
          >
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="text-sm">
                Động thái MM{" "}
                <span
                  className="font-semibold"
                  style={{ color: mmisLast.tactic.color }}
                >
                  {mmisLast.tactic.label}
                </span>
              </span>
              <span className="text-sm">
                Xác suất MM Gom{" "}
                <span
                  className={`font-mono font-bold ${
                    mmisLast.bull >= 50 ? "text-[#26a69a]" : "text-[var(--dim)]"
                  }`}
                >
                  {mmisLast.bull}%
                </span>
              </span>
              <span className="text-sm">
                Xác suất MM Xả{" "}
                <span
                  className={`font-mono font-bold ${
                    mmisLast.bear >= 50 ? "text-[#ef5350]" : "text-[var(--dim)]"
                  }`}
                >
                  {mmisLast.bear}%
                </span>
              </span>
              <span className="text-sm">
                Trạng thái vị thế{" "}
                <span
                  className="font-semibold"
                  style={{ color: mmisLast.position.color }}
                >
                  {mmisLast.position.label}
                </span>
              </span>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="mt-3">
          {candlesQuery.isPending ? (
            <div className="flex h-[62vh] min-h-[430px] items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[#131722] text-sm text-[var(--dim)]">
              Đang tải chart…
            </div>
          ) : candlesQuery.data && !candlesQuery.data.ok ? (
            <div className="flex h-[62vh] min-h-[430px] flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[#131722] px-4 text-center">
              <p className="text-sm text-[#ef5350]">
                Không tải được nến từ Bitget
                {candlesQuery.data.error
                  ? ` (${candlesQuery.data.error})`
                  : ""}
              </p>
              <button
                type="button"
                onClick={() => candlesQuery.refetch()}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm"
              >
                Thử lại
              </button>
            </div>
          ) : (
            <ChartBlock
              candles={candles}
              candles4h={candles4h}
              symbol={symbol}
              alertLines={alertLines}
              onPickPrice={onPickPrice}
              visibility={visibility}
            />
          )}
          <p className="mt-1.5 text-xs text-[var(--dim)]">
            Một khối chart duy nhất: nến giá + 5 đường MA (EMA 200 vàng ·
            SMA 50 đỏ · EMA 30 hồng tím — đường này lấy từ khung 4h, vẽ bậc
            thang theo nến 4h đã đóng · EMA 9 xanh lá · EMA 5 trắng) ·
            WaveTrend (10/21, dải ±53/±60, chấm cắt xanh/đỏ) · RSI 14 + nhãn
            phân kỳ. Lớp MMIS Suite (bật mặc định): nến tô màu theo động
            thái MM — đỉnh cao trào hồng fuchsia · bẫy đỉnh đỏ maroon · quét
            đáy / kê tường gom vàng · đẩy giá aqua — EMA 20 xanh dương +
            EMA 50 cam, nhãn VÀO HÀNG / MM MUA / BÁN ĐỈNH / BẪY ĐỈNH /
            STOP LOSS / Bull / Bear và bảng động thái MM phía trên chart.
            Bật/tắt từng chỉ báo bằng hàng nút "Chỉ báo" phía trên; chạm
            vào chart để lấy giá đặt cảnh báo.
          </p>
        </div>

        {/* Section switch */}
        <div
          className="mt-4 flex overflow-hidden rounded-md border border-[var(--border)]"
          role="group"
          aria-label="Phần dưới chart"
        >
          <button
            type="button"
            onClick={() => setSection("alerts")}
            aria-pressed={section === "alerts"}
            className={`flex-1 px-3 py-2 text-sm font-semibold ${
              section === "alerts"
                ? "bg-[var(--surface)] text-[var(--accent)]"
                : "text-[var(--dim)]"
            }`}
          >
            Cảnh báo ({alerts.filter((a) => a.active).length} đang bật)
          </button>
          <button
            type="button"
            onClick={() => setSection("pine")}
            aria-pressed={section === "pine"}
            className={`flex-1 px-3 py-2 text-sm font-semibold ${
              section === "pine"
                ? "bg-[var(--surface)] text-[var(--accent)]"
                : "text-[var(--dim)]"
            }`}
          >
            Pine cho TradingView
          </button>
        </div>

        {section === "alerts" && (
          <section aria-label="Cảnh báo" className="mt-3">
            {/* Form */}
            <form
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitForm();
              }}
            >
              <h2 className="text-sm font-semibold">
                {editingId != null ? "Sửa cảnh báo" : "Tạo cảnh báo mới"}
              </h2>
              {pickedHint && (
                <p className="mt-1 text-xs text-[#f0b90b]">{pickedHint}</p>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs text-[var(--dim)]">
                  Mã
                  <select
                    aria-label="Mã của cảnh báo"
                    className={selectCls}
                    value={fSymbol}
                    onChange={(e) => setFSymbol(e.target.value as Symbol)}
                  >
                    {SYMBOLS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--dim)]">
                  Khung
                  <select
                    aria-label="Khung thời gian của cảnh báo"
                    className={selectCls}
                    value={fTimeframe}
                    onChange={(e) => setFTimeframe(e.target.value as Timeframe)}
                  >
                    {TIMEFRAMES.map((tf) => (
                      <option key={tf} value={tf}>
                        {tf}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 flex flex-col gap-1 text-xs text-[var(--dim)]">
                  Điều kiện
                  <select
                    aria-label="Điều kiện cảnh báo"
                    className={selectCls}
                    value={fCondition}
                    onChange={(e) => setFCondition(e.target.value as Condition)}
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                {conditionNeedsLevel(fCondition) && (
                  <label className="flex flex-col gap-1 text-xs text-[var(--dim)]">
                    Mức giá
                    <input
                      aria-label="Mức giá kích hoạt"
                      className={inputCls}
                      inputMode="decimal"
                      placeholder="0.04830"
                      value={fLevel}
                      onChange={(e) => setFLevel(e.target.value)}
                    />
                  </label>
                )}
                <div className="flex flex-col gap-1 text-xs text-[var(--dim)]">
                  Kiểu bắn
                  <div
                    className="flex overflow-hidden rounded-md border border-[var(--border)]"
                    role="group"
                    aria-label="Kiểu bắn cảnh báo"
                  >
                    <button
                      type="button"
                      onClick={() => setFRepeat(false)}
                      aria-pressed={!fRepeat}
                      className={`flex-1 px-2 py-2 text-sm ${
                        !fRepeat
                          ? "bg-[#131722] text-[var(--accent)]"
                          : "text-[var(--dim)]"
                      }`}
                    >
                      Chỉ 1 lần
                    </button>
                    <button
                      type="button"
                      onClick={() => setFRepeat(true)}
                      aria-pressed={fRepeat}
                      className={`flex-1 px-2 py-2 text-sm ${
                        fRepeat
                          ? "bg-[#131722] text-[var(--accent)]"
                          : "text-[var(--dim)]"
                      }`}
                    >
                      Lặp lại
                    </button>
                  </div>
                </div>
                <label className="col-span-2 flex flex-col gap-1 text-xs text-[var(--dim)]">
                  Ghi chú
                  <input
                    aria-label="Ghi chú cảnh báo"
                    className={inputCls}
                    placeholder="VD: xuyên kháng cự 0,0483 thì cân nhắc…"
                    value={fNote}
                    onChange={(e) => setFNote(e.target.value)}
                  />
                </label>
              </div>
              {formError && (
                <p className="mt-2 text-xs text-[#ef5350]">{formError}</p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="submit"
                  disabled={formBusy}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#131722] disabled:opacity-50"
                >
                  {editingId != null ? "Lưu thay đổi" : "Tạo cảnh báo"}
                </button>
                {editingId != null && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
                  >
                    Huỷ sửa
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-[var(--dim)]">
                Bản GitHub: cảnh báo chỉ lưu trong trình duyệt này (để vẽ
                đường giá trên chart), không gửi Telegram. Cảnh báo Telegram
                vẫn do Space và các hook MYX lo như cũ.
              </p>
            </form>

            {/* List */}
            <div className="mt-3 flex flex-col gap-2">
              {alertsQuery.isPending ? (
                <p className="text-sm text-[var(--dim)]">Đang tải cảnh báo…</p>
              ) : alerts.length === 0 ? (
                <p className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--dim)]">
                  Chưa có cảnh báo nào. Tạo cảnh báo đầu tiên ở form trên,
                  hoặc chạm vào chart để lấy giá.
                </p>
              ) : (
                alerts.map((a) => (
                  <article
                    key={a.id}
                    className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 ${
                      a.active ? "" : "opacity-55"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold">
                        {a.symbol.replace("USDT", "/USDT")} · {a.timeframe}
                      </span>
                      <span className="text-sm">{conditionLabel(a.condition)}</span>
                      {a.level != null && (
                        <span className="font-mono text-sm text-[#f0b90b]">
                          {fmtPrice(a.symbol, a.level)}
                        </span>
                      )}
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--dim)]">
                        {a.repeat ? "Lặp lại" : "Chỉ 1 lần"}
                      </span>
                      {a.fired_count > 0 && (
                        <span className="rounded-full border border-[#f0b90b] px-2 py-0.5 text-xs text-[#f0b90b]">
                          Đã bắn {a.fired_count} lần · gần nhất{" "}
                          {fmtTime(a.last_fired_at)}
                        </span>
                      )}
                    </div>
                    {a.note && (
                      <p className="mt-1 text-sm text-[var(--dim)]">{a.note}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateMut.mutate({ id: a.id, active: !a.active })
                        }
                        aria-label={`${a.active ? "Tắt" : "Bật"} cảnh báo ${a.id}`}
                        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
                      >
                        {a.active ? "Đang bật — bấm để tắt" : "Đang tắt — bấm để bật"}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        aria-label={`Sửa cảnh báo ${a.id}`}
                        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
                      >
                        Sửa
                      </button>
                      {confirmDeleteId === a.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => deleteMut.mutate({ id: a.id })}
                            aria-label={`Xác nhận xoá cảnh báo ${a.id}`}
                            className="rounded-md border border-[#ef5350] px-3 py-1.5 text-xs font-semibold text-[#ef5350]"
                          >
                            Xoá thật?
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
                          >
                            Thôi
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(a.id)}
                          aria-label={`Xoá cảnh báo ${a.id}`}
                          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[#ef5350]"
                        >
                          Xoá
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        )}

        {section === "pine" && (
          <section aria-label="Pine Script cho TradingView" className="mt-3">
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
              <h2 className="text-sm font-semibold">
                File Pine cho TradingView thật
              </h2>
              <p className="mt-1 text-sm text-[var(--dim)]">
                WaveTrend Crosses [LazyBear] thông số Woodfield (10/21,
                ±53/±60) + phân kỳ RSI pivot 5/5, đã khai sẵn{" "}
                <span className="font-mono">alertcondition</span> cho 6 điều
                kiện. Dán vào Pine Editor trên TradingView (mở chart
                BITGET:MYXUSDT → Pine Editor → dán → "Add to chart"), hoặc
                tải file .pine về máy.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={copyPine}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#131722]"
                >
                  {copied ? "Đã copy ✓" : "Copy Pine"}
                </button>
                <button
                  type="button"
                  onClick={downloadPine}
                  className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
                >
                  Tải file .pine
                </button>
              </div>
              <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre rounded-md border border-[var(--border)] bg-[#131722] p-3 font-mono text-[11px] leading-relaxed text-[var(--text)]">
                {PINE_SCRIPT}
              </pre>
            </div>

            <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
              <h2 className="text-sm font-semibold">
                MMIS Holy Grail Suite (PRO) — Pine cho TradingView
                (BITGET:MYXUSDT)
              </h2>
              <p className="mt-1 text-sm text-[var(--dim)]">
                Nguyên văn file MMIS_HolyGrail_MM_Suite.pine sếp gửi: bản
                Suite/PRO của "Market Maker Intent &amp; Holy Grail" — bộ
                phân loại 8 động thái MM (quét đáy, kê tường gom, test cạn
                cung, đẩy giá, rung lắc, đỉnh cao trào, bẫy UTAD, buông xả
                dao rơi), máy trạng thái chốt giữ vị thế, tín hiệu MM MUA /
                VÀO HÀNG và bảng HUD ý đồ thời gian thực — chính là lớp
                MMIS đang chạy trên chart phía trên. Dán vào Pine Editor
                trên TradingView với chart BITGET:MYXUSDT, hoặc tải file
                .pine về máy.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={copyMmisPine}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#131722]"
                >
                  {copiedMmis ? "Đã copy ✓" : "Copy Pine MMIS"}
                </button>
                <button
                  type="button"
                  onClick={downloadMmisPine}
                  className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
                >
                  Tải file .pine
                </button>
              </div>
              <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre rounded-md border border-[var(--border)] bg-[#131722] p-3 font-mono text-[11px] leading-relaxed text-[var(--text)]">
                {MMIS_PINE_SCRIPT}
              </pre>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
