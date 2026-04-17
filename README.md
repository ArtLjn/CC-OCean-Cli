# Ocean CLI - 增强版 Claude 命令行工具
> 支持多AI提供商接入、一键模型切换的智能开发助手


## ✨ 核心特性

### 🎯 多模型提供商支持
- 原生支持 Claude 系列模型 (Opus/Sonnet/Haiku)
- 兼容第三方自定义模型 API 接入（智谱GLM、豆包、DeepSeek等）
- 一键 `/model` 命令切换模型提供商，无需手动修改配置
- 智能过载重试机制，自动处理API限流和超时问题

![多模型切换界面](./static/img.png)
*一键切换10+不同提供商的AI模型，支持价格展示和上下文长度说明*

### 🎨 海洋深蓝主题
- 全新设计的海洋深蓝UI主题，视觉舒适
- 优化的终端显示效果，支持代码高亮和格式化
- 响应式布局，适配不同终端尺寸

### 🔧 增强开发功能
- **智能Commit命令**：自动检测代码变更，生成符合Conventional Commits规范的提交信息
- **多Agent协作**：内置多种专业Agent，处理复杂任务、代码审查、架构设计等场景
- **技能扩展系统**：支持安装自定义技能，扩展CLI功能
- **会话持久化**：自动保存会话上下文，支持断点续接和工作交接

## 🚀 快速开始

### 安装
```bash
# 克隆项目
git clone https://github.com/your-repo/ocean-cli.git
cd ocean-cli

# 安装依赖
bun install

# 构建
./build.sh
```

### 基础使用
```bash
# 启动Ocean CLI
./ocean

# 切换模型
/model claude-opus-4-6

# 查看帮助
/help
```

## 📦 功能亮点

### 自定义模型接入
在项目根目录创建 `custom-providers.json` 文件，按照以下格式配置第三方模型提供商：

```json
{
  "provider-id": {
    "name": "提供商显示名称",
    "type": "anthropic", // 兼容Anthropic API格式的提供商使用此类型
    "baseUrl": "API端点地址",
    "apiKeyEnv": "API密钥或环境变量名",
    "models": [
      { "id": "模型ID", "name": "模型显示名称", "contextLength": 上下文长度 },
      { "id": "模型ID2", "name": "模型显示名称2", "contextLength": 上下文长度 }
    ]
  }
}
```

#### 配置示例：
```json
{
  "glm": {
    "name": "智谱GLM",
    "type": "anthropic",
    "baseUrl": "https://open.bigmodel.cn/api/anthropic",
    "apiKeyEnv": "你的智谱API密钥",
    "models": [
      { "id": "glm-5-turbo", "name": "GLM-5 Turbo", "contextLength": 128000 },
      { "id": "glm-5", "name": "GLM-5", "contextLength": 128000 }
    ]
  },
  "vk": {
    "name": "火山云",
    "type": "anthropic",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
    "apiKeyEnv": "你的火山云API密钥",
    "models": [
      { "id": "doubao-seed-2.0-pro", "name": "Doubao Seed 2.0 Pro", "contextLength": 128000 },
      { "id": "deepseek-v3.2", "name": "DeepSeek V3.2", "contextLength": 128000 }
    ]
  }
}
```

### 智能重试机制
- 自动识别API过载错误，指数退避重试
- 无固定重试次数限制，直到请求成功或手动终止
- 友好的错误提示，帮助定位问题

### Commit命令增强
```bash
# 自动生成规范的commit信息
/commit

# 自定义提交信息
/commit "feat: 添加新功能"
```

## 🛠 开发指南

### 项目结构
```
├── src/                 # 主源码目录
│   ├── agents/          # Agent实现
│   ├── skills/          # 技能系统
│   ├── providers/       # 模型提供商接入
│   └── cli/             # 命令行界面
├── docs/                # 文档
├── shims/               # 兼容性垫片
├── vendor/              # 第三方依赖
└── static/              # 静态资源
```

### 构建项目
```bash
# 开发模式
bun dev

# 生产构建
./build.sh

# 运行测试
bun test
```

## 🤝 贡献指南

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'feat: 添加一些很棒的功能'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📝 更新日志

### v1.0.0
- ✅ 完整品牌重命名为 Ocean CLI，采用海洋深蓝主题
- ✅ 支持第三方自定义模型API兼容性增强
- ✅ 增强commit命令功能，自动生成规范提交信息
- ✅ 实现自定义提供商过载重试机制
- ✅ 优化重试逻辑和错误提示
- ✅ 移除不必要的重试次数限制，提升可用性

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 🙏 致谢

- 感谢 Anthropic 提供的 Claude API
- 感谢开源社区的贡献者们

---

**Ocean CLI - 让AI开发更高效，更顺畅** 🚀

