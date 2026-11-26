# 藏海 · canghai

> 二次元知识图鉴引擎 + 控制面板。可接入 **QQAgent** 与 **DSH** 两个宿主，支持可插拔外部数据源，本地秒查、离线可用、定时保鲜。

藏海（canghai）是一份「知识图鉴」：把动漫 / 游戏 / 影视的名场面、角色设定、网络新梗收进本地，让聊天机器人**不联网也能秒查**「这是什么 / 他是谁」。它与记忆系统职责正交——**藏海答「是什么」，记忆答「聊过没有」**。

```
        外部数据源（GitHub 上的百科数据集）
                    │  定时 / 手动同步
                    ▼
        ┌───────────────────────┐
        │   藏海核心 (core)      │  ← 宿主无关，可 CLI 独立运行
        │  schema · search ·    │
        │  kb-store · sync      │
        └──────────┬────────────┘
          ┌────────┴────────┐
          ▼                 ▼
    QQAgent 适配器      DSH 适配器        ← 只负责「接线」，逻辑共用
   (setup(api))      (Cordis apply)
          │                 │
          ▼                 ▼
      查词工具 + 控制面板（二次元 UI，http://127.0.0.1:8792）
```

---

## 库内有什么（2429 条，随仓库发布）

clone 下来**即有数据**，无需先联网同步：

| 库 | 条数 | 内容 |
|---|---|---|
| `chime` | 1313 | CHIME 中文网络梗数据集（EMNLP 2025，MIT） |
| `anime-season` | 602 | 近三年新番表（中日英标题/开播/状态） |
| `genshin-roster` | 124 | 原神全角色（称号/元素/武器/命座/生日） |
| `fandom-game` | 75 | 游戏名场面与术语（MOBA/抽卡/魂系…） |
| `fandom-anime` | 73 | 动漫名场面（鬼灭/咒术/JOJO/宫崎骏…） |
| `game-hits` | 76 | 热门游戏角色机制（LOL/王者/CS/吃鸡/黑神话…） |
| `fandom-film` | 67 | 影视名场面（星战/漫威/让子弹飞/狂飙…） |
| `characters-core` | 38 | 核心角色人设（性格/外貌/背景） |
| `warhammer` | 27 | 战锤 40K 军团与势力（18 军团 + 8 势力） |
| `game-mihoyo` | 19 | 星穹铁道 + 崩坏3 角色 |
| `game-arknights` | 11 | 明日方舟角色与机制 |
| `seed` / `memes` | 2 + 38 | 人工种子与网络流行语 |

分布：**动漫约 700 + 游戏约 500 + 影视约 70 + 网络梗 1300+**。`data/seed/` 是人工精选（可自由编辑），`data/kb/` 是同步快照（`npm run sync` 刷新）。

---

## 1. 为什么它不与记忆系统冲突

这是设计前提，不是事后补丁。两个系统**数据、意图、时机都不同**：

| | 记忆系统（conversation-memory） | 藏海（canghai） |
|---|---|---|
| 存什么 | 发生过的对话、印象、事实 | 百科定义、梗、角色设定 |
| 回答 | 「我们上次聊过尼尔吗」「他说过什么」 | 「尼尔是什么」「钟离是谁」 |
| 算法 | 倒排索引 + TF-IDF/BM25 打分 | title 精确匹配 + 别名 + 子串打分 |
| 数据目录 | `memory-v2/` | `canghai/kb/`（**绝不交叉**） |

**硬边界（代码保证）**：
- 藏海只读写自己 `dataDir/kb/`，不 import、不触碰 `memory-v2/`。
- 两个工具各自注册，**描述里写死触发词**：藏海「是什么/是谁」，记忆「上次/之前/说过」。
- 若要将「藏海新收录的角色」写进记忆，那属于**写入**，走记忆的 `archive` 能力，不经藏海检索层。

---

## 2. 目录结构

