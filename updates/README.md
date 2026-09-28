# updates/ —— 安卓版第二更新源

与网页版站点同仓库、互不打扰：

- `version.json` — 客户端读取的更新清单（`web` / `apk` 两段，客户端只用 `apk`）
- `youhuaqianle-v0.13.9-arm64.apk` — 当前待发的 arm64 release 包（50092386 B / md5 b7994e11685fb37c39583d4beab55549）
- `parts/` — 同一个包的 3 个分块（每块 ≤ 18MB），`version.json` 的 `apk.parts` 逐块记了长度与 SHA-256
  客户端**有清单就走分块**：一次大失败切成几次小失败，坏哪块补哪块，最多重取一块而不是整包 50MB

`version.json` 里的 `url` 是**裸文件名**，客户端按「清单所在目录 + 文件名」拼下载地址，
所以同一份文件挂在谁的账号下、叫什么仓库、走 Pages 还是 raw 都能装得上，不必为换托管改清单。
`apk.parts` 里的块地址是 `parts/<文件名>`，同样按「清单所在目录」解析——**换托管不用重算哈希**。

## 手机怎么接上

App 内 设置 → 关于与更新 → 备用更新地址，填**这个目录本身**、结尾带斜杠，例如：

    https://dukekang0124.github.io/youhuaqianle-web/updates/

⚠️ 不要填 `.../updates/version.json` 这种文件直链：客户端会在你填的地址后面再接一次 `version.json`，
变成 `version.json/version.json` 直接 404。

## 与 Cloudflare 部署的关系

本目录**不进** Cloudflare Pages（单文件上限 25MB，APK 约 50MB 会让部署失败），
已在 `deploy-cloudflare-pages.yml` 里排除，并由 `test ! -e dist/updates` 守住。

## 每次发新版

1. `node tools/gh-publish.mjs --drop`（产出 version.json + APK 到 update-site/github-drop）
2. `node tools/apk-parts.mjs`（把同一个包切成几块，清单写进那份 version.json 的 `apk.parts`）
3. `node tools/web-deploy.mjs`（把整包 + 分块 + 清单原样铺进本目录，逐块核对字节数与 SHA-256）
4. `git -C "<本仓库绝对路径>" add -A && git -C "<…>" commit && git -C "<…>" push -u origin main`

键名别改：客户端只认 `version` / `versionCode` / `md5` / `size` / `url` / `force` / `changelog` / `parts`。
`parts` 缺了不影响升级——客户端会自动退回整包单流下载（同样带 Range 断点续传）。
但清单里的 `size` 与 `apk.size` 对不上、或任何一块的 `size`/`sha256` 与磁盘不符时，
`web-deploy.mjs` 会直接失败：宁可不发分块，也不发一份会拼成坏包的清单。
