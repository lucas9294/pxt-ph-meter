# 驗證記錄

日期：2026-10-04。版本：0.3.2。

## 已完成

- 以 Microsoft MakeCode 工具鏈 `pxt-microbit 9.1.1` / `pxt-core 13.0.1` 編譯 extension 及其 `test.ts` 示範。
- 雲端原生 C++ 編譯通過 micro:bit V1（DAL）和 V2（CODAL），並產生 universal HEX；TypeScript 編譯通過。
- 獨立示範專案亦通過 V1／V2 編譯；示範成功轉換為積木，沒有 JavaScript 灰色運算式／陳述式代替積木。
- `tests/run-tests.cjs` 的 **91 項**行為檢查全部通過。測試包含：校準前拒絕 pH、兩點／三點插值、外推、校準點距及溫度驗證、錯誤載入保留有效資料、ADC 上下限、訊號波動、腳位衝突、無探頭、CRC／通訊錯誤狀態、溫度單位、Nernst 補償及範圍檢查。
- 水溫驅動讀取 DS18B20 ROM 家族碼和 CRC、拒絕寄生供電，等待轉換後讀取完整 scratchpad 及 CRC。模擬器明確回報無探頭。

行為測試以模擬 IO 執行，不能替代硬件量測。編譯成功只代表程式可產生，並不證明 1-Wire 實際時序、接線、量測準確度或任何組合的第三方 extension 均已驗證。

## 實機尚待驗證

此工作沒有接上你的 micro:bit、Robotbit、pH 模組或 DS18B20，以下不能聲稱已完成：

1. 確認實物版本及 5V／3.3V 輸出；萬用錶驗證 PO 分壓和 T1 電平轉換。
2. 分別在 V1、V2 讀取至少 100 次 DS18B20，測試你的線長、電平轉換器和供電，記錄 CRC／通訊錯誤率。
3. 比較水溫與參考溫度計；斷開探頭必須回報錯誤，不能沿用舊溫度作補償。
4. 用實際緩衝液做兩點／三點校準，再用另一份已知緩衝液驗證；記錄誤差、重複性和穩定所需時間。
5. 測試重啟後載入校準文字；改動旋鈕或電路後重新校準。
6. 若同時控制馬達、RGB、radio 或 Bluetooth，確認沒有影響 ADC 雜訊及 1-Wire 時序。未測試 Bluetooth／radio 同時使用；短暫中斷遮罩可能影響其他有嚴格時序的功能。

## 重現軟件檢查

將 extension 解壓到本機，使用 Node.js、MakeCode CLI。測試工具使用 TypeScript **5.8.3** 的 transpile API，不能用 TypeScript 7 的不同 API 直接代替。

```text
npm install --no-save typescript@5.8.3
node tests/run-tests.cjs
```

MakeCode 官方工具鏈：

```text
npm install -g pxt
pxt target microbit
pxt install
pxt build --cloud
```

上述命令供開發者重現；一般使用者直接依 README 匯入示範 HEX 或安裝 extension 即可。雲端編譯需要把專案原始碼送至 MakeCode 編譯服務。


0.3.0 新增驗證：七個主要積木、預設／實測模式切換、錯誤參數拒絕量測、預設溫度補償、原始溫度刷新及 CRC 失敗不沿用舊值。

0.3.1：專用腳位選單已通過積木轉換及編譯；示範積木使用 PHAnalogPin.P1 與 PHTemperaturePin.P2，沒有灰色 JavaScript 積木。91 項既有行為檢查通過。

0.3.2：103 項行為檢查通過，包括五個允許的類比腳位、P0 拒絕及 P3/P4/P10 關閉點陣。
