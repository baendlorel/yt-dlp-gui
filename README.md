# BiliFlow · yt-dlp 批量下载工作台

面向 **哔哩哔哩** 的批量下载 GUI：Fastify 后端 + Vue 3 前端，下载引擎使用本地 `yt-dlp`。
B 站只是第一个站点适配器，后续站点可以通过新增 Provider 接入，队列 / 批量 / 进度 / 持久化 / 前端都不需要改。

> `yt-dlp/` 目录已被 `.gitignore` 忽略，作为本机的下载引擎存在；升级 yt-dlp 时直接替换该目录即可。

---

## 功能

- **批量提交**：一次粘贴多行链接，自动去重、逐个解析、建任务
- **批量预览**：先解析、勾选想要的单集，再入队（适合合集 / 收藏夹）
- **B 站链接全覆盖**：BV/av、`b23.tv` 短链、番剧 `ep/ss`、课程、收藏夹、UP 主合集 / 系列、直播
- **分 P / 合集展开**：自动拆成独立任务，并用 B 站 view 接口补全分 P 标题、UP 主、时长、封面
- **画质 / 编码**：最高、4K、2K、1080P、720P、480P、360P、仅音频；H.264 / HEVC / AV1 偏好
- **附加产物**：CC / AI 字幕、弹幕 XML、封面、`.info.json` 元数据（可选）
- **登录态**：主界面 Cookie（任意站点，本次批次有效）或设置页长期 B 站 Cookie；B 站需至少含 `SESSDATA`
- **下载队列**：并发上限、单任务取消、失败重试、批次取消 / 重试、清空记录
- **实时进度**：SSE 推送，显示百分比、速度、剩余时间、DASH 分段（第几段）
- **本机持久化**：任务与设置写入 `data/state.json`，重启后保留历史；未完成任务标记为中断
- **通用兜底**：任何 yt-dlp 支持的站点（YouTube 等）走 Generic Provider，无需适配即可下载

---

## 快速开始

### 1. 环境要求

| 依赖 | 说明 |
| --- | --- |
| Node.js ≥ 20.19 | 服务端与构建 |
| pnpm | 包管理器（`npm i -g pnpm`） |
| yt-dlp 引擎 | 二选一：① `yt-dlp/` 源码 + Python 3.10+；② `yt-dlp.exe` |
| ffmpeg | B 站高清为 DASH 音视频分离流，合并必需 |

本仓库自带 `yt-dlp/` 源码。Python 未加入 PATH 时，在 `.env` 中指定：

```ini
YTDLP_PYTHON=C:\Python312\python.exe
```

也可以直接使用 yt-dlp 官方可执行文件：

```ini
YTDLP_PATH=D:\tools\yt-dlp.exe
```

ffmpeg 的查找顺序：**设置页填写 → `.env` 的 `FFMPEG_PATH` → `tools/ffmpeg/bin/ffmpeg.exe` → PATH**。
Windows 可直接把 `ffmpeg.exe` 放进 `tools/ffmpeg/bin/`（该目录已被忽略）。

### 2. 安装与启动

```bash
pnpm install
cp .env.example .env   # Windows: copy .env.example .env
pnpm setup:check       # 检查 yt-dlp / Python / ffmpeg

# 开发（后端 8787 + Vite 热更新 5173）
pnpm dev

# 生产（构建前端，由后端托管）
pnpm build
pnpm start
```

打开：

- 开发：<http://127.0.0.1:5173>
- 生产：<http://127.0.0.1:8787>

默认只监听 `127.0.0.1`。需要局域网访问时在 `.env` 设置 `HOST=0.0.0.0`（注意：接口没有鉴权）。

---

## 使用说明

1. 在输入框粘贴链接，每行一个；`Ctrl/⌘ + Enter` 可直接提交
2. 选择画质 / 编码 / 是否展开合集，按需勾选字幕、封面、元数据
3. **加入队列**：立即建批次，后台解析后逐个入队
4. **预览并挑选**：先看解析结果，勾选单集再下载
5. 任务卡片上可取消、重试、打开所在文件夹；批次头部可取消整批、重试失败项

任务文件默认保存到：

```
downloads/
└─ bilibili/
   └─ 标题 [BV1xxxxxxxxx].mp4
```

可在设置中关闭「按平台分文件夹」，或改为任意绝对路径。

### 主界面 Cookie（可选）

链接输入框下方有 **「Cookie（可选）」**，适用于本次提交的所有站点：

- 下载 B 站时可留空，回退到设置页保存的长期 Cookie；
- 也可以直接填浏览器导出的 Netscape `cookies.txt` 路径，例如 `D:\downloads\cookie.txt`；
- 下载其它站点时粘贴该站点的 Cookie，通过 `--add-header Cookie:` 传给 yt-dlp；
- B 站的批次 Cookie 会写入 `data/batch-cookies/<批次>.txt`，删除批次或清空已完成时清理；
- 不写入 `data/state.json`，也不写入 localStorage；
- 不同站点的 Cookie 请分开提交，避免把 A 站 Cookie 发给 B 站。

