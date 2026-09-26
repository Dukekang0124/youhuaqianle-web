# 又花钱了 · 网页版

一句话记账的浏览器版本：说或打「今天打车 32 块」，本地拆出金额、分类、商户，确认后入账。

- **没有服务端、没有账户**：账本只存在你自己浏览器的 `localStorage` 里，换设备/换浏览器不会同步。
- **不请求任何外部地址**：页面不加载第三方 CDN、不埋点、不发统计请求；除你主动点「语音」时浏览器自己的识别服务外，没有网络出口。
- **备份要自己导**：浏览器清缓存 = 账本一起没。今日页在距上次导出 ≥7 天时会提醒你导出或复制一份。
- 与安卓版（APK）互不相通，靠「导出 JSON / 导入」互通。

线上地址：
- Cloudflare Pages：https://youhuaqianle.pages.dev/
- GitHub Pages：https://dukekang0124.github.io/youhuaqianle-web/

本仓库的根目录就是站点根目录，推 `main` 后 GitHub Pages 自动部署，`.github/workflows/deploy-cloudflare-pages.yml` 同步推 Cloudflare Pages，`healthcheck.yml` 每 6 小时回读两个地址确认线上就是这一版。

源码真源在作者的知识库工程里（含与安卓版逐字比对的一致性闸门），本仓库是它导出的可部署副本。
