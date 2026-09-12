---
name: mvp-creator
version: 1.0.0
description: "从一句粗略想法快速建出并落地一个 MVP：/mvp 一条命令触发、最多一轮合并提问、确定性脚手架（FastAPI + SQLite）、自建服务器 Docker + nginx + 域名 + HTTPS 部署产物、以及 Token ÷ 沟通次数 的提效度量。当用户说「做个 MVP / 快速验证一下这个想法 / 原型 / demo / 先跑起来看看 / prototype / validate this idea」，或输入 /mvp 时使用。不负责既有产品的功能迭代（那走普通开发流程），也不负责纯静态单页演示（可用妙搭 HTML 发布）。"
whenToUse: "用户给出一句粗略想法、希望尽快看到能跑/能分享的东西；或用户输入 /mvp。"
---

# MVP Creator

一句话想法 → 一个跑得起来、部署得了的 MVP。**人只需要说一句，剩下的默认值和流程都固化在这里。**

## 何时用 / 何时不用

用：用户有一个粗略 idea，想尽快看到实物；想验证可行性；想拿去演示。
不用：已有产品的常规迭代、线上故障修复、纯静态单页演示（那种用妙搭 HTML 发布更快）。

## 0. 识别已有 brief（最重要的一步）

用户用 `/mvp <idea>` 触发时，会话里已经有一条以 `# MVP run brief` 开头的消息，里面写清了 slug、项目目录、技术栈、部署目标、提问预算和验收清单。

**看到它就直接按它执行，不要重新问一遍已经写在那里的东西。**

如果用户是自然语言触发（没有 brief），把这段当作 brief：用同样顺序执行，slug 从 idea 自取。

## 1. 固化决策（永远不需要问用户）

| 决策 | 值 |
|---|---|
| 技术栈 | `fastapi-sqlite`：FastAPI + SQLAlchemy 2.0 + SQLite + Jinja2（**不要换栈**） |
| 骨架 | 由 `mvp_scaffold` 渲染，**不要手写样板文件** |
| 本地运行 | `.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port <APP_PORT>`（POSIX 用 `.venv/bin/python`；`mvp_scaffold` 返回的 `runCommandLine` 已是平台正确的命令） |
| 部署 | Docker + nginx + certbot，产物已随模板生成，由 `mvp_deploy` 操作 |
| 目录 | `<projectsDir>/<slug>`，`projectsDir` 默认当前工作区 |

## 2. 沟通预算（硬约束）

**整个 run 最多再做 1 轮提问**，一轮最多 5 个问题、必须一次提交（用一次 `ask_user_question` 调用带多个 question）。

- 每个问题都必须带默认值，并明确说"不答就按默认走"。
- **信息已经够，就直接开工**；不要为了默认值再问一次。
- 用户说 `--no-ask` 或「全默认」时，**一个都不要问**。
- 开工之后再想澄清，用实物提问（"我先做成了 A，你要的是 B 吗"），不要提前连环追问。

判断标准：问之前先自问"这个问题的答案会不会改变我要写的代码"。不会 → 别问，用默认值。

## 3. 执行顺序

### 3.1 建骨架

```
mvp_scaffold({ idea, slug?, targetDir?, projectName?, entity? })
```

它会渲染模板、装依赖（uv）、写 run 清单，并返回文件清单与下一步命令。**不要跳过它去手写 FastAPI 样板**——那是确定性工作，手写只会浪费 token 并引入不一致。

### 3.2 写业务

只改 `app/` 下的业务逻辑，把 idea 落成「**一个核心动作 + 一条数据**」的闭环：

- 改模型（`app/models.py`、`app/schemas.py`）贴合真实业务对象，替掉示例实体；
- 改接口与页面（`app/api/`、`app/templates/index.html`），让核心动作一眼可完成；
- 改种子数据（`app/seed.py`），让第一次打开就有内容可看，**不要空白页面**。

禁止项（这些都不属于 MVP）：登录、权限、多租户、后台管理、队列、缓存、微服务、国际化、深色模式。

### 3.3 起服务并冒烟

```bash
.venv/Scripts/python.exe -m uvicorn app.main:app --port <APP_PORT>   # Windows 后台跑；POSIX 用 .venv/bin/python
```

然后探活：`Invoke-WebRequest http://127.0.0.1:<APP_PORT>/healthz`（POSIX 用 `curl -fsS`）。

再跑 `.venv/Scripts/python.exe -m pytest -q`。**跑不通不要交付**：先修，再报。

**不要用 `uv run`**：在项目目录里它会把项目自身也构建安装一遍，多一步构建就多一个失败点（受限环境下这一步会直接失败）。

### 3.4 部署产物

默认先 `mvp_deploy({ projectDir, mode: 'dry-run' })`，把计划和"还缺哪些字段"报给用户。

只有当用户**明确说**"部署 / 上线 / 推到服务器"时才 `mode: 'apply'`。apply 需要 `.mvp/deploy.yml` 里 `domain / sshHost / sshUser / remoteDir` 齐全——缺就报缺什么，别猜、别去问密钥内容。

### 3.5 交付报告

按这个结构给，别写成流水账：

```
访问地址：http://127.0.0.1:<PORT>（或 https://<domain>）
一句话：它现在能做什么（一个核心动作）
目录：<projectDir>
技术栈：FastAPI + SQLite（固化）
部署：dry-run 计划 N 步；还缺 <字段>  /  已部署
改动文件：<列表>
提效：mvp_measure 给出的 tokens/turn
下一步建议：1~2 条
```

## 4. 度量：Token ÷ 沟通次数

用 `mvp_measure`（默认取本工作区最近一条会话）拿到真实数字，写进报告。

- 分子：总 token（uncached input + output + cache read）。
- 分母：人类轮次（`sessionStats.turns`）。
- 数值越大 = 同样一次人类交互换到的产出越多 = 提效越好。

如果有"手工铺一遍"的基线，传 `baselineTokens` / `baselineTurns` 做对比。**不要编数字**：拿不到就说明拿不到。

## 5. 硬护栏

1. **不换栈**。确有必要时先说明代价，等用户确认。
2. **不做 MVP 之外的功能**。想法膨胀时提议"下一版"，不要顺手做。
3. **不删用户数据**。写操作限定在 `<projectDir>` 与 `.mvp/` 内。
4. **不落盘任何明文密钥**。部署凭据只在 `.mvp/deploy.yml` 里写**路径**。
5. **apply 必须由用户明确发起**；默认永远 dry-run。
6. **未经用户确认不对外暴露端口**：本地预览只绑 `127.0.0.1`。

## 6. 验收清单（交付前自查）

- [ ] `uv run pytest -q` 通过
- [ ] `/healthz` 返回 200
- [ ] 核心动作端到端走通（写一条 → 看得到）
- [ ] 首次打开页面**不是空白**（种子数据就位）
- [ ] 没有引入禁止项（登录/权限/队列/缓存/微服务）
- [ ] Dockerfile、docker-compose.yml、deploy/nginx.conf、deploy/deploy.sh 齐全
- [ ] `mvp_deploy` dry-run 输出可读、步骤完整
- [ ] 报告里有真实 Token ÷ 沟通次数
