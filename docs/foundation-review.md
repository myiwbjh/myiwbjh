# Khayrat 基础功能审查与验收

本轮在现有 `myiwbjh/myiwbjh` 仓库中改进基础流程。没有创建仓库或云端项目，没有执行生产部署、数据库迁移、生产写入或删除。

## 架构和现状

| 环节 | 已有实现 | 本轮发现和修复 |
|---|---|---|
| Vercel | 静态页面、公开配置端点、可选 OCR/视觉代理 | PDF.js/worker/字库和 Auth SDK 改为构建时同源托管，固定依赖及 lockfile，使用兼容浏览器的 legacy PDF.js 构建 |
| 登录 | 邮箱 Magic Link + sessionStorage access token | 原实现不保存刷新令牌、不续期；改为 Supabase SDK 恢复会话、续期、验证用户和显式退出；禁止自动注册 |
| 解析 | CSV/XLSX、内置 PDF 解析、CDN PDF.js 文本 | PDF.js 先于降级解析，按页提取文字与位置；解码 JPEG/Flate 图片为 PNG；重复字段、非法日期/数值标记复核；设备状态不再混入施工状态 |
| 存储 | reports / images / imports IndexedDB、Supabase REST 和私有 Storage | 原文件回溯路径、图片 report_id、批次重试、稳定 ID 校验、基于文件 SHA-256 的图片 ID、重复导入不覆盖旧图片关联、云端读取和非覆盖合并；本机模式保留原文件和图像 |
| 表单 | 手工录入、历史查询与编辑 | 修复 reset 回调循环清空表单；增加施工内容；已登录的手工保存写入云端并明确失败状态 |
| 分析 | 工程量、人员、WBS 进度、停工证据 | 增加最近两份日报对比；缺失/冲突人数不再填零或取最大值，未报告人数不作为无人施工证据 |

数据库沿用 `daily_reports.payload`、`image_evidence.payload` 和 `import_audits`，本轮没有新增生产列或修改 RLS。启动只读取云端，不自动上传旧文件。云端记录合并保留已有本地版本，同一 ID 的多人编辑冲突暂不自动覆盖。

## 统一数据模型 v2

保持现有字段名以兼容旧数据，不把旧字段改名或删除。

| 语义 | 字段 | 未报告时 |
|---|---|---|
| 报告日期 / 车间 / 工序 | date / workshop / process | 空字符串，并列入 reviewFields |
| 施工内容 | constructionContent | 空字符串，fieldStatus=not-reported |
| 当日 / 累计工程量与单位 | dailyConcrete / cumulativeConcrete / workUnit | 数值 null；单位不明不进行量差比较 |
| 中方 / 属地人数及口径 | chineseStaff / localStaff / staffScope | 数值 null；口径不明不汇总为项目人数 |
| 设备状态 / 存在问题 / 施工状态 | equipmentStatus / risk / status | 空字符串，不能当作没有问题或状态正常 |
| 来源 | sourceFile / pageNumber / sourceRow / sourceExcerpt / provenance | 不推测页码或日期；保留原文 |
| 原文件 | originalObjectPath 或 originalFileId | 已登录保存私有云端路径；离线保存 IndexedDB Blob |
| 质量标识 | schemaVersion / fieldStatus / reviewFields / needsReview | reported 仅表示日报有明确记载，不代表工程事实已审核 |

PDF 字段映射支持中英文标签。复杂自由叙述、跨页/合并单元格表格和一页多车间的重复标签不保证自动拆分；重复字段明确标记歧义，并保留全文供人工核对。扫描件没有已配置且获用户授权的 OCR 时不编造文字。图片邻近文字分类仍是推断，不能代替像素识别或施工验收。

## 连续两份日报对比规则

默认取最近两个已报告日期，可手动选择。按车间、工序、活动编号和设备匹配，不用每日变化的原文作为匹配条件。双方任意缺失、同活动多条记录或关键字段未确认时进入待复核。

