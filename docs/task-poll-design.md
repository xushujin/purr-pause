# 任务通知轮询模块设计（可插拔）

> 状态：设计草案，当前代码尚未实现本模块。本文档记录后续实现方案，不代表现有功能。

## Context

增加一个可插拔的任务通知功能：从第三方 HTTP REST API 定时轮询新任务，有新任务时在屏幕右下角弹出动画通知窗口（播放 notify.webm）带任务数量角标。模块可在设置中启用/关闭，关闭时完全不影响现有休息提醒功能。

## 需求

- 点击通知：仅关闭，不做其他操作
- 托盘集成：不需要，后台静默运行
- API 适配：用户提供自定义 JS 表达式从响应中提取任务 ID 数组
- 通知时长：手动关闭
- 通知素材：独立的 `notify.webm` 视频文件（用户自行提供，内容不限）
- 重复通知：窗口已显示时只更新角标数字，不重复弹窗
- 可插拔：`taskPollEnabled: false` 时不启动轮询、不创建窗口

## 模块隔离设计

```
lib/task-poll.js           ← 独立模块，导出 init/start/stop/destroy/updateConfig
renderer/notification.html ← 通知窗口渲染进程
preload.js                 ← 添加 notification 相关 channel
```

main.js 集成点（约 15 行）：
1. 配置加载后，若 `taskPollEnabled === true` 则 init 模块
2. 设置保存时根据开关调用 updateConfig
3. 应用退出时调用 destroy
4. 注册 `dismiss-notification` IPC handler

关闭时模块完全不被调用，零副作用。

## Config 新增字段

```json
{
  "taskPollEnabled": false,
  "taskPollUrl": "",
  "taskPollInterval": 60,
  "taskPollHeaders": "{}",
  "taskPollExtract": "data.map(item => item.id)",
  "taskPollNotifyVideo": "notify.webm"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| taskPollEnabled | boolean | 总开关 |
| taskPollUrl | string | API 地址 |
| taskPollInterval | number | 轮询间隔秒数，最小 10 |
| taskPollHeaders | string | JSON 请求头 |
| taskPollExtract | string | JS 表达式，`data` 为响应体，返回 ID 数组 |
| taskPollNotifyVideo | string | 通知动画视频文件名 |

## 新建文件

### lib/task-poll.js

核心逻辑：
- `init(config, deps)` — 保存配置和依赖（logger, getVideoPath, preloadPath, isOverlayShowing），若已启用则 start
- `start()` — 立即 poll 一次，然后 setInterval
- `stop()` — clearInterval
- `destroy()` — stop + 关闭通知窗口 + 清空 seenIds
- `updateConfig(newCfg)` — 更新配置，根据开关 start/stop
- `dismissNotification()` — 关闭通知窗口

轮询逻辑：
- `net.fetch(url, { headers })` 请求 API
- 用户自定义表达式提取 ID 数组（本地桌面应用，用户自行配置，非远程代码）
- Set 记录已见 ID，首次轮询只记录不通知
- 有新 ID 时调用 showNotification(count)

额外处理：
- **seenIds 上限**：超过 1000 条时清理最早的一半，防止内存无限增长
- **休息动画冲突**：`isOverlayShowing` 为 true 时不弹通知，等下次轮询再检测
- **连续失败退避**：连续失败 5 次后间隔翻倍（最大 5 分钟），成功后恢复原间隔

通知窗口：
- 120x140px, 右下角, frame:false, transparent:true, alwaysOnTop:true
- 已存在时 send('update-badge', count) 更新角标

### renderer/notification.html

- 透明背景，播放 notify.webm（循环）
- 右上角红色圆形角标
- 点击任意位置 → `electronAPI.dismissNotification()`

## 修改文件

### config.json
添加 6 个 taskPoll 字段（默认关闭）

### main.js (~15 行)
1. DEFAULT_CONFIG 添加 6 个字段
2. app.whenReady 中条件初始化 task-poll 模块
3. save-config IPC 中校验 + updateConfig
4. 添加 dismiss-notification IPC handler
5. app before-quit 中 destroy

### preload.js
添加 3 个 channel：
- `onStartNotification(callback)` — 接收视频路径和计数
- `onUpdateBadge(callback)` — 接收新增计数
- `dismissNotification()` — 发送关闭请求

### renderer/settings.html
在现有设置项后添加"任务通知"分组：
- 开关（checkbox）：启用任务轮询
- 输入框：API 地址
- 输入框：轮询间隔（秒）
- 输入框：请求头（JSON）
- 输入框：提取表达式 — placeholder 示例 + hint："变量 data 为 API 返回的 JSON，表达式需返回 ID 数组，例如 data.tasks.map(t => t.id)"
- 输入框：通知视频文件名

开关关闭时其余输入框 disabled 灰显。

## 首次轮询

1. 启动后立即 poll 一次
2. 首次将所有 ID 记入 seenIds，不触发通知
3. 后续只有新 ID 才触发通知

## Verification

1. npm run dev 启动
2. 设置页启用轮询，填测试 URL，间隔 10 秒
3. 首次轮询不弹通知
4. API 添加新任务 → 弹出动画 + 角标
5. 再添加 → 角标累加不重复弹窗
6. 点击通知 → 关闭
7. 关闭开关 → 轮询停止无残留
8. 休息提醒功能不受影响
9. 休息动画显示期间不弹通知