### 关于登录（可选，长期保存）

登录 B 站 → 开发者工具 → Network → 任意请求 → 请求头 `Cookie`，整段复制粘贴到设置页即可（只填 `SESSDATA` 的值也支持）。
后端会把它写成 Netscape 格式的 `data/cookies.txt`（域为 `.bilibili.com`），通过 `--cookies` 传给 yt-dlp，这样
`www.bilibili.com` 和 `api.bilibili.com` 都能带上登录态。

B 站 CC / AI 字幕需要登录 Cookie；勾选「字幕」后会下载 `zh-Hans`（中文）、`ai-zh`（中文 AI）和 `en-US`（英文）等可用轨，
生成与视频同名的 `.srt` 文件。视频本身没有字幕轨时不会生成文件；弹幕需要单独勾选「弹幕」，生成 `.danmaku.xml`。

它用于 1080P+ / 4K、大会员、私享收藏夹、CC / AI 字幕等。**Cookie 明文保存在 `data/state.json` 与
`data/cookies.txt`，不要提交或分享这些文件；清除登录信息会同时删除 cookies.txt。**

---

## 项目结构

```
├─ server/                     Fastify 后端（TypeScript）
│  └─ src/
│     ├─ index.ts              启动、优雅退出
│     ├─ app.ts                路由注册、静态托管、错误处理
│     ├─ config.ts             环境变量与路径
│     ├─ types.ts              任务 / 批次 / 设置 / 选项模型
│     ├─ lib/
│     │  ├─ engine.ts          yt-dlp / python / ffmpeg 探测
│     │  ├─ ytdlp.ts           进程执行、逐行输出、进程树终止
│     │  ├─ queue.ts           并发队列（AbortController）
│     │  ├─ store.ts           状态持久化 + 重启恢复
│     │  ├─ events.ts          SSE 广播
│     │  └─ util.ts
│     ├─ providers/
│     │  ├─ types.ts           Provider 接口
│     │  ├─ ytdlpProvider.ts   yt-dlp 通用基类（解析/参数/进度/报错）
│     │  ├─ bilibili.ts        B 站适配器（URL、鉴权、清晰度、元数据补全）
│     │  ├─ registry.ts        注册与匹配（generic 兜底）
│     │  └─ ...
│     ├─ services/
│     │  └─ downloadService.ts 批次解析、任务执行、进度解析、取消/重试
│     └─ routes/               system / batches / tasks
├─ web/                        Vue 3 + Vite 前端
│  └─ src/
│     ├─ App.vue / style.css   布局与设计系统
│     ├─ store.ts              SSE 客户端 + 状态
│     ├─ api.ts / types.ts
│     └─ components/           Composer / BatchCard / TaskRow / PreviewModal / SettingsModal …
├─ scripts/doctor.mjs          环境自检
├─ yt-dlp/                     下载引擎源码（gitignored）
├─ tools/                      ffmpeg 等本地二进制（gitignored）
├─ downloads/                  下载产物（gitignored）
└─ data/                       任务状态（gitignored）
```

---

## B 站逻辑：从 yt-dlp 里“抽”了什么

真正的取流（WBI 签名、DASH 解析、字幕接口）仍由 yt-dlp 完成，避免在 Node 里重写一套易碎的 B 站协议。
本项目抽取并产品化的是**站点规则与交互层**：

| 能力 | yt-dlp 原实现 | 本项目位置 |
| --- | --- | --- |
| 链接识别 | `yt_dlp/extractor/bilibili.py` 的 `_VALID_URL` | `providers/bilibili.ts` → `match` / `normalize` |
| `b23.tv` 短链 | GenericIE 跟随跳转 | `resolveShortLink`（先跟随 302 拿最终地址） |
| 追踪参数清理 | — | `normalize` 只保留 `p/bvid/fid/sid…` |
| 清晰度档位 | `extract_formats` / `support_formats` 的 qn | `formatArgs` 按 `height` + `vcodec` 过滤，交给 yt-dlp 选流 |
| 登录态 | `is_logged_in`（SESSDATA） | 主界面 Cookie（批次）/ `settings.cookie` → `--cookies` / `--add-header` |
| 分 P / 合集 | `BiliBiliIE` 的 playlist 结构 | `expand` + `x/web-interface/view` 补全分 P 标题（每个稿件一次请求） |
| 字幕 | `_get_subtitles` 的 `zh-CN/ai-zh` | `--write-subs --sub-langs zh-CN,zh-Hans,zh,ai-zh,en` |
| 弹幕 | `_get_subtitles` 的 `danmaku` XML | `--write-subs --sub-langs danmaku`（无需登录） |
| 音视频合并 | yt-dlp + ffmpeg | `--merge-output-format mp4` + `--ffmpeg-location` |

> 设计取舍：不在 Node 中重写 B 站取流。B 站接口（WBI 签名、412 风控、DASH）变化频繁，交给持续维护的 yt-dlp 更稳；站点差异集中在 Provider 内。

---

## 扩展新站点

### 方案 A：零适配（推荐先试）

