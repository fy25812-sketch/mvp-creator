# MVP Creator (`dsh-mvp-creator`)

一句粗略 idea 进，一个**跑得起来、部署得了**的 MVP 出。

它存在的理由是砍掉 MVP 流程里两个反复出现的成本：**每次都要交代技术栈**，和**每次都要重新讲一遍怎么部署、怎么挂域名**。这两件事被固化进插件，所以人的交互从"来回五六轮"降到"一句话（必要时再补一张提问卡）"。

衡量提效的方式也是可实测的，而不是感觉：**Token ÷ 沟通次数**——同样一条人话换到的产出越多，说明 Agent 对人的杠杆越大。

---

## 1. 装了它，你会多出什么

| 贡献 | 形态 | 作用 |
|---|---|---|
| `/mvp <idea>` | 斜杠命令 | 建 run、写 run 记录、把一份完整的 brief 注入会话，Agent 立刻开工 |
| `mvp-creator` | skill | 同一套工作流也进模型技能目录：用户没打命令、只是说了个想法时也能被路由到 |
| `mvp_scaffold` | 工具 | 确定性渲染 FastAPI + SQLite 骨架并装依赖（不烧 token 写样板） |
| `mvp_deploy` | 工具 | 用真实域名/SSH 目标重渲染部署产物；默认 dry-run 打印完整计划，apply 才执行 |
| `mvp_measure` | 工具 | 读会话投影缓存，算出 Token ÷ 沟通次数（含基线的对比） |

## 2. 安装

插件**零依赖、零构建**：它不 import 任何 harness 包，用的是 `ctx` 上的原生注册接口（命令 id 是字符串、工具定义是原生对象、注入的用户消息是普通对象）。所以同一份源码可以从任意路径加载。

### 方式 A：开发态（改完即生效，推荐先这样用）

在 profile 的 patch 层里插一行，指向源码绝对路径：

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- insert:
    - id: mvp-creator
      name: 'D:/工作/Project/mvp-creator/src/index.js'
      config:
        projectsDir: 'D:/工作/Project'
