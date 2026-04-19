# Ocean CLI 快速开始教程

> 本教程帮助你从零开始安装、构建并使用 Ocean CLI，涵盖基础操作和核心功能。

---

## 前置条件

- **操作系统**：macOS（Apple Silicon 或 Intel）
- **运行时**：[Bun](https://bun.sh/) >= 1.3.5
- **C 编译器**：系统自带 `cc`（Xcode Command Line Tools）

检查 Bun 是否已安装：

```bash
bun --version
# 应输出 >= 1.3.5
```

如果未安装 Bun：

```bash
curl -fsSL https://bun.sh/install | bash
```

---

## 1. 安装依赖

克隆项目并安装 npm 依赖：

```bash
cd /path/to/cluade-bak
bun install
```

依赖安装完成后，`node_modules/` 目录会被创建。

---

## 2. 构建项目

运行构建脚本，完成打包和部署：

```bash
./build.sh
```

构建脚本会依次执行以下步骤：

1. **清理缓存** — 移除旧的 `ocean.bundle.js`
2. **打包 JS bundle** — 使用 Bun 打包 `src/dev-entry.ts` 为单文件
3. **编译 C 启动器** — 编译 `clmg_launcher.c` 为 `ocean` 可执行文件
4. **部署** — 将 bundle 和 Bun runtime 复制到 `~/.local/bin/`
5. **修复 sharp libvips 路径** — 确保图片处理库可用
6. **签名** — macOS 代码签名

构建完成后，`ocean` 命令位于 `~/.local/bin/ocean`。

---

## 3. 首次启动

进入任意项目目录，启动 Ocean CLI：

```bash
cd ~/my-project
ocean
```

首次启动时会看到欢迎界面和输入提示。你可以直接输入问题或指令。

---

## 4. 基础使用示例

### 提问

直接输入自然语言问题：

```
> 这个项目的目录结构是什么？
> 解释一下 src/main.tsx 的作用
```

### 代码编辑

Ocean CLI 可以直接读写和编辑代码文件：

```
> 把 src/utils/helpers.ts 中的 formatDate 函数改为支持时区参数
> 在 tests/ 目录下为 helpers.ts 添加单元测试
```

### Git 操作

通过 Bash 工具执行 git 命令：

```
> 查看当前的 git 状态
> 创建一个新分支 feat/add-export，并提交当前改动
> 查看最近的 5 条 commit 记录
```

---

## 5. 切换模型

使用 `/model` 命令在交互界面中切换模型：

```
> /model
```

会弹出一个模型选择列表，包含：

- **Claude 官方模型**（如 Opus、Sonnet、Haiku）
- **自定义 Provider 模型**（如果已配置 `~/.claude/custom-providers.json`）

选择后立即生效，后续对话使用新模型。

也可以通过环境变量临时切换：

```bash
ANTHROPIC_MODEL=claude-sonnet-4-6 ocean
```

自定义 Provider 的详细配置方法请参考 [自定义模型接入教程](tutorial-custom-providers.md)。

---

## 6. Auto Mode 使用

Auto Mode 允许 Ocean CLI 自主执行操作，无需逐步确认权限。适合可信环境下的自动化任务。

### 启用方式

```bash
ocean --permission-mode auto
```

或者使用等效的环境变量：

```bash
CLAUDE_CODE_PERMISSION_MODE=auto ocean
```

### 使用场景

- **CI/CD 环境**：在自动化流水线中执行代码审查、测试、部署
- **批量操作**：批量重构代码、批量修改文件
- **远程执行**：配合 Channel 系统通过 IM 远程控制

### 注意事项

- Auto Mode 会自动批准文件读写、Bash 命令等操作
- 仅在可信环境中使用，避免在生产环境或敏感项目中使用
- 可通过 `--permission-mode ask` 恢复交互式确认模式

---

## 常用命令速查

| 操作 | 命令 |
|------|------|
| 启动 | `ocean` |
| 指定模型启动 | `ANTHROPIC_MODEL=xxx ocean` |
| Auto 模式 | `ocean --permission-mode auto` |
| 切换模型 | `/model` |
| 查看记忆 | `/mem list` |
| 多模型协作 | `/multi-agent <问题>` |
| 查看技能 | `/skills` |
| 退出 | `Ctrl+C` 或 `/exit` |

---

## 下一步

- [自定义模型接入教程](tutorial-custom-providers.md) — 接入智谱GLM、DeepSeek 等模型
- [记忆系统教程](tutorial-memory.md) — 理解和使用双层记忆系统
- [多模型协作教程](tutorial-multi-agent.md) — 多个模型并行协作解决问题