```
canghai/
├─ index.js                  # 主入口 createEngine()（宿主/CLI 共用）
├─ cli.js                    # 独立 CLI：sync / search / stats
├─ server.js                 # 本地控制面板服务（默认 :8792）
├─ sources.config.json       # ★ 数据源声明式配置
├─ core/
│  ├─ schema.js              # ★ 数据格式约定 + 校验（数据契约）
│  ├─ search.js              # 检索引擎（精确优先）
│  ├─ kb-store.js            # 读 kb/*.json、按优先级去重、原子写
│  ├─ sync.js                # ★ 同步编排（不认识具体源）
│  ├─ errors.js              # ★ 异常分类 + 降级策略
│  └─ sources/               # ★ 可插拔数据源
│     ├─ contract.js         #   适配器接口约定
│     ├─ registry.js         #   按 config 动态加载适配器
│     ├─ local-file.js       #   本地 JSON（种子/兜底）
│     ├─ genshin-db.js       #   原神全角色
│     └─ anime-data.js       #   新番季度表
├─ adapters/
│  ├─ qqagent/               # QQAgent 版（skill.json + index.js, setup(api)）
│  └─ dsh/                   # DSH 版（Cordis apply(ctx)）
├─ panel/                    # 二次元控制面板（index.html + theme.css + app.js）
└─ data/
   ├─ seed/                  # 人工种子库（优先级最高）
   └─ kb/                    # 运行库（同步产物 + 种子落库）
```

---

## 3. 快速开始（不依赖任何宿主）

```bash
git clone <this-repo> canghai && cd canghai
node cli.js sync          # 从数据源拉取，写入 data/kb/
node cli.js search 钟离    # 本地秒查
node cli.js stats         # 看库统计
node server.js            # 起控制面板 → http://127.0.0.1:8792
```

零依赖，Node ≥ 20。首次 `sync` 需要联网（从 GitHub 拉数据）；之后检索**完全离线**。

---

## 4. 与两个宿主的对接

### 4.1 QQAgent 版

1. 把整个 `canghai/` 拷到 QQAgent 的 `plugins/canghai/`（`adapters/qqagent/` 里的 `skill.json` + `index.js` 即插件入口）。
2. 重启 / 热重载。插件注册工具 `canghai__lookup`，模型即可在聊天中查询。
3. 设置项（`skill.json.settings`）：`dataDir`、`lookupLimit`、`panelPort`、`autoSync`。
4. 面板：`node plugins/canghai/server.js`，或由宿主开内嵌窗口加载 `http://127.0.0.1:8792`。

**对接点**：`setup(api)` → `api.registerTool({id:'lookup', ...})`；可选 `api.registerCapability('knowledge.canghai')` 供其它插件软依赖。

### 4.2 DSH 版（可一键安装）

本仓库根 `package.json` 本身就是 DSH 插件包（`main` → `adapters/dsh/index.js`，`dsh.bundle.patch` → `cordis.patch.yml`），所以**整仓即可作为插件安装**：

```bash
# 桌面版
dsh plugin --profile desktop add github:Ice-Bearmax/canghai
# Web 版
dsh plugin --profile web add github:Ice-Bearmax/canghai
```

装完重启 DSH。插件会自动：

1. 首次启动若本地库为空 → **从包内 `data/seed` 灌入种子**（不联网、毫秒级，装完即可查）；
2. 随后后台跑一次全量同步（联网，失败不影响已可用的种子库）。

注册工具：`canghai_lookup`（查词）、`canghai_sync`（手动更新）。

环境变量：`CANGHAI_DATA_DIR`（数据目录）、`CANGHAI_LOOKUP_LIMIT`（返回条数）、`CANGHAI_NO_BG_SYNC=1`（关闭后台同步，纯离线）。

