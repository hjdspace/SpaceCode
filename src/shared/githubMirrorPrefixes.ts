/**
 * GitHub 加速镜像前缀列表（国内访问 GitHub Releases 慢时按顺序回退）。
 * 镜像通过在原始 GitHub URL 前添加前缀来代理请求，RTK 与语音模型下载共用这一份。
 */
export const GITHUB_MIRROR_PREFIXES = ['https://gh-proxy.com/', 'https://ghproxy.net/']
