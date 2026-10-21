# 設備借還系統：獨立 GitHub / 共用 Supabase

## 架構
- 原 GitHub Repository（保養作業）：**完全不修改**。
- 新 GitHub Repository：`equipment-loan-web`，本 ZIP 根目錄的 `index.html` 為入口。
- Supabase：沿用既有 `worktool-web` 專案；只新增 `equipmgr_` 資料表、函式與權限。
- 免登入借還：輸入姓名；管理員登入使用原保養系統的 Supabase Auth 管理員帳號。
- 無 Cloudflare、無 Edge Function、無 Anonymous Sign-ins。

## 安裝順序
1. **備份現有 Supabase 資料**。確認 `public.equipmgr_equipment`、`public.equipmgr_loans` 及 `equipmgr_` 函式不存在。如果已經執行過任何舊版借還 SQL，**不要直接執行**本檔，需先檢查。
2. 先在 SQL Editor 檢查原專案 `public.em__is_admin()` 函式是否存在（本版沿用該管理員驗證函式）。
3. SQL Editor 執行 `supabase/install.sql`。它只新增 `equipmgr_` 物件，遇到同名表或函式會停止，不修改既有五張資料表及其 RLS。
4. GitHub 新建獨立 Repository `equipment-loan-web`，上傳 `index.html`、`app.js`、`style.css`、`config.js`（以及需要的 CSV 範例）。**不要上傳原保養系統程式**。
5. 在 `config.js` 填入既有 Supabase 專案的 Project URL 及 Publishable/anon Key（這是前端可公開的 key；**不得使用 service_role**）。
6. GitHub Settings → Pages → Deploy from a branch → main → /(root)。網頁網址約為 `https://帳號.github.io/equipment-loan-web/`。
7. 管理員登入，建立測試設備 EQ-0001，列印 QR Code，用手機掃描、借出、歸還，確認歷史與逾期。
8. 測試原保養作業網頁功能正常。

## 資安與限制
- 無登入借還是公開 RPC：知道 Supabase URL 和公開金鑰者可能直接呼叫。使用者填寫姓名不能作為身分證明，沒有強制速率限制，不能保證防止惡意操作。建議只在可信任的內部使用環境部署，重要設備應改用身分驗證。
- 設備清單包含借用人姓名，任何能呼叫公開 RPC 的人可能查閱；請勿放入敏感資料。
- 管理員使用原有 `em_admins` 權限，與原保養系統共用 Auth 服務，但兩個 GitHub 網頁獨立。
- `equipmgr_` 資料表啟用 RLS 且撤銷直接存取，公開 RPC 為 SECURITY DEFINER；請先審查權限後上線。
- GitHub Pages 專案更名或網址變更後，已印出的 QR Code 可能需要重新列印。
- 這份程式已完成靜態語法檢查，尚未在你的實際 Supabase 執行端到端測試。

## CSV
欄位 `code,name,model,location,notes`，每批最多 200 筆。
