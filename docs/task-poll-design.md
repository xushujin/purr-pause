# 消息提醒/待办通知模块设计

> 状态：MVP 已实现。本文档继续作为第三方接口接入规范和后续迭代约束。

## 当前结论

- 消息提醒是可选模块，默认关闭，客户可在设置中开启或关闭。
- 第三方系统按 PurrPause 定义的接口规范开发，不再让用户写 JS 表达式适配任意响应。
- 第一版只要求第三方提供两个 HTTP JSON 接口：待办消息总数、待办消息列表。
- 应用通过轮询总数接口判断是否有变化，再按需拉取列表，降低接口压力。
- 新消息提醒包含两部分：消息数量角标、轻量动画提醒。
- 提醒动画应尽量不遮挡屏幕、不抢焦点、不影响鼠标键盘操作；推荐使用右下角或屏幕边缘的透明点击穿透窗口。
- 应用内提供“待办消息列表”窗口；点击消息项打开第三方提供的 `targetUrl`。
- 待办列表需要按第三方来源做明显区分：每条消息携带来源标识、来源名称和可选颜色，客户端渲染为来源标签。
- 客户端只保留有限数量的消息快照；超过上限时丢弃旧消息，避免列表和内存无限增长。

## 当前实现状态

- 已新增 `lib/message-notify.js`，负责轮询、差异检测、角标状态、轻量动画、待办列表窗口生命周期和退避。
- 已新增 `renderer/message-list.html`，用于展示待办列表、刷新状态、来源标签和跳转入口。
- 已复用 `renderer/rocket-demo.html` 作为轻量消息提醒动画窗口。
- 已在 `main.js`、`preload.js`、`renderer/message-settings.html`、`config.json` 中接入默认配置、独立消息提醒设置窗口、IPC、托盘入口、保存校验和退出清理。
- 第一版仍不做服务端推送、已读回写、本地持久化完整消息内容和系统通知中心集成。

## 背景和目标

PurrPause 当前主要提供休息提醒。新模块用于连接客户已有的第三方业务系统，比如工单、审批、告警、待办任务系统。应用不保存业务数据，只做“轮询、提醒、展示列表、跳转第三方网页”。

目标是让接入方式稳定、可测试、可交付：

- 我们定义固定接口契约。
- 第三方按契约返回数据。
- PurrPause 只依赖标准字段，不执行用户自定义提取脚本。
- 后续可以给第三方一份独立接口文档和联调清单。

## MVP 范围

### 做

- 独立“消息提醒设置”窗口提供“消息提醒”总开关。
- 独立“消息提醒设置”窗口配置第三方服务基础地址、认证信息和轮询间隔。
- 轮询“待办消息总数”接口。
- 总数或变更标识变化后拉取“待办消息列表”接口。
- 检测到新增待办时显示数量角标，并播放一次提醒动画。
- 提供待办消息列表窗口。
- 点击消息项用系统默认浏览器打开第三方 `targetUrl`。
- 关闭开关后停止轮询、隐藏角标、关闭提醒动画窗口，但保留配置。

### 暂不做

- 不做服务端推送、WebSocket、SSE。
- 不做消息已读回写接口。
- 不在本地持久化完整消息内容。
- 不做客户端同时配置多个 API 源；第一版建议由一个第三方聚合接口返回不同来源的待办消息。
- 不做复杂消息详情页；详情由第三方网站承载。
- 不做系统通知中心集成。

## 第三方接口规范 v1

### 通用要求

- 协议：HTTPS 推荐，开发环境可用 HTTP。
- 数据格式：请求和响应均为 JSON。
- 字符编码：UTF-8。
- 时间格式：ISO 8601，例如 `2026-05-26T10:30:00+08:00`。
- 鉴权：由客户配置请求头，推荐 `Authorization: Bearer <token>`。
- 所有接口应在 5 秒内返回；超时由客户端按失败处理。
- 第三方必须保证同一条待办消息的 `id` 稳定不变。

### 接口 1：获取待办消息总数

用于高频轮询。该接口应轻量，不返回完整列表。

