# updates/ —— 安卓版第二更新源

与网页版站点同仓库、互不打扰：

- `version.json` — 客户端读取的更新清单（`web` / `apk` 两段，客户端只用 `apk`）
- `youhuaqianle-v0.13.3-arm64.apk` — 当前待发的 arm64 release 包（50026822 B / md5 fda335c042894dfd67439a3ecadb5da7）

`version.json` 里的 `url` 是**裸文件名**，客户端按「清单所在目录 + 文件名」拼下载地址，
所以同一份文件挂在谁的账号下、叫什么仓库、走 Pages 还是 raw 都能装得上，不必为换托管改清单。

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
2. `node tools/web-deploy.mjs`（把这一对原样铺进本目录，并核对字节数与 MD5）
3. `git -C "<本仓库绝对路径>" add -A && git -C "<…>" commit && git -C "<…>" push -u origin main`

键名别改：客户端只认 `version` / `versionCode` / `md5` / `size` / `url` / `force` / `changelog`。
