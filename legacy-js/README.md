# LibSchedPay Web

> 校园书库学生助理排班 + 工时转账的纯前端工作台
>
> 基于 [Eyne66/LibSchedPay](https://github.com/Eyne66/LibSchedPay) 的 Python 核心算法，1:1 移植为 JavaScript。

## 它是什么

一个**纯静态、浏览器内运行**的小工作台。两件事：

1. **排班** — 填班次 + 人员 + 硬约束 → 脚本生成均衡草稿 → 人工校核 → 导出 Excel
2. **工时转账** — 实际工时 + 官方下发工时 → 差值自动算 → 配平 → 多种 Excel 导出

负责人填数据、脚本算数、人做决定。**所有计算在你手机本地完成，不上传任何数据**。

## 为什么有这个仓库

原项目 [Eyne66/LibSchedPay](https://github.com/Eyne66/LibSchedPay) 是 Python + 本地服务：

- 计算逻辑稳，**24/24 单元测试通过**
- 但 Python 服务不方便在手机/微信里直接打开
- 改成 JS 静态站后可以**直接部署到 CDN**，微信扫码就能用，零安装

本仓库是该 Python 项目的**纯前端等价实现**，**算法 1:1 移植**。

## 怎么"磨"出来的

不是一次写完，是 5 轮迭代，每轮解决一个真问题：

### v1 · 算法移植
- 完整移植 `schedule.py` → `schedule.js`（生成 + 校验）
- 完整移植 `settlement.py` → `settlement.js`（工时 + 配平）
- 整数百分位算术（`0.5h = 50`）避免浮点误差
- 用 SheetJS 浏览器内生成 XLSX（不依赖 openpyxl）
- **3 个单元测试 + 7 个集成测试**全部与 Python 端同输入对照，输出一致

### v2 · 可用化
- 响应式布局适配手机
- 部署到 `space.minimaxi.com` 跑通端到端
- 但字体/间距太基础，"看着像工程 demo，不像产品"

### v3 · 视觉重做
- 字体升级：Inter + Noto Sans SC
- 配色：zinc 灰 + 单一绿色强调（克制感）
- 圆角卡片 + 浅阴影 + hover 加深
- 等宽数字（`font-variant-numeric: tabular-nums`）
- 状态胶囊 pill（应收/应转出/无差额）
- 底部 toast 提示（不打断流程）
- 排版 = 32px 标题 / -0.02em 字距 / 字重 700

### v4 · 用户反馈
基于真实手机测试和反馈：

| 用户原话 | 改动 |
|---|---|
| "工时表格不支持 .xlsx" | SheetJS 解析 xlsx，自动找"姓名"+"实际工时"列 |
| "实际工时必须是整数" | `step="1"` + JS 强制剥小数 + 列标题写"实际工时（整数）" |
| "一键填入上限的 cap 不能固定 33" | 模块 A/B 都加可编辑 cap，双向同步 |
| "排班人员名单要支持 .xlsx 上传" | 人员输入框上方加"上传名单"入口 |
| "关于模块要简洁" | 重写为 GitHub 链接 + MiniMax agent 制作部署 |

### v5 · 移动端优化
最关键一版。**用 Pixel 5 真机（Android）测试**发现：

- 模块 B 重复出现日期字段 → 删除，只保留 cap
- 移动端 5 列挤在 ~360px 屏宽里，数字看不清
- 差值看不清 → 字号 22px + 红绿加粗
- 状态列在移动端冗余 → 隐藏（用差值正负代替）

最终移动端表格只有 4 列：`姓名 / 实际 / 官方下发 / 差值`（差值用大号彩色字）。

## 功能

### 排班
- 周期、班次、每日人数、当前人员、硬约束
- 实时显示"计划岗位 / 计划工时 / 平均每人"
- 按班岗时长分别平衡（2h / 3h 桶分别计数）
- 编辑草稿后重新校验
- 导出 Excel（2 sheet：排班表 + 记录）

### 工时
- **模块 A · 实际工时**：逐行录入 / 批量粘贴 / **上传 .xlsx 自动识别**
- **模块 B · 官方下发 + 配平**：一键填入上限 / 按实际填入 / 清空
- 差值、应收、应转出实时计算
- 转账表编辑（每行 `付款人|收款人|工时`）
- 校验配平 → 多种导出：核算草案 / 公示表 / 一览表 / 最终转账表

### 移动端特有
- 表格行高加大、输入框 16px 字号（避免 iOS 自动放大）
- 焦点输入框自动滚到视图中（避免键盘遮挡）
- 差值列移动端 22px 大字
- 隐藏 # 列和 状态 列，节省横向空间

## 快速开始

### 本地预览
```bash
cd webapp
python3 -m http.server 8765
# 打开 http://127.0.0.1:8765
```

或者用任何静态服务器（`npx serve` / `nginx` 等）。**不需要后端，不需要安装依赖**。

### 部署到 Cloudflare Pages
1. 把代码推到 GitHub 仓库（已包含本仓库）
2. Cloudflare dashboard → Workers & Pages → Create → Pages
3. Connect to Git → 选本仓库
4. Framework preset: **None**
5. Build command: 留空
6. Build output directory: **`/`**
7. Save and Deploy

部署完访问 `https://<project-name>.pages.dev`。

## 项目结构

```
webapp/
├── index.html      # 入口（包含新手引导 modal、3 个 tab）
├── style.css       # 全部样式（变量、组件、响应式）
├── app.js          # UI 逻辑（onboarding、tabs、场景、上传、Excel 导出）
├── schedule.js     # 排班算法（移植自 schedule.py）
├── settlement.js   # 工时算法（移植自 settlement.py，整数百分位算术）
├── xlsx.full.min.js # SheetJS v0.18.5（离线）
└── favicon.svg
```

总共 6 个文件 + 1 个 README，**~1.0 MB**（其中 882 KB 是 SheetJS）。

## 算法一致性保证

`schedule.js` 和 `settlement.js` 是从 Python 逐行移植的，关键差异：

| 项 | Python | JS |
|---|---|---|
| 浮点精度 | `decimal.Decimal` | 整数百分位（0.5h = 50）|
| 错误抛出 | `ScheduleValidationError` | `Error` |
| 字典/列表 | `dict`/`list` | `Object`/`Array` |
| 输入解析 | `str` | `String` |

**验证方法**：用 `examples/schedule_input.json` 和 `examples/settlement_input.json`（原 Python 仓库里的）作为输入，两端都跑，结果的 `totals` 和 `transfers` 完全一致。

## 数据与隐私

- **所有计算在浏览器本地完成**
- **不上传任何数据到服务器**
- 输入数据保存在 `localStorage`（仅"不再提示新手引导"这个开关）
- 导出文件直接由浏览器 `URL.createObjectURL` 下载

**所以可以放心输入真实学生姓名/工时**（虽然建议用示例数据先熟悉）。

## 已知限制（与原 Python 版相同）

- **按总工时平均的分配模式**：原 Python 版就有 edge case bug，本仓库**直接砍掉**，只保留"按班岗时长分别平均"
- **软偏好**（"尽量和某人一起""优先晚班"）：不在算法内，留给人工校核
- **贪心算法的局限**：硬约束多时会有不平衡，需要在草稿阶段人工调
- **不计算时薪/金额/银行转账**：单位是工时

## 资源

- 原 Python 项目：https://github.com/Eyne66/LibSchedPay
- 原 README：https://github.com/Eyne66/LibSchedPay/blob/main/README.md
- 业务需求与决策：https://github.com/Eyne66/LibSchedPay/blob/main/业务需求与决策记录.md

## 许可

沿用原 Python 仓库的"暂未加 license"状态。