```http
GET /purr-pause/v1/todos/count
Authorization: Bearer <token>
Accept: application/json
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 12,
    "unread": 5,
    "latestChangedAt": "2026-05-26T10:30:00+08:00",
    "version": "20260526103000"
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | number | 是 | `0` 表示成功，非 0 表示业务失败 |
| `message` | string | 是 | 状态说明 |
| `data.total` | number | 是 | 当前待办总数，用于角标显示 |
| `data.unread` | number | 否 | 未读数量；没有未读概念时可等于 `total` |
| `data.latestChangedAt` | string | 推荐 | 待办集合最近变更时间 |
| `data.version` | string | 推荐 | 待办集合版本号；任一待办新增、删除、状态变化时应改变 |

`latestChangedAt` 或 `version` 至少建议提供一个。只提供 `total` 会有盲区：如果一条旧消息消失、一条新消息出现，总数不变，客户端可能无法感知变化。

### 接口 2：获取待办消息列表

用于应用内消息列表展示，也用于总数变化后刷新本地快照。

```http
GET /purr-pause/v1/todos?limit=50&offset=0
Authorization: Bearer <token>
Accept: application/json
```

请求参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `limit` | number | 否 | 默认 50，最大 99 |
| `offset` | number | 否 | 默认 0 |

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 12,
    "items": [
      {
        "id": "todo-10086",
        "title": "审批单待处理",
        "summary": "张三提交了采购审批，需要你处理",
        "source": {
          "id": "oa",
          "name": "OA",
          "color": "#2f80ed"
        },
        "level": "normal",
        "status": "pending",
        "createdAt": "2026-05-26T09:30:00+08:00",
        "updatedAt": "2026-05-26T10:30:00+08:00",
        "targetUrl": "https://example.com/todos/todo-10086"
      }
    ]
  }
}
```

消息项字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 全局稳定唯一 ID |
| `title` | string | 是 | 列表主标题 |
| `summary` | string | 否 | 简短描述，建议 120 字以内 |
| `source.id` | string | 推荐 | 第三方来源标识，例如 `oa`、`jira`、`crm` |
| `source.name` | string | 推荐 | 第三方来源名称，用于列表标签 |
| `source.color` | string | 否 | 来源颜色，建议 6 位十六进制色值，例如 `#2f80ed` |
| `level` | string | 否 | `low` / `normal` / `high` / `urgent` |
| `status` | string | 否 | `pending` / `processing` / `done` / `cancelled` |
| `createdAt` | string | 否 | 创建时间 |
| `updatedAt` | string | 推荐 | 最近更新时间 |
| `targetUrl` | string | 是 | 点击后打开的第三方页面 URL |

客户端只展示 `status` 为 `pending` 或 `processing` 的消息。第三方也可以只返回待办状态的数据。

来源字段处理规则：

- `source.id` 缺失时客户端归为 `unknown`。
- `source.name` 缺失时客户端显示“未知来源”。
- `source.color` 缺失或非法时客户端按 `source.id` 从内置调色板稳定分配颜色。
- 客户端不会信任第三方返回的任意 CSS，只接受 `#RRGGBB` 格式色值。
- 如果客户有多个第三方系统，推荐由客户侧网关聚合为同一套接口，并通过 `source` 字段区分来源。

### 错误响应

```json
{
  "code": 40101,
  "message": "invalid token",
  "data": null
}
```

建议状态码：

| HTTP 状态 | 说明 |
|-----------|------|
| 200 | 业务请求成功，具体看 `code` |
| 400 | 请求参数错误 |
| 401 | 认证失败 |
| 403 | 无权限 |
| 429 | 请求过于频繁 |
| 500 | 第三方服务内部错误 |

客户端处理策略：

- 非 2xx 或 `code !== 0` 视为失败。
- 失败只写日志和设置页状态提示，不弹打扰性提醒。
- 连续失败进入退避。

## 客户端配置

`config.json` 和 `DEFAULT_CONFIG` 新增字段建议：

```json
{
  "messageNotifyEnabled": false,
  "messageApiBaseUrl": "",
  "messageAuthHeaders": "{}",
  "messagePollInterval": 60,
  "messageListLimit": 50,
  "messageMaxCacheItems": 99,
  "messageNotifyDir": "",
  "messageNotifyVideo": "notify-rocket.webm",
  "messageNotifyAnimation": "rocket-corner"
}
```

