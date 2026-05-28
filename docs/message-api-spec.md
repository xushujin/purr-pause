# PurrPause 消息提醒接口规范 v1

本文档用于第三方系统接入 PurrPause 消息提醒功能。第三方只需要按约定提供两个 HTTP JSON 接口：待办消息总数、待办消息列表。

## 通用要求

- 协议：HTTPS 推荐，开发环境可用 HTTP。
- 数据格式：请求和响应均为 JSON。
- 字符编码：UTF-8。
- 时间格式：ISO 8601，例如 `2026-05-26T10:30:00+08:00`。
- 鉴权：由客户在 PurrPause 消息提醒设置中配置请求头，推荐 `Authorization: Bearer <token>`。
- 所有接口应在 5 秒内返回；超时会被视为请求失败。
- 第三方必须保证同一条待办消息的 `id` 稳定不变。

## 接口 1：获取待办消息总数

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
| `data.total` | number | 是 | 当前待办总数 |
| `data.unread` | number | 否 | 未读数量；没有未读概念时可等于 `total` |
| `data.latestChangedAt` | string | 推荐 | 待办集合最近变更时间 |
| `data.version` | string | 推荐 | 待办集合版本号；任一待办新增、删除、状态变化时应改变 |

`latestChangedAt` 或 `version` 至少建议提供一个。只提供 `total` 会有盲区：如果一条旧消息消失、一条新消息出现，总数不变，PurrPause 可能无法感知变化。

## 接口 2：获取待办消息列表

用于返回待办消息列表。

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
| `targetUrl` | string | 是 | 点击后打开的第三方页面 URL，必须是 `http:` 或 `https:` |

建议第三方只返回 `status` 为 `pending` 或 `processing` 的消息；如返回 `done` 或 `cancelled`，PurrPause 可能不会展示。

来源字段处理规则：

- `source.id` 缺失时归为 `unknown`。
- `source.name` 缺失时显示“未知来源”。
- `source.color` 缺失或非法时，PurrPause 按 `source.id` 从内置调色板稳定分配颜色。
- 不支持任意 CSS，只接受 `#RRGGBB` 格式色值。
- 如果客户有多个第三方系统，推荐由客户侧网关聚合为同一套接口，并通过 `source` 字段区分来源。

## 错误响应

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

错误判定：

- 非 2xx 或 `code !== 0` 会被视为失败。
