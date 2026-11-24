# 生物信息学与计算生物学 · 课程问答

[打开课程问答](https://zhichao-chang.github.io/bioinformatics-course-chat/)

页面提供课程示例、多轮对话和浏览器本地历史。使用实时问答时，由课程组织者发放课堂访问码。学生的实时提问会发送给 DeepSeek。

## 项目结构

- `site/` 是 GitHub Pages 发布目录，直接使用 HTML、CSS 和 JavaScript。
- `worker/` 是 DeepSeek 转发服务，只接受课堂页面提交的文本对话和服务端配置的访问码。
- `wrangler.toml` 配置来源和请求频率。每个来源 IP 每分钟最多 15 次请求，每次最多 1,200 个输出 token。

## 接入实时问答

1. 在 Cloudflare Workers 部署仓库根目录的 `wrangler.toml`。
2. 在 Worker 的 Secrets 中设置 `DEEPSEEK_API_KEY` 和 `CLASS_ACCESS_CODE`。前者为课程专用 DeepSeek API 密钥，后者为独立生成并仅发给学生的课堂访问码。两者都只保存在 Worker 的秘密变量中。
3. 将 Worker 的完整 HTTPS 请求地址（含 `/chat`）填入 `site/config.js` 的 `chatEndpoint`，推送后由 GitHub Actions 更新网页。空地址时提供预置课程示例。

模型使用 `deepseek-flash`，对话回复以 SSE 流式返回。若要暂停实时服务，可在 Worker 禁用课程密钥或把 `chatEndpoint` 清空后重新发布。