| 字段 | 类型 | 默认值 | 校验 |
|------|------|--------|------|
| `messageNotifyEnabled` | boolean | `false` | 总开关 |
| `messageApiBaseUrl` | string | `""` | 启用时必须是 `http:` 或 `https:` URL |
| `messageAuthHeaders` | string | `"{}"` | JSON 对象字符串 |
| `messagePollInterval` | number | `60` | 10-3600 秒 |
| `messageListLimit` | number | `50` | 1-100 |
| `messageMaxCacheItems` | number | `99` | 10-99，本地最多保留的消息数量 |
| `messageNotifyDir` | string | `""` | 小火箭素材目录；保存后自动生成 `purr-pause-消息提醒素材说明.txt`；为空时依次查找通用素材目录、用户默认 webm 目录和内置目录 |
| `messageNotifyVideo` | string | `notify-rocket.webm` | 文件名，不允许路径分隔符 |
| `messageNotifyAnimation` | string | `rocket-corner` | 预设动画模式 |

命名上建议使用 `message*`，因为这是对外产品能力；如果实现时沿用旧草案的 `taskPoll*`，需要在文档中明确映射，避免后续配置混乱。

## 用户体验设计

### 消息提醒设置窗口

托盘菜单提供独立入口：

- `消息提醒设置`

点击后打开独立设置窗口，不混入休息提醒的通用设置窗口。

- `启用消息提醒`：总开关。
- `服务地址`：第三方服务 Base URL，例如 `https://oa.example.com`。
- `接口规范`：下载独立 Markdown 文件 `PurrPause-消息提醒接口规范-v1.md`，只包含第三方接口规范。
- `请求头`：JSON textarea，例如 `{"Authorization":"Bearer xxx"}`。
- `轮询间隔`：秒，默认 60。
- `小火箭素材目录`：可选目录，放置 `notify-rocket.webm`。
- 选择小火箭素材目录并保存后，客户端在目录下生成 `purr-pause-消息提醒素材说明.txt`。
- `提醒动画素材`：视频文件名或素材选择。
- `测试连接`：可选按钮，用于调用 count 接口并展示结果。

关闭开关时：

- 不启动轮询。
- 不创建动画窗口。
- 不显示角标。
- 不清空用户已填写的配置。

### 角标设计

角标应该稳定可见但不干扰：

- 托盘菜单显示 `待办消息：N`。
- 设置页或待办列表入口显示数量。
- 如果未来有 Dock/任务栏 badge 支持，可按平台补充。

不建议把角标做成长期悬浮在桌面上的窗口；这会增加遮挡和误触风险。

### 提醒动画设计

用户提出的小火箭效果可以实现，推荐方式：

- 创建一个小尺寸透明无边框窗口，宽高约 `180x180` 到 `260x260`。
- 窗口位置从主屏幕右下角或左下角开始，沿屏幕边缘向上移动。
- 使用 `setIgnoreMouseEvents(true, { forward: true })`，让鼠标事件穿透，不影响工作。
- `focusable: false`、`skipTaskbar: true`，不抢焦点、不出现在任务栏。
- 动画只播放一次，建议 2-4 秒后自动销毁窗口。
- 动画窗口只覆盖小区域，不创建全屏覆盖层。

小火箭示例流程：

1. 新待办到来，计算新增数量。
2. 若当前没有休息提醒覆盖层，也没有正在播放的消息动画，创建透明动画窗口。
3. 加载用户提供的 `notify-rocket.webm`。
4. 窗口从屏幕角落移动到顶部附近。
5. 播放完成后自动关闭。
6. 角标数量保留，直到下一次列表刷新变为 0。

如果新消息连续到来：

- 动画播放中不重复创建第二个火箭。
- 只更新待办角标。
- 动画结束后，如果仍有新的 pending 提醒，可按冷却时间决定是否再播放一次。

### 待办消息列表

应用提供一个“待办消息”窗口，入口建议放在托盘菜单：

- `待办消息（N）`
- 点击打开列表窗口。

列表窗口内容：

- 顶部显示总数、最后刷新时间、刷新按钮。
- 列表项显示标题、摘要、来源、等级、创建时间。
- 来源以彩色标签展示，颜色来自 `source.color` 或客户端内置调色板。
- 不同第三方来源的标签位置和样式保持一致，避免用户只靠颜色辨认。
- 点击列表项调用 `shell.openExternal(item.targetUrl)` 打开第三方网站。
- URL 必须是 `http:` 或 `https:`，非法 URL 不打开并记录日志。

