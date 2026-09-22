# Lovely Composer MCP

[![CI](https://github.com/baichuan4167-lang/lovely-composer-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/baichuan4167-lang/lovely-composer-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

一个 [MCP](https://modelcontextprotocol.io) server，让 AI agent 直接在你电脑上的
**[Lovely Composer](https://store.steampowered.com/app/1604480/Lovely_Composer/)** 里作曲。

零依赖的 Node.js stdio server，通过读写 Lovely Composer 的 `.jsonl` 工程文件工作。
agent 可以新建歌曲、写旋律 / 贝斯 / 鼓 / 和弦、改速度与循环点，你在 Lovely Composer
里打开文件夹就能听到、编辑、导出。

*[English README](README.md)*

## 为什么用这种方式

驱动 GUI 很脆：窗口焦点、时序、你同时在用电脑，都会互相干扰。而 Lovely Composer
把一首曲子存成两行 JSON，所以这个 server 直接改数据：

- 不做 GUI 自动化，不抢焦点，不影响你正常用电脑；
- agent 拿到的是精确、可检查的数据模型，而不是像素；
- 它写出的文件就是 Lovely Composer 自己写的那种文件 —— 见[验证](#验证)一节。

## 环境要求

- Node.js 18 或更新（需要带 CJK 编解码器的 `TextDecoder`）。
- 已安装 Lovely Composer。会自动在常见 Steam 目录和 `Documents\LovelyComposer`
  下探测；也可以用 `LC_MUSIC_ROOT` 指定。

## 安装

克隆到任意位置，让你的 MCP 客户端指向 `src/server.js` 即可。

```bash
git clone https://github.com/baichuan4167-lang/lovely-composer-mcp.git
cd lovely-composer-mcp
node test/smoke.js     # 可选：先确认在你这台机器上能跑通
```

不需要 `npm install` —— 这个 server 没有任何依赖。

### 通用 MCP 客户端配置

多数客户端的 stdio server 配置块是一样的：

```json
{
  "mcpServers": {
    "lovelycomposer": {
      "command": "node",
      "args": ["/绝对路径/lovely-composer-mcp/src/server.js"]
    }
  }
}
```

Claude Desktop 写在 `claude_desktop_config.json` 里。有些宿主还会加 `cwd` 和
`failOnStartupError`，在这里都无害。

### 环境变量

| 变量 | 使用方 | 作用 |
|---|---|---|
| `LC_MUSIC_ROOT` | server | 强制指定曲库根目录，跳过自动探测。 |
| `LC_MCP_PROTOCOL_VERSION` | server | 固定协商用的 MCP 协议版本（默认 `2025-06-18`）。 |
| `LC_SAMPLE_PATH` | `test/smoke.js` | 指向一个真实 `.jsonl` 用于集成检查。 |
| `LC_APP_DIR` | `tools/*.py` | 指向 `<LovelyComposer>/app`，供下面的校验脚本使用。 |

然后直接对 agent 说：

> 用 Lovely Composer 帮我写一首 16 小节的 8-bit 循环曲，A 小调，要有旋律、贝斯和鼓

> 读一下 DSH 文件夹里的 00 号曲，把第 2 页的旋律改高八度

## 工具

| 工具 | 作用 |
|---|---|
| `lc_status` | 报告安装路径、曲库根目录、是否可写、数据模型。建议第一个调用。 |
| `lc_list_folders` | 列出曲库里的歌曲文件夹。 |
| `lc_list_songs` | 列出某文件夹的歌曲（标题 / 速度 / 页数 / 各通道音符数）。 |
| `lc_read_song` | 读取歌曲，按页输出紧凑 pattern 文本。 |
| `lc_create_song` | 新建空歌曲（自动补齐新文件夹所需的 `lcdata.jsonl`）。 |
| `lc_write_page` | **主力工具**：用一个 pattern 字符串写满某通道的某一页。 |
| `lc_set_notes` | 按精确 `(通道, 页, tick)` 放置音符，支持和弦轨。 |
| `lc_clear_pages` | 清空指定通道 / 页。 |
| `lc_set_song_options` | 改标题、作者、速度、页数、每页 tick 数、循环点、音阶。 |
| `lc_list_instruments` | 列出全部乐器预设、效果字母、音阶表。 |
| `lc_copy_song` | 复制歌曲（可用于以现成曲子为模板）。 |
| `lc_delete_song` | 删除歌曲文件，需 `force=true`。 |

### Pattern 字符串语法

`lc_write_page` 每行一个 token，对应 tick 0 起，每页最多 32 个 tick：

```
C5@25 . . E5 . G5@25 . . - . . .     C5 用 25 号乐器；. 空拍；- 延音
```

| 写法 | 含义 |
|---|---|
| `.` / `R` | 空拍 |
| `-` | 延音（接上一个音符） |
| `<` / `>` | 延音 + 淡入 / 淡出 |
| `C4` | 音符（用本页的默认乐器） |
| `C4@25` | 音符 + 25 号乐器预设 |
| `C4@flute` | 乐器也可以写名字 |
| `C4@16*7+D^A~8%3` | 追加 音量`*`0-7、效果`+`、表情`^`0-F、声像`~`0-F、包络`%`0-F |
| `C4:S4NC00::2` | 直接用 LC 原生 voice 字符串 |

**常用乐器预设**（完整表用 `lc_list_instruments`）：
`0` 脉冲波 · `1` 三角波 · `2` 方波 · `3` 噪声 · `4` 钢琴 · `7` 鼓 · `16` 锯齿 ·
`25` 长笛 · `30` 重踏(底鼓) · `33` 拳击(军鼓) · `35` 短频噪声(踩镲) ·
`47` 低共振三角(贝斯) · `56` 铃 · `68` 快速琶音。

**效果字母**：`N`无 · `S`滑音 · `V`颤音 · `F`淡出 · `I`淡入 · `D`下落 · `H`跳跃 ·
`A`快速琶音 · `P`移相 等。

## 数据模型

一首曲子是一个文件夹条目 `<曲库>/<文件夹>/<NN>.jsonl`（NN = 00..99）：

- **5 个通道**：0–3 旋律声部，4 = 和弦轨
- 每首歌 `pages` 页，每页最多 **32 tick**
- 每页可单独设长度（`ticksPerPage`）与速度
- 默认 `barsPerPage=4`，即每页 4 小节、每小节 8 tick
- 音高用科学音高记号，`C4` = 中央 C，可用音域 A0–C8
- 速度：`bpm = 900 × barsPerPage / speed`，**speed 越小曲子越快**。
  `speed=30, bars=4` → 120 BPM

和弦轨的音符用 LC 的和弦编码：
`id = ((类型 + 力度<<4 + 七音<<6 + 九音<<8) << 16) + 65536`，
类型 1=major 2=minor 3=sus4 4=aug 5=dim。`lc_set_notes` 里直接写
`chord: "minor"` 即可。

## ⚠️ Lovely Composer 保存时会重写整个文件夹

这一条比本文档其它任何内容都重要：

- LC 启动时读取整个文件夹，保存时**重写全部 100 个歌曲文件**。写完曲子后要在 LC 里
  **重新载入文件夹**（或重启 LC）才看得到。
- 如果 LC 正开着这个文件夹，**先别在 LC 里按保存**，否则会覆盖 agent 刚写的文件。
- 被 LC 标记为写保护的曲子（`write_protected_flag`，自带样本曲都是），本 server
  默认拒绝覆盖，需要显式传 `force=true`。

## 文件格式（逆向结果）

序列化就是 dataclass 的 `__dict__` 直接 dump，带类名标签：

```json
{"__LCVoice__": true, "n": 60, "t": 1, "v": 4, "f": 0, "id": 2, "x": 12, "p": 0, "e": 0}
```

`n`=音高（null=空，-1=休止） `t`=振荡器 `v`=音量0-7 `f`=效果 `id`=乐器预设
`x`=表情 `p`=声像 `e`=包络。

**`__LCVoice__` 这个标签必须在第一个键**：LC 的 `json_loader_hook` 会遍历 dict，
用第一个能匹配已知类名的键来重建对象；缺了标签就会退化成普通 dict，LC 随后用属性
访问就会出错。

歌曲文件正好两行（CRLF，第二行后无换行，与 LC 自己写的一致）：

```
{"__LCMusicDataHeader__": true, ...}
{"__LCMusic__": true, "speed":…, "channels":{…}, "rhythms":{…}, …}
```

LC 加载时会先构造默认实例再把 dict 合并上去，**因此省略的键会保留 LC 自己的默认值** ——
本实现只写真正需要的键，波表 / 采样调制器等由 LC 自己补默认值，避免写错。

结构层级：`LCMusic` → `LCChannelList.channels[5]` → `LCSoundList.sl[pages]` →
`LCSound.vl[32]` → `LCVoice`。

### ⚠️ 编码：LC 用系统 ANSI 代码页读文件，不是 UTF-8

LC 读写工程用的是 `open(path)`，**没指定 encoding**，所以走 Python 的 locale 默认
编码 —— 在中文 Windows 上是 **GBK/cp936**（日文系统是 cp932）。

后果：如果文件里直接写了 UTF-8 的中文标题，LC 会抛 `UnicodeDecodeError`，
`load_music()` 返回失败，**歌曲根本打不开**。这个坑很隐蔽，因为 LC 自带的样本曲
标题全是 ASCII，不会暴露。

本实现的处理：

- **写出**：所有非 ASCII 字符转义成 `\uXXXX`，文件是**纯 ASCII**。纯 ASCII 在
  GBK 和 UTF-8 下解码结果完全一致，所以任何语言的系统都能读。
- **读入**：先按严格 UTF-8 解码；失败则依次回退 GB18030 / GBK / Big5 / Shift_JIS，
  取第一个能被 `JSON.parse` 成功解析的结果（因为 LC 保存时会把中文写成 GBK 原始字节）。

### 速度与网格：`barsPerPage` 决定 BPM 和精度

`bpm = 900 × barsPerPage / speed`，而一页固定播 `ticksPerPage` 个 tick。所以
**改 `barsPerPage` 会同时改变 BPM 和每小节的可编辑精度**：

| barsPerPage | ticksPerPage | 每小节 tick | 最细音符 | 想要的 BPM → speed |
|---|---|---|---|---|
| 4（默认） | 32 | 8 | 八分音符 | 120 → 30 |
| 2 | 32 | 16 | 十六分音符 | 180 → 10 |
| **1** | 32 | 32 | **三十二分音符** | **180 → 5** |

想做 J-core / denpa 那种十六分音符跑动，用 `barsPerPage=1, ticksPerPage=32`，
此时 **一页就是一小时小节**，1 tick = 32 分音符。

乐器预设参数来自游戏源码 `app/lcl/common.py` 的 `VOICE_STR_LIST`（经 LC 自己的
表达式 / 声像后处理），并已用真实工程文件逐项核对。

## 验证

「它写出的文件是真正的 Lovely Composer 文件」这件事，是用游戏自己的代码验证的，
而不是只用本项目的解析器：

```powershell
$py = "<LovelyComposer>\app\python\python.exe"

# 完整校验：类型、容器、LC 编码器往返
& $py -u tools/validate_with_lc.py "<曲库>\DSH\01.jsonl"

# 逐阶段复现 load_music()，和 LC 自带样本曲对照
& $py -u tools/diagnose_load.py "<曲库>\DSH\01.jsonl"
```

不设 `LC_APP_DIR` 时会搜索常见的 Steam 目录；如果你的安装位置特殊，把它设为
`<LovelyComposer>\app`。

`diagnose_load.py` 会打印 LC 打开歌曲的每一个阶段。生成的曲子和 LC 自带样本曲
走到完全相同的阶段：

```
[1] read+parse            OK  header=LCMusicDataHeader music=LCMusic title='…'
[2] trim channels         OK  5 remain
[3] version check         OK  16 <= 16
[4] _old_lcmusic_data_updater  OK
[5] model usable          OK  pages=48 speed=5 bpm=181 notes=2158
[6] set_wave_memory_from_lcmusic_settings ... (doxel 音频层，需要游戏目录可写)
```

> 第 6 步会打断进程：doxel 必须把日志写进游戏安装目录，受限沙箱下会 `os._exit`。
> 这与数据格式无关 —— LC 自己的样本曲在同样环境下也停在这里。

## 附带的示范曲

用本 server 写成的两首曲子（在作者的曲库里放在 `DSH` 文件夹）：

| 编号 | 曲名 | 说明 |
|---|---|---|
| `00` | Neon Loop | 8 小节入门循环，A 小调，旋律 / 贝斯 / 鼓 / 和弦轨 |
| `01` | 配信中毒 - STREAM OVERDOSE | 48 小节完整作品，180 BPM，F# 小调，denpa / J-core 风格，2158 个音符 |

`compositions/stream-overdose.js` 可以重新生成第二首。

## 开发

```bash
node test/smoke.js            # 36 项自测：往返、编码回退、DSL
node test/demo-song.js        # 用工具接口编一首示范曲到 .tmp-test/DEMO
node test/demo-song.js DSH 1  # 直接写进真实曲库的 DSH 文件夹 1 号位
node src/server.js < test/protocol-probe.jsonl   # 跑一遍 JSON-RPC 协议层
```

自测覆盖音名换算、乐器表、和弦编码、pattern DSL、完整歌曲往返、写保护以及 GBK
回退。当机器上装了真实的 Lovely Composer 时，还会对游戏自己写的曲子做一次往返；
没有安装时会静默跳过，所以 CI 一直是绿的。

## 文件说明

| 文件 | 说明 |
|---|---|
| `src/lc.js` | 格式引擎：常量、音名 / 乐器 / 和弦换算、pattern 解析、工程文件读写与编码处理 |
| `src/tools.js` | 12 个 MCP 工具的定义与实现 |
| `src/server.js` | stdio JSON-RPC MCP server（零依赖，手写协议层） |
| `compositions/stream-overdose.js` | 完整作品生成脚本（denpa / J-core，48 小节 / 2158 音符） |
| `test/smoke.js` | 自测套件 |
| `test/demo-song.js` | 示范作曲脚本（走工具接口） |
| `test/protocol-probe.jsonl` | 协议层探测请求 |
| `tools/validate_with_lc.py` | 用游戏自带 `lcl` 做真实性校验 |
| `tools/diagnose_load.py` | 逐阶段复现 LC 的 `load_music()` |
| `tools/lcenv.py` | 定位游戏安装目录，供校验脚本 `import lcl` |
| `tools/check-encoding.js` | 检查曲库里有没有非 ASCII 字节的文件 |
| `tools/analyze_lc.py` | 逆向期间用的工程文件结构分析器 |

## 已知限制

- **只能写工程文件，不能触发导出**。要 WAV / MIDI 请在 LC 里导出，或在 LC 里配置
  addon 自动导出。
- 不驱动 LC 的图形界面，也就不依赖窗口焦点、不怕你同时在用电脑。
- 波表（wave memory）与采样调制器参数由 LC 补默认值，本 MCP 不编辑它们。
- 节奏轨（`rhythms`）使用 LC 新建歌曲时的默认值，未暴露编辑接口。

## 授权

[MIT](LICENSE)
