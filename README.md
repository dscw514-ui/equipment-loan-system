# 設備借還管理系統（GitHub Pages + Supabase）

## 安裝
1. Supabase 建立新專案，在 SQL Editor 執行 `schema.sql`。
2. Authentication → Providers → Anonymous Sign-ins 開啟匿名登入。注意：此為 Supabase 匿名使用者，仍使用 `authenticated` 資料庫角色。
3. 在 Project Settings → API 取得 Project URL 及 publishable key（舊專案也可使用 anon key），填入 `config.js`。**不要使用 secret/service_role key**。
4. 把 `index.html`、`app.js`、`config.js` 上傳 GitHub 儲存庫根目錄；Settings → Pages → Deploy from a branch → main / (root)。
5. 等候 GitHub Pages 發布，以 HTTPS 開啟網址，輸入姓名、新增設備，再用手機掃描 QR Code 測試。

## CSV 格式
UTF-8 CSV，標題：`設備編碼,設備名稱,型號,存放位置`。範例：
```
設備編碼,設備名稱,型號,存放位置
EQ-0001,絕緣電阻計,MIT420,電氣維護組
EQ-0002,鉤式電流表,CM3289,工具室
```
可從 Excel 另存為 CSV UTF-8。重複設備編碼匯入會跳過並顯示失敗數量。

## 重要限制與安全
- **免登入填姓名**代表無法驗證真實身分。Supabase 背景使用匿名 Auth 工作階段；任何能開啟網站的人都能自行輸入姓名，並可新增設備、借還設備、檢視紀錄。適合低風險、受信任的內部場景，**不適合直接公開用於敏感／高價設備**。
- GitHub Pages 網址通常可公開存取；即使使用者未知道網址，也不能當作存取控制。正式上線應改為企業帳號登入，使用角色權限與 RLS 限制管理操作。
- 資料庫借出／歸還透過帶 row lock 的 PostgreSQL RPC 原子執行，避免同一設備重複借出。資料表不開放直接寫入。
- 本版尚未提供設備編輯、刪除、維修狀態切換、伺服器端分頁、完整稽核軌跡、離線操作、通知及管理員身分權限。
- 借還歷史畫面最多讀取最近 10,000 筆；更大規模應改用伺服器端分頁。
- QR 由第三方 CDN JavaScript 在瀏覽器本地產生；若公司網路封鎖 CDN，請自行託管依賴套件。
- 若開啟匿名登入，建議依 Supabase 文件配置 CAPTCHA、速率限制與成本監控。
