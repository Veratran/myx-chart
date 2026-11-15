# Chart MYX — Realtime Bitget

Bản GitHub Pages của Space "Chart MYX — Chỉ báo & Cảnh báo": một khối chart
duy nhất (nến giá + MA + WaveTrend + RSI/phân kỳ + MMIS Suite), chạy hoàn
toàn trong trình duyệt.

- **Trang live:** https://veratran.github.io/myx-chart/
- **Lịch sử nến:** lấy trực tiếp từ REST công khai của Bitget
  (`api.bitget.com`, CORS `*`) — 500 nến, khung 15m / 1h / 4h / 1d, cặp
  MYX/USDT và BTC/USDT.
- **Realtime:** WebSocket công khai của Bitget
  (`wss://ws.bitget.com/v2/ws/public`) — kênh nến theo khung đang xem +
  nến 4h + ticker; giá và nến cập nhật theo từng tin đẩy, REST chỉ còn là
  nhịp dự phòng 60 giây. Tự nối lại khi đứt.
- **Chỉ báo:** giữ nguyên công thức của bản Space — WaveTrend Woodfield/
  LazyBear 10/21 (dải ±53/±60, chấm cắt), RSI 14 + phân kỳ pivot 5/5,
  5 đường MA (EMA 30 lấy từ nến 4h đã đóng), MMIS Suite (động thái MM,
  HUD Bull/Bear, MVRV, nhãn VÀO HÀNG / MM MUA / BÁN ĐỈNH…), kèm 2 khối
  Pine để copy sang TradingView.

## Khác bản Space ở đâu

GitHub Pages chỉ chạy web tĩnh, không có server:

- Cảnh báo trong trang này **chỉ lưu ở trình duyệt** (localStorage) để vẽ
  đường giá trên chart — không gửi Telegram. Cảnh báo Telegram vẫn do
  Space và các hook MYX phụ trách như cũ.

## Phát triển

```sh
bun install
bun run build   # xuất bản tĩnh vào dist/
```

Deploy: mỗi lần push lên `main`, workflow
`.github/workflows/pages.yml` tự build và đăng lên GitHub Pages.