列表刷新策略：

- 打开窗口时立即拉取列表。
- 点击刷新按钮时拉取列表。
- 后台轮询发现版本变化后，如果窗口已打开，则自动刷新列表。

列表性能策略：

- UI 首屏只渲染当前可见区域；如果实现简单列表，第一版最多渲染 `messageListLimit` 条。
- 本地内存快照最多保留 `messageMaxCacheItems` 条。
- 超过上限时按 `updatedAt`、`createdAt` 倒序保留最新消息，丢弃旧消息。
- 如果第三方返回的 `total` 大于本地保留上限，列表顶部提示“仅显示最近 N 条”。
- 角标仍使用第三方返回的 `total` 或 `unread`，不受本地丢弃旧消息影响。
- 列表项中的长标题和摘要必须截断，避免单条消息导致布局抖动。

## 模块边界

```
lib/message-notify.js        # 轮询、差异检测、角标状态、通知生命周期
renderer/message-list.html   # 待办消息列表窗口
renderer/message-settings.html # 消息提醒独立设置窗口
renderer/notification.html   # 小火箭/轻量提醒动画窗口
preload.js                   # 增加消息列表和通知 IPC
main.js                      # 生命周期、托盘入口、配置集成
renderer/settings.html       # 通用休息提醒设置 UI
config.json                  # 默认配置
assets/webm/notify-rocket.webm # 可选内置示例素材
```

### lib/message-notify.js

导出接口：

- `init(config, deps)`：初始化模块，必要时启动轮询。
- `updateConfig(nextConfig)`：更新配置，开关或关键字段变化时重启。
- `start()`：立即轮询 count，然后开启定时器。
- `stop()`：停止轮询，关闭提醒动画，保留配置。
- `destroy()`：停止轮询，关闭所有消息相关窗口。
- `refreshList()`：拉取待办列表。
- `openMessageList()`：打开或聚焦待办列表窗口。
- `openMessageTarget(id)`：打开某条消息的 `targetUrl`。

依赖由 `main.js` 注入：

- `BrowserWindow`
- `screen`
- `shell`
- `preloadPath`
- `logger`
- `getNotifyVideoPath(filename)`
- `isRestOverlayShowing()`
- `onBadgeChange(count)`：用于刷新托盘菜单。

## 轮询和差异检测

1. 启用后立即调用 `GET /purr-pause/v1/todos/count`。
2. 第一次成功只记录 `total`、`unread`、`latestChangedAt`、`version`，不播放动画。
3. 后续轮询如果 `total`、`latestChangedAt` 或 `version` 发生变化，调用列表接口刷新快照。
4. 用列表中的 `id` 与本地 `knownIds` 比较，计算新增消息。
5. 新增消息数大于 0 时：
   - 更新角标为最新 `total` 或 `unread`。
   - 播放一次提醒动画。
   - 如果列表窗口已打开，自动刷新列表。
6. 列表数据进入内存前先标准化：
   - 补齐 `source.id`、`source.name` 和来源颜色。
   - 过滤非法 `targetUrl`。
   - 按 `updatedAt`、`createdAt` 倒序排序。
   - 超过 `messageMaxCacheItems` 时丢弃旧消息。
7. 如果总数变为 0：
   - 清空角标。
   - 清空本地列表快照。

注意：角标显示应以第三方返回的 `total` 或 `unread` 为准，不以“本次新增数量”为准。提醒动画只反映“有新消息到来”。

## 状态机

| 状态 | 说明 | 进入条件 | 退出条件 |
|------|------|----------|----------|
| `disabled` | 功能关闭 | 默认或用户关闭开关 | 用户开启且配置有效 |
| `idle` | 已启用，等待轮询 | 初始化完成 | 定时器触发 |
| `polling-count` | 正在拉取总数 | 启动或定时器触发 | 成功或失败 |
| `polling-list` | 正在拉取列表 | 总数/版本变化或用户打开列表 | 成功或失败 |
| `notifying` | 正在播放轻量动画 | 检测到新增消息 | 动画结束 |
| `backoff` | 连续失败后降频 | 连续失败达到阈值 | 下一次成功 |

## 失败与退避