yt-dlp 已支持的站点会由 `GenericProvider` 兜底，直接粘贴链接即可。只有需要**站点特有的 URL 规则、鉴权头、清晰度映射、附加产物**时才写 Provider。

### 方案 B：新增 Provider

1. 新建 `server/src/providers/example.ts`：

```ts
import { YtDlpProvider } from './ytdlpProvider.js';
import type { DownloadOptions, MediaItem } from '../types.js';
import type { ProviderContext } from './types.js';

export class ExampleProvider extends YtDlpProvider {
  id = 'example';
  label = '示例站点';
  description = '站点说明';
  priority = 50; // 越小越先匹配；generic 是 1000

  match(url: string): boolean {
    return /example\.com/i.test(url);
  }

  async normalize(url: string): Promise<string> {
    return url.trim().replace('http://', 'https://');
  }

  // 可选：站点要求的请求头 / Cookie
  protected extraDownloadArgs(
    _item: MediaItem,
    _options: DownloadOptions,
    _ctx: ProviderContext,
  ): string[] {
    return ['--add-header', 'Referer:https://example.com/'];
  }
}
```

2. 在 `providers/registry.ts` 注册：

```ts
return new ProviderRegistry([new BilibiliProvider(), new ExampleProvider(), new GenericProvider()]);
```

3. 需要站点专属选项时，在 `types.ts` 扩展 `DownloadOptions`，并在 `Composer.vue` 增加对应控件。

新站点自动获得：批量提交、预览、队列、进度、取消/重试、SSE、持久化、通用文件模板。

---

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/system` | 引擎 / ffmpeg / Provider / 队列状态 |
| GET | `/api/state` | 全量任务、批次、设置 |
| GET / PUT | `/api/settings` | 读取 / 更新设置（Cookie 只回显掩码） |
| POST | `/api/resolve` | 预览解析，返回分组条目 |
| POST | `/api/batches` | 创建批次（`urls` 或预览选中的 `items`） |
| POST | `/api/batches/:id/cancel` | 取消整批 |
| POST | `/api/batches/:id/retry-failed` | 重试批次内失败 / 取消的任务 |
| DELETE | `/api/batches/:id` | 删除批次与任务记录（不删文件） |
| POST | `/api/tasks/:id/cancel` | 取消单个任务 |
| POST | `/api/tasks/:id/retry` | 重试单个任务 |
| POST | `/api/tasks/:id/reveal` | 在资源管理器中定位文件 |
| DELETE | `/api/tasks/:id` | 移除任务记录 |
| DELETE | `/api/tasks` | 清空已结束任务 |
| GET | `/api/events` | SSE：`task` / `task-removed` / `batch` / `batch-removed` / `settings` / `refresh` |

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/batches \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://www.bilibili.com/video/BV1GJ411x7h7"],"options":{"quality":"1080","codec":"h264","expandPlaylist":true}}'
```

---

## 常见问题

**缺少 ffmpeg**
B 站 1080P 及以上是音视频分离的 DASH 流，必须合并。把 `ffmpeg.exe` 放到 `tools/ffmpeg/bin/`，安装到 PATH，或在设置页填写路径。

**Python 找不到 / yt-dlp 未就绪**
运行 `pnpm setup:check`。推荐在 `.env` 写 `YTDLP_PYTHON` 指向 Python 3.10+，或设置 `YTDLP_PATH` 指向 `yt-dlp.exe`。

**1080P+ / 4K 下载不到**
1080P60、4K、HDR、Dolby 需要登录，8K 需要大会员。设置 SESSDATA 后重试；同时确认所选编码在源视频中存在（会自动回退）。

**412 / 请求被拦截**
B 站接口限流。等待几分钟再试，或配置 SESSDATA；不要同时开太高的并发（默认 2 个任务、4 个分片）。

**AV1 合并失败**
较旧的 ffmpeg 对 AV1 封装支持不完整。把编码偏好改为 H.264，或升级 ffmpeg 5+。

**下载记录在重启后变成失败**
未完成任务不会自动续传，会被标记为「服务重启，任务已中断」。点击重试即可（已完成的文件 yt-dlp 会跳过）。

**端口占用**
修改 `.env` 的 `PORT`；开发模式下同时修改 `web/vite.config.ts` 的代理目标。

---

## 技术说明

- 后端：Fastify 5 + TypeScript，无数据库；状态文件原子写入（临时文件 + rename）
- 前端：Vue 3 `<script setup>` + Vite，零 UI 框架，单文件设计系统
- 进程：`spawn` 直连 yt-dlp，`taskkill /T /F` 终止进程树；UTF-8 逐行解析
- 进度：`--newline --progress-template` 输出 `PROGRESS|...`，服务端节流 300ms 通过 SSE 广播
- 文件定位：优先 `--print after_move:filepath`，其次 `Destination`，最后按媒体 ID / mtime 在下载目录兜底查找
- 安全：默认仅监听本机；Cookie 明文保存在 `data/state.json` 和 `data/cookies.txt`；接口无鉴权，请勿直接暴露到公网
