# AgriTwin 外部情报工作台

独立静态网站，展示真实公开农业资料、Kimi 摘要及逐条出处。无导航栏，左侧情报列表、中间梁子湖区域卫星影像、右侧证据和使用限制。内部地块、塘口、生产批次、传感器保持 N/A。

## 数据与操作

页面优先读取 AgriTwin-Intelligence 的 `public/external/latest.json`，失败时使用 `public/data/showcase.json` 并显示快照日期。新模型结果由情报仓库 Actions 生成，浏览器不存储密钥或调用模型。

分类/搜索筛选资料；选择条目查看原文、摘要、证据短引、采集时间与版本哈希；“加入简报”组成当前会话的选编并导出 Markdown。“生成简报”打开引擎 Actions，由用户手动启动。来源面板显示成功和失败原因。

地图使用真实 Esri World Imagery 卫星/航空影像，署名保持可见；影像非实时，拍摄时间因区域而异。114.625,30.1417 是梁子湖区范围推算中点，非农场定位、田塘边界或已核实中心。Open-Meteo 是区域气象模型，不是现场监测，也不代替尚未接通的和风官方预警。

## 本地与部署

Node.js 24；无第三方运行依赖。

```sh
npm test
npm run build
npm run serve -- --port 4190
```

`scripts/export-engine.mjs` 只复制同级引擎仓库已验证的真实公开结果，不生成样例。

Pages 选择 GitHub Actions，工作流测试、构建后仅上传 `dist/` 的四份允许文件。无需网站 Secrets。日期、引用、失败状态、私有字段和典型密钥格式均有发布前检查。

页面：[No1dry.github.io/AgriTwin-Showcase](https://No1dry.github.io/AgriTwin-Showcase/)。部署是否完成以 Actions 结果为准。

详细运行验收与对话文档统一归档在 [情报仓库 docs/conversation-archive](https://github.com/No1dry/AgriTwin-Intelligence/tree/main/docs/conversation-archive)。