- count 和 list 接口分别记录失败，但共享退避策略。
- 连续失败 5 次后轮询间隔翻倍，最大 300 秒。
- 任意一次成功后失败计数归零，恢复用户配置间隔。
- 失败不播放动画、不弹错误通知。
- 设置页和待办列表窗口可以显示最后错误，例如“最近同步失败：认证失败”。

## 来源标注和颜色

待办列表不能只靠文字来源区分。每条消息应展示一个来源标签：

- 标签文案优先使用 `source.name`。
- 标签颜色优先使用 `source.color`。
- 如果颜色缺失，客户端按 `source.id` 哈希到内置色板，保证同一来源颜色稳定。
- 标签同时使用文字和颜色，不只依赖颜色，照顾色弱用户。
- `level` 仍用于表示紧急程度，不能和来源颜色混用。

建议内置色板使用区分度较高、不过度刺眼的颜色，例如：

| 色值 | 用途 |
|------|------|
| `#2f80ed` | 蓝色来源 |
| `#27ae60` | 绿色来源 |
| `#f2994a` | 橙色来源 |
| `#9b51e0` | 紫色来源 |
| `#eb5757` | 红色来源 |
| `#00a7a7` | 青色来源 |

如果后续支持客户配置来源映射，可以增加：

```json
{
  "messageSourceStyles": {
    "oa": { "name": "OA", "color": "#2f80ed" },
    "jira": { "name": "Jira", "color": "#27ae60" }
  }
}
```

第一版不要求设置页编辑这份映射，先以第三方返回字段和内置色板为主。

## 性能和消息淘汰

消息提醒模块必须控制内存、渲染和网络成本：

- count 接口高频轮询，list 接口只在 count/version 变化、用户打开列表、手动刷新时调用。
- list 请求使用 `limit=messageMaxCacheItems&offset=0`，单次最多拉取 99 条，要求第三方按最新更新时间倒序返回。
- 客户端最多保留 `messageMaxCacheItems` 条消息，默认 99。
- 超过上限时丢弃旧消息，不写入磁盘，不参与列表渲染。
- `knownIds` 也需要上限，默认保留最近 2000 个 ID，避免长期运行后无限增长。
- 列表窗口打开时只渲染 `messageListLimit` 条；后续如果需要展示更多，再做分页或虚拟列表。
- 如果 `total > messageMaxCacheItems`，角标显示真实总数，列表显示“仅展示最近 99 条”。

淘汰规则：

1. 优先按 `updatedAt` 倒序。
2. `updatedAt` 缺失时按 `createdAt` 倒序。
3. 两者都缺失时按本次接口返回顺序。
4. 保留前 `messageMaxCacheItems` 条。
5. 丢弃消息只影响本地展示，不影响第三方系统真实待办。

## 安全与隐私

- 只允许打开 `http:` / `https:` 的 `targetUrl`。
- 不执行第三方返回的脚本或 HTML。
- 列表窗口用 `textContent` 渲染标题和摘要，避免 HTML 注入。
- 请求头可能包含 token，日志中不能打印完整请求头。
- 不在本地持久化业务消息正文；内存中保留最近一次列表即可。
- 如果后续要持久化，需要加密或明确数据保留策略。

## 和休息提醒的关系

- 休息提醒优先级更高。
- `isOverlayShowing === true` 时不播放小火箭动画。
- 休息提醒期间仍可继续轮询和更新角标。
- 休息提醒结束后，如果期间有新增消息，可以播放一次合并后的提醒动画。
- 消息动画窗口不使用全屏覆盖，不影响当前休息提醒窗口的生命周期。

## IPC 设计

`preload.js` 新增：

- `onStartMessageNotification(callback)`：接收 `{ videoPath, count, durationMs }`。
- `onUpdateMessageBadge(callback)`：接收 `{ count }`。
- `dismissMessageNotification()`：关闭动画窗口。
- `onLoadMessages(callback)`：消息列表窗口接收列表数据。
- `refreshMessages()`：列表窗口请求刷新。
- `openMessageTarget(id)`：列表窗口请求打开第三方页面。

`main.js` 新增：

- `ipcMain.on('dismiss-message-notification', ...)`
- `ipcMain.on('refresh-messages', ...)`
- `ipcMain.on('open-message-target', ...)`

## main.js 集成点

