---
name: lark-shared
version: 1.0.0
description: "飞书/Lark CLI 共享基础：应用配置初始化、认证登录（auth login）、身份切换（--as user/bot）、权限与 scope 管理、Permission denied 错误处理、安全规则。当用户需要第一次配置(`lark-cli config init`)、使用登录授权(`lark-cli auth login`)、遇到权限不足、切换 user/bot 身份、配置 scope、或首次使用 lark-cli 时触发。"
---

# lark-cli 共享规则

本技能指导你如何通过lark-cli操作飞书资源, 以及有哪些注意事项。

## 配置初始化

首次使用需运行 `lark-cli config init` 完成应用配置。

当你帮用户初始化配置时，使用background方式使用下面的命令发起配置应用流程，启动后读取输出，从中提取授权链接并发给用户：

```bash
# 发起配置（该命令会阻塞直到用户打开链接并完成操作或过期）
lark-cli config init --new
```

## 认证

### 身份类型

两种身份类型，通过 `--as` 切换：

| 身份 | 标识 | 获取方式 | 适用场景 |
|------|------|---------|---------|
| user 用户身份 | `--as user` | `lark-cli auth login` 等 | 访问用户自己的资源（日历、云空间等） |
| bot 应用身份 | `--as bot` | 自动，只需 appId + appSecret | 应用级操作,访问bot自己的资源 |

### 身份选择原则

输出的 `[identity: bot/user]` 代表当前身份。bot 与 user 表现差异很大，需确认身份符合目标需求：

- **Bot 看不到用户资源**：无法访问用户的日历、云空间文档、邮箱等个人资源。例如 `--as bot` 查日程返回 bot 自己的（空）日历
- **Bot 无法代表用户操作**：发消息以应用名义发送，创建文档归属 bot
- **Bot 权限**：只需在飞书开发者后台开通 scope，无需 `auth login`
- **User 权限**：后台开通 scope + 用户通过 `auth login` 授权，两层都要满足


### 权限不足处理

遇到权限相关错误时，**根据当前身份类型采取不同解决方案**。

错误响应中包含关键信息：
- `permission_violations`：列出缺失的 scope (N选1)
- `console_url`：飞书开发者后台的权限配置链接
- `hint`：建议的修复命令

#### Bot 身份（`--as bot`）

将错误中的 `console_url` 提供给用户，引导去后台开通 scope。**禁止**对 bot 执行 `auth login`。

#### User 身份（`--as user`）

```bash
lark-cli auth login --domain <domain>           # 按业务域授权
lark-cli auth login --scope "<missing_scope>"   # 按具体 scope 授权（推荐,符合最小权限原则）
```

**规则**：auth login 必须指定范围（`--domain` 或 `--scope`）。多次 login 的 scope 会累积（增量授权）。

#### Agent 代理发起认证（推荐）

当你作为 AI agent 需要帮用户完成认证时，使用background方式 执行以下命令发起授权流程, 并将授权链接发给用户：

```bash
# 发起授权（阻塞直到用户授权完成或过期）
lark-cli auth login --scope "calendar:calendar:readonly"

```


## 安全规则

- **禁止输出密钥**（appSecret、accessToken）到终端明文。
- **写入/删除前核对已有授权**：核对用户已授权的操作、目标和范围；已有明确指令且范围未变化时，不重复询问。没有写入授权，或关键目标有歧义时，先向用户询问。
- **区分核验与询问**：“确认目标/身份/结果”默认指读取或查询核验，不自动增加对话审批。需要用户回答的步骤应明确写“向用户询问”。
- **保留明确批准要求**：具体操作要求单独确认、二次确认或展示内容后批准的，继续遵守，包括邮件/消息发送、角色删除、所有权转移及非空画板覆盖。不得用本规则跳过这些步骤。
- 当前命令支持时，用 `--dry-run` 预览危险请求；先查命令帮助，不臆造 `--yes`、`--confirm` 等安全参数。具体操作规定的预览和批准步骤仍须遵守。
