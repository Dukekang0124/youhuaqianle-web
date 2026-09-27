# updates/ —— 安卓版第二更新源

这里放的是「又花钱了」安卓包的更新交付物，与网页版站点同仓库、互不打扰：

- `version.json` — 客户端读取的更新清单（`web` / `apk` 两段）
- `youhuaqianle-vX.Y.Z-arm64.apk` — 当前待发的 arm64 release 包

`version.json` 里的 `url` 写的是**裸文件名**，所以客户端会按「清单地址所在目录 + 文件名」拼下载地址：同一份文件挂在任何仓库、任何目录下都能装得上，不必为换托管地址改清单。

## 手机怎么接上

App 内 设置 → 关于与更新 → 备用更新地址，填本目录里 `version.json` 的**直链**（raw 或 Pages 均可，哪个在手机上打得开通哪个）。

## 与 Cloudflare 部署的关系

本目录**不进** Cloudflare Pages（单文件上限 25MB，APK 约 50MB 会让部署失败），已在 `deploy-cloudflare-pages.yml` 里排除，并有一条 `test ! -e dist/updates` 守住。

## 每次发新版要改的两处

1. 替换 APK 与 `version.json`（由 `node tools/gh-publish.mjs --drop` 产出，文件名与 `url` 字段保持裸文件名）
2. 别动 `web` 段以外的键名——客户端只认 `version` / `versionCode` / `md5` / `size` / `url` / `force` / `changelog`
