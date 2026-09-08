# 设计来源与实现记录

- 文件：[ai](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai?node-id=1-400)
- 节点：`1:400`，`App / Task panel`
- 读取日期：2026-09-09；使用云端 Figma MCP 读取设计上下文、节点元数据和变量。
- 尺寸：420 × 580；Header 48px + Divider 1px；内容上边距 64px；Footer 112px；Composer 388 × 88。
- 字体：Inter，标题 18px/24px 500，标签 14px/20px 500，正文 14px/20px 400。
- 表面：`#13171e` / 72%；正文 `#fafafa`；次要文字 `#c2c7d1`；抬升表面白色 6%；悬停白色 12%；细边框白色 14%；圆角 22px。
- 描边采用设计的 subtle border 变量，与返回截图的视觉强度对齐。

Figma 导出的五个 SVG 以原始字节下载到 `apps/desktop/src/assets`。原始下载映射见 [design-assets.json](design-assets.json)，运行时不依赖有时效的 Figma 资源地址。

设计中的图标来自 [Hugeicons](https://github.com/hugeicons/hugeicons)，MIT 许可：`clock-01`、`settings-01`、`cancel-01`、`add-01`、`arrow-up-02`。设计标注的源版本为 `b2462ece29de25fff2cc716da4452d6ada210c7e`；许可文本保存在 [third-party/Hugeicons-LICENSE](third-party/Hugeicons-LICENSE)。Inter 由 `@fontsource-variable/inter` 本地提供，随包保留 SIL OFL 许可。

默认面板完整复现给定节点。历史列表、任务详情、设置页、存储失败反馈和窄窗口适配属于为使 UI 可用而补充的交互状态，沿用相同主题，不宣称来自其他 Figma 节点。

`task-panel.png` 是真实 Electron 生产构建的窗口截图。macOS 的原生 vibrancy 叠加桌面内容，实际颜色和阴影会受背景影响。