```

`web` profile 默认带 `patchReload: live`，保存后**事务化热加载，不用重启**。验证：

```bash
pnpm dsh --profile web --dump-config | Select-String mvp-creator
```

### 方式 B：作为可安装 bundle（给别人用）

包已声明 `dsh.bundle`，所以：

```bash
dsh plugin --profile web add ./mvp-creator
```

之后 `cordis.patch.yml` 里的行用包名即可（`name: dsh-mvp-creator`）。

## 3. 一次 run 长什么样

```
/mvp 面试官现场投票小站：候选人各列一个想深入聊的项目，面试官投票选出最想听的
```

1. 命令立刻建 run（`.mvp/runs/<slug>-<时间戳>/{idea.md,brief.md}`），首次运行还会生成 `.mvp/deploy.yml` 骨架（填一次，之后所有 MVP 复用）。
2. brief 作为一条用户消息注入会话：里面已经写清 slug、项目目录、技术栈、部署目标、提问预算、执行顺序、硬护栏、验收清单。
3. Agent 按 brief 执行：`mvp_scaffold` → 只改 `app/` 写业务 → 起服务冒烟 → `mvp_deploy` dry-run → 交付报告。
4. **提问预算**：整个 run 最多 1 轮、一轮最多 5 问、必须一次提交；每个问题都带默认值，信息够就直接跳过。

低交互是"可以低"，不是"必须低"：开工后你随时插话、随时加需求，那就是普通对话。

## 4. 配置

插件行的 `config` 映射（全部可选）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `projectsDir` | 宿主进程 cwd | 生成项目的父目录 |
| `preset` | `fastapi-sqlite` | 应用预设（当前仅此一个） |
| `deployTarget` | `local` | `local` 或 `server`，只影响 brief 里写什么 |
| `appPort` | `8000` | 宿主机端口 |
| `questionBudget` | `5` | 单轮提问上限（0–10） |
| `injectBrief` | `true` | 是否把 brief 注入会话 |
| `deployFile` | `<projectsDir>/.mvp/deploy.yml` | 部署配置路径 |

## 5. 部署（自建服务器：Docker + nginx + 域名 + HTTPS）

一次性把服务器事实填进 `.mvp/deploy.yml`（扁平 YAML，只写**路径**不写密钥）：

```yaml
domain: mvp.example.com
sshHost: 10.0.0.9
sshUser: deploy
sshPort: 22
remoteDir: /srv/apps/interview-poll
certEmail: ops@example.com
identityFile: C:/Users/me/.ssh/id_ed25519
appPort: 8000
```

然后：

```
mvp_deploy({ projectDir, mode: 'dry-run' })   # 默认：只打印计划
mvp_deploy({ projectDir, mode: 'apply' })     # 只有用户明确说"部署"才用
```

计划固定为：preflight → remote-mkdir → sync（`tar | ssh`，**不用 rsync**，因为 Windows 没有）→ `docker compose build && up -d` → 健康检查（重试 12 次，失败打印 `logs --tail=100`）→ nginx 站点（需免密 sudo）→ certbot 签发 → reload。

`apply` 的护栏：`domain / sshHost / sshUser / remoteDir` 缺任何一个就直接拒绝并告诉你缺什么，不会猜。

## 6. 度量怎么读

```
mvp_measure({ projectDir: 'Project' })   # 或 { sessionId } / { latest: true }
```

输出里有两个分母，别混：

- `turns`：harness 自己的轮次计数。**目标轮或其它自动续跑也会开一轮**，所以它可能大于你实际打的字数。
- `humanPrompts`：真正由人提交的提问条数（空 prompt 不算）。

以及两个分子：`billed`（uncached input + output，接近真实计费）和 `total`（再加 cache read，反映省了多少重复前缀）。

传 `baselineTokens` / `baselineTurns` / `baselineLabel` 可以和"手工铺一遍"的历史 run 对比，输出 `turnsSaved` 与 `leverageRatio`。

## 7. 代码结构

```
src/index.js              插件入口：name/inject/apply，注册命令+技能+三个工具
src/config.js             配置解析与校验（不依赖 schemastery，逐字段显式默认/拒绝）
src/command-mvp.js        /mvp：解析输入、建 run、注入 brief、生成部署骨架
src/skill.js              把 skills/mvp-creator/SKILL.md 注册为运行时 skill
src/tools/{scaffold,deploy,measure}.js
src/lib/template.js       占位符渲染（token 白名单，未知 token 直接抛错）
src/lib/render-project.js 目录级渲染（先全部在内存渲染成功再落盘）
src/lib/vars.js           模板变量解析（脚手架与部署共用，保证两处取值一致）
src/lib/deploy-settings.js / yamlite.js / fsx.js / proc.js / slug.js / toolkit.js / brief.js
src/templates/fastapi-sqlite/   27 个文件的模板（应用 + Docker + nginx + certbot + 脚本）
skills/mvp-creator/SKILL.md     模型-facing 工作流正文
scripts/preflight.js      模板预检（token 契约 + 结构化文件引号卫生 + --out 渲染样例）
tests/                    41+ 个 node:test 用例（mock ctx，无需启动 harness）
```

## 8. 已经验证过什么

| 验证 | 结果 |
|---|---|
| 单元测试 `npm run test:inline` | 全绿（渲染/命令/脚手架/部署/度量/技能加载） |
| 模板预检 `node scripts/preflight.js` | 27 个文件渲染干净，12 个 token 全覆盖，YAML/TOML 引号卫生通过 |
| 渲染样例真跑 | `uv venv` + `uv pip install` 成功；`app.main` 可导入；uvicorn 起在 8123；`/healthz` 200、`/api/items` 200、`POST` 201、`/` 200 带表单 |
| 中文 UTF-8 | 通过 API 往返一致（含中文标题） |
| 模板自带 `pytest` | 6 passed（退出码 0） |
| 插件热激活 | 写 profile patch 后本会话 skill 目录出现 `mvp-creator`，三个工具可调用 |
| 真机 `mvp_scaffold` | 在 DSH 宿主进程里渲染 27 文件 + 依赖安装成功（`uv venv`/`uv pip install` 均 code 0） |

## 9. 已知限制

- **本地没跑过 `docker build`**：本机 Docker 守护进程未启动，所以镜像构建与 `mvp_deploy --apply` 只验证到「渲染 + 计划 + 拒绝缺字段」这一层，真机部署需要你的服务器。
- **`apply` 依赖服务器侧条件**：nginx 站点与证书步骤需要免密 `sudo`；`certbot` 那一步要求 DNS A 记录已指向服务器，否则必然失败（计划里已注明）。
- **单预设**：v1 只有 `fastapi-sqlite` 一条链，先把「一句话 → 成品」闭环跑通。
- **依赖安装环境**：`mvp_scaffold` 会把 `UV_CACHE_DIR` / `UV_PYTHON_INSTALL_DIR` 指到项目内，所以受限会话里也能装；但需要 `uv` 在 PATH 上（缺了会明确报告并让你手动装）。
- **`uv run` 不要用**：在项目目录里它会把项目自身也构建一遍，多一个失败点；模板与 skill 统一用 `.venv` 里的解释器。

## 10. 加一个新预设

1. 在 `src/templates/<preset>/` 放模板文件，只用 `src/lib/template.js` 里白名单内的 `{{TOKEN}}`。
2. 把 preset 名加进 `src/config.js` 的 `PRESETS`。
3. `node scripts/preflight.js` 必须通过（未知 token、结构化文件里未加引号的 token 都会在这里挂掉）。

---

MIT.
