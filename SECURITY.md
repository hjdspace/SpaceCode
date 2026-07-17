# 安全策略

## 支持的版本

SpaceCode 目前处于快速迭代阶段，仅对最新版本提供安全更新支持。

| 版本 | 支持状态 |
|------|----------|
| 0.6.x | ✅ 支持 |
| < 0.6.0 | ❌ 不支持 |

## 报告漏洞

如果你发现安全漏洞，**请不要在 GitHub Issues 中公开报告**。

请通过以下方式私下报告：

1. 发送邮件至：`hjdspace1990@gmail.com`
2. 邮件标题以 `[SECURITY]` 开头
3. 邮件内容包含：
   - 漏洞的详细描述
   - 复现步骤
   - 影响范围评估
   - 建议的修复方案（如有）

### 响应时间

- **确认收到**：3 个工作日内
- **初步评估**：7 个工作日内
- **修复发布**：根据严重程度，30 天内发布补丁版本

### 披露政策

- 漏洞修复并发布新版本后，我们会在 GitHub Security Advisories 中公开致谢
- 如你希望匿名，请在报告中说明
- 在修复发布前，请勿公开讨论漏洞细节

## 安全相关注意事项

### API Key 与凭据

- SpaceCode 在本地 `~/.spacecode/profiles.json` 中存储 API Key，文件权限设置为 `0600`（仅用户可读写）
- API Key 在 UI 中默认掩码显示（如 `sk-****abcd`），仅在编辑模式下完整可见
- **不要**在 Issue、PR、截图或日志中泄露你的 API Key
- 如怀疑 Key 泄露，请立即在服务商后台撤销并重新生成

### Electron 安全模型

- 渲染进程通过 `preload.ts` 的 `contextBridge` 暴露受控的 IPC API，**不暴露** Node.js 能力
- 主进程校验所有来自渲染进程的参数
- WebView 与 Markdown 渲染启用 XSS 过滤（DOMPurify）

### 第三方依赖

- 项目依赖定期更新，关注 [ Dependabot ](https://github.com/hjdspace/SpaceCode/security/dependabot) 报告
- 内置 cua-driver、browser-use 等外部二进制，均从官方源下载并校验

### 远程访问

- 移动端配套与 H5 远程访问功能默认仅监听本机网络
- 在公共网络启用远程访问前，请确保已配置强认证

## 联系方式

- 安全邮箱：`hjdspace1990@gmail.com`
- 一般问题：[GitHub Issues](https://github.com/hjdspace/SpaceCode/issues)