**与 QQ 机器人联动**：配合 [`dsh-qq-bot`](https://github.com/arrow1031-dev/dsh-qq-bot)（每个 QQ 会话一个 DSH Agent），藏海的 `canghai_lookup` 与它注册的工具同在一张全局工具表，群友提问时 agent 可直接调用，**无需改一行代码**。注意：QQ 访客若受工具白名单限制，需在 `dsh-qq-bot` 侧放行该工具；且同一 QQ 号不要同时连两个机器人（详见该插件 README）。

> 两版**共用同一个 `core/`**，只是接线方式不同。这就是「做两版」而不用维护两套逻辑。

---

## 5. 控制面板（二次元 UI）

统一设计系统（`panel/theme.css`）：深海配色（鲸蓝 `#4ea8de` / 柔光青 `#7fe3d4` / 浪花白）+ 圆润卡片 + 呼吸动效 + 楷体标题。改主题只改这一个文件。

| 页面 | 功能 | 主要操作路径 |
|---|---|---|
| **概览** | 总条目、来源文件数、启用源数、热门标签 | 打开即看 |
| **检索** | 输入词实时查，显示释义/别名/出处/来源/匹配度 | 输入 → 回车 |
| **数据源** | 各源开关状态、条目数、适配器 | 一览 + 后续可接开关 |
| **同步** | 一键全量同步，逐源显示条数/耗时/错误 | 点「同步全部」 |

API（`server.js`）：`GET /api/stats`、`GET /api/search?q=`、`GET /api/config`、`GET /api/schema`、`POST /api/sync`。

---

## 6. 数据格式约定（schema）

任何数据源归一化后都必须产出符合以下契约的 `entry`（`core/schema.js`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | ✅ | 图鉴项名字，检索主键 |
| `aliases` | string[] | | 别名/其他写法（命中权重仅次于 title） |
| `meaning` | string | | 是什么/什么意思 |
| `usage` | string | | 怎么用/例句 |
| `tone` | string | | 语气 |
| `era` | string | | 出处（作品/游戏） |
| `freshness` | enum | | `常用` / `偏旧` / `正热` |
| `tags` | string[] | | 分类标签 |

系统保留字段（数据源不得提供，会被丢弃）：`_source`、`_syncedAt`、`_generated`、`_target`。

`validateMany()` 会逐条校验：**坏的跳过并记录原因，好的留下**，产出同步报告。

---

## 7. 数据源接入与扩展（核心卖点）

### 7.1 配置项（`sources.config.json`）

```jsonc
{
  "version": 1,
  "sources": [
    {
      "id": "genshin",             // 唯一 id（也是落库文件名前缀）
      "adapter": "genshin-db",     // 对应 core/sources/genshin-db.js
      "enabled": true,             // false = 跳过
      "target": "genshin-roster.json",  // 写入 data/kb/ 的文件名
      "config": {                  // 覆盖适配器 configSpec 的默认值
        "maxCharacters": 0,
        "skipPlaceholder": true
      }
    }
  ]
}
```

`enabled:false` 即停用；`sources.local.json` 可覆盖同名项（本地实验不污染仓库）。

### 7.2 加一个数据源 = 3 步，**不改核心**

1. 在 `core/sources/` 新建 `my-source.js`，实现约定（见 `contract.js`）：

   ```js
   export default {
     id: 'my-source',
     label: '我的数据源',
     configSpec: { url: { type:'string', default:'', label:'地址' } },
     targetFile: 'my-source.json',
     async fetch(ctx) { /* 拉数据，失败 throw sourceError(ERR.*, ...) */ },
     normalize(raw) { /* → 符合 schema 的 entry[] */ }
   };
   ```

2. 在 `sources.config.json` 的 `sources[]` 加一项（`adapter: 'my-source'`）。
3. 跑 `node cli.js sync --only=my-source`。

`registry.js` 自动发现文件，`sync.js` 只认接口不认具体源 —— **新增/切换/停用数据源，核心逻辑一行不改**。

### 7.3 数据源接入的异常处理（`core/errors.js`）

| 错误码 | 场景 | 策略 |
|---|---|---|
| `NETWORK` | 超时/连不上 | **可重试**（退避重试） |
| `HTTP` 429/5xx | 限流/上游故障 | 可轻量重试，读 `Retry-After` |
| `HTTP` 401/403 | 鉴权/风控 | 不重试，跳过并报 `AUTH` |
| `PARSE` | 非 JSON/结构变了 | 不重试，多半上游改版 |
| `EMPTY` | 源正常但 0 条 | **不清空旧库**（除非确认真空） |
| `SCHEMA` | 条目不合约定 | 部分入库，其余记 rejected |

**铁律**：任何源失败都**保留旧库**，绝不让一次网络抖动把本地几千条清空。同步产出结构化报告（每源 ok/条数/耗时/错误），面板与 CLI 共用。

### 7.4 当前内置数据源

| 适配器 | 内容 | 上游更新 |
|---|---|---|
| `genshin-db` | 原神全角色（124+，含称号/元素/武器/命座/生日） | 随游戏版本 |
| `anime-data` | 新番季度表（中日英标题/开播/状态/Bangumi ID） | 每週一自动 |
| `local-file` | 本地 JSON 种子/兜底 | 手动 |

> ⚠️ 直连百科（Bangumi/维基/萌百/百度）在本机网络下均不可用（被墙/超时/需授权/反爬）。**正解是 GitHub 上已爬好的数据集**——本项目的两个远程源即如此。

---

## 8. 许可

MIT。数据来源遵循各自许可（genshin-db / anime-data 均为公开解析数据）。