1. 引入 `lib/message-notify.js`。
2. `DEFAULT_CONFIG` 添加消息提醒配置字段。
3. `app.whenReady` 中初始化消息模块。
4. 托盘菜单增加 `待办消息（N）`，点击打开消息列表。
5. 托盘菜单增加 `消息提醒设置`，点击打开独立消息提醒设置窗口。
6. `save-config` IPC 校验并保存消息提醒配置，然后调用 `messageNotify.updateConfig(config)`。
7. `before-quit` 调用 `messageNotify.destroy()`。
8. 消息模块通过回调触发 `rebuildTrayMenu()` 更新角标。

## 实施拆分

### Phase 1：接口规范和配置 UI

- 固化本文档中的第三方接口规范。
- 更新默认配置字段。
- 新建独立消息提醒设置窗口。
- 支持开启/关闭、Base URL、请求头、轮询间隔、动画素材。

验收：配置可保存；关闭开关时不启动轮询。

### Phase 2：轮询和角标

- 新建 `lib/message-notify.js`。
- 实现 count/list 两个接口调用。
- 实现总数、版本和新增 ID 差异检测。
- 实现来源字段标准化、内置色板和消息淘汰上限。
- 托盘菜单显示 `待办消息（N）`。

验收：本地 mock 服务返回不同数量时，角标正确更新。

### Phase 3：待办消息列表

- 新建 `renderer/message-list.html`。
- 实现列表展示、手动刷新、最后刷新时间、错误状态。
- 实现来源标签和颜色区分。
- 实现列表渲染上限，超过上限时提示“仅显示最近 N 条”。
- 点击消息项打开 `targetUrl`。

验收：列表可打开，点击消息能跳转第三方网页。

### Phase 4：轻量动画提醒

- 新建或复用 `renderer/notification.html`。
- 实现小火箭素材播放和窗口位移动画。
- 设置窗口为点击穿透、不抢焦点、不占任务栏。
- 新增消息时播放一次，连续新增时合并提醒。

验收：动画从屏幕角落到顶部后消失，不影响鼠标点击当前工作窗口。

### Phase 5：冲突处理和稳定性

- 休息提醒显示期间不播放消息动画。
- 连续失败退避。
- 退出应用时清理窗口和定时器。
- 日志脱敏。

验收：休息提醒、暂停监控、激活窗口、消息提醒互不破坏。

## 验证清单

1. 默认关闭消息提醒，不发起任何第三方请求。
2. 开启后配置无效 URL，保存失败或提示错误。
3. 配置 mock 第三方接口后，客户端按间隔调用 count 接口。
4. count 变化后调用 list 接口。
5. 首次同步不播放动画。
6. 新增消息后角标更新。
7. 新增消息后小火箭动画播放一次并自动消失。
8. 动画播放期间鼠标点击能穿透到后方窗口。
9. 托盘菜单显示 `待办消息（N）`。
10. 点击托盘入口打开待办消息列表。
11. 点击托盘 `消息提醒设置` 打开独立消息提醒设置窗口。
12. 不同 `source.id` 的消息显示不同来源标签和稳定颜色。
13. 第三方未返回 `source.color` 时，客户端自动分配稳定颜色。
14. 消息数量超过 `messageMaxCacheItems` 后，旧消息被丢弃，列表只显示最近 N 条。
15. 点击列表项打开第三方 `targetUrl`。
16. 关闭消息提醒开关后停止轮询、关闭动画窗口、隐藏角标。
17. 第三方接口连续失败后进入退避。
18. 休息提醒显示时不播放消息动画，但角标仍更新。
19. 休息提醒结束后可以合并播放一次消息提醒动画。

## 待确认决策

- 角标使用 `total` 还是 `unread`，如果第三方没有未读概念，建议使用 `total`。
- 第三方 `targetUrl` 是否必须同域名；如果需要限制，应增加允许域名配置。
- 是否内置默认小火箭素材；如果不内置，需要在设置页明确提示用户提供素材。
- 待办列表窗口入口只放托盘菜单，还是设置页也放一个“打开待办”按钮。
- 消息提醒是否作为激活用户功能；如果是，需要在保存配置和 UI 上加授权限制。
- `messageMaxCacheItems` 默认 99；如果客户待办量很大，是否仍只保留最近 99 条，还是后续另做分页。
- 第三方来源颜色由第三方返回，还是由客户在 PurrPause 设置中统一配置。