- 人数变化只在相同明确口径下计算；人数增加本身不证明施工改善。
- 工程量变化只比较相同明确单位；累计量下降要求核对修订或口径。
- 施工状态、实际进度、当日工程量有明确一致变化信号时标为改善/恶化；信号冲突时待复核。
- 没有变化信号时可以标为无变化，但同时展示未报告字段和不可比较的原因。
- 中间缺失日期不推断停工。两份日报不是长期停工结论，双方文件名、页码、原文始终保留。

## 验证范围

自动化测试使用明确标注的合成 PDF：两页中英文文本、两张 JPEG、两张 Flate 压缩像素图。Chromium 真实执行 SDK、PDF.js、Canvas、文件上传控件、页面和 IndexedDB；Auth/Storage/PostgREST 响应使用隔离测试替身，外部网络请求被测试拦截，不使用生产令牌。

隔离测试覆盖登录邮件请求和回跳参数、回调会话恢复、令牌刷新、退出、文字/4 张图片提取、原文件与来源、私有文件请求、三张表 payload 保存、部分上传/数据库失败重试、不覆盖重复导入、刷新恢复、手工云端保存及双日报对比。数据库真实 RLS 和事务行为不能由这些接口替身证明。

生产只读检查（2026-10-03）：配置端点 HTTP 200，Supabase URL/公开 key 已配置，authRequired=true，OCR/视觉服务未启用；三张表 RLS=true，已有策略限制已批准邮箱及项目，文件桶 public=false；三张业务表 count=0。查询未修改任何数据。

## 本轮实际测试结果

- `npm run check`：54 项单元/集成测试通过，0 失败；入口脚本语法检查通过。
- `npm run test:e2e`：10 项真实 Chromium 测试通过，0 失败；运行生产构建目录。
- `npm run build`：通过，SDK/PDF.js/worker/CMaps/font/wasm 均从本项目同源提供。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- `git diff --check`：通过；变更文件的实际 JWT、Supabase secret key 和 GitHub token 模式扫描为 0。
- 本地运行环境：Node 24.19.0、Chromium 140；CI 配置使用 Node 22，目前本地结果不代表 GitHub CI 已执行通过。
- 生产邮件送达、真实获准账号会话、真实 Supabase/Postgres 写入和真实工程日报识别准确率：未验收，不能记为通过。

## 合并前人工确认

1. 在经过批准的隔离 Supabase 环境邀请测试用户，核对 Email Provider、Site URL 与 Redirect URLs，然后验证真实邮件送达、登录和 Storage/三张表写入。当前没有执行这一步，也未触发生产邮件登录。
2. 由工程人员选取脱敏真实日报核对车间、工序、工程量单位、人员口径、复杂表格、图片位置以及不确定字段。合成 PDF 通过不等于真实工程日报识别准确率达标。
3. 运行环境应为 Node.js 22.13+；PR 指定 Node 22.x，CI 使用 Node 22。首次使用新版需要重新验证邮箱，旧 access-token-only 会话不迁移成长期会话。
4. 生产存在更严格的权限，历史 `supabase/schema.sql` 范围过宽，不要重新执行。访问成员或权限如需调整，必须另行批准，本 PR 没有修改 SQL。
5. REST 的三次 upsert 不是跨表原子事务。失败保留批次并以稳定 ID 重试；生产端需要真实故障验收。不自动删除已上传对象，避免丢失证据；取消失败批次可能留下未引用的对象。
6. 图片人工标签编辑目前仍保存到本机；JSON 备份包含轻量元数据，原始文件/图像需从私有云端或本机文件库另行保留。多人冲突处理和跨设备标签同步需后续单独设计。
7. 本 PR 只提交，不合并、不提升 Preview、不部署 Production。批准基础流程真实验收后，再规划进度与关键路径模块；关键路径需要 WBS 基准、活动逻辑关系、工期及日历，不能从日报单独编造。
