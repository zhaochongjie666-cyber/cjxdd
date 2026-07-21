# Dynamic Tools

这是一个独立的 pi 插件。它先注册两个基础工具：

- `write_tool`：让 AI 把新工具写到**本插件的 `tools/` 目录**；
- `read_tool`：列出或读取 `tools/` 中已有工具，让 AI 能再次读取和修改。

`tools/` 由插件实时监听。无论新文件来自 `write_tool` 还是外部编辑器，
插件都会动态 `import()` 并调用 `pi.registerTool()`，新工具立即出现在当前
coding agent 会话中，可以直接调用，不需要重启程序。

每次加载和执行动态工具都在独立 Node.js 子进程中完成，并设置内存、执行时间和
输出大小上限。动态工具即使调用 `process.exit()`、抛出未捕获异常或陷入死循环，
插件也只会终止隔离子进程并向 AI 返回错误，不会退出或卡死 coding agent 主程序。

默认目录就是 `extensions/dynamic-tools/tools/`。测试或特殊部署可使用
`XDD_DYNAMIC_TOOLS_DIR` 覆盖，但插件绝不会写当前项目的 `.pi/`。

## Pi Coding 怎么使用

### 1. 安装一次插件

在仓库根目录执行：

```bash
./install.sh
```

这会把本仓库的 `extensions/` 链接到 `~/.pi/agent/extensions`。新启动的 Pi
会根据 `extensions/package.json` 自动加载本插件。如果 Pi 已经打开，执行一次
`/reload`；这一步只用于首次安装或更新插件本身，以后新增动态工具不需要 reload。

### 2. 直接用自然语言让 Pi 创建并调用工具

例如对 Pi 说：

```text
请用 write_tool 创建一个统计文本单词数的工具 word_count，创建成功后立即用它统计：hello dynamic tools
```

Pi 的实际调用链是：

1. 调用 `write_tool`，传入 `file: "word-count.mjs"` 和完整 ESM `source`；
2. 插件把文件写入自身 `tools/`，隔离检查后调用 `pi.registerTool()`；
3. 下一次模型调用会看到模块 `name` 声明的新工具（例如 `word_count`）；
4. Pi 直接调用 `word_count`，不重启会话。

要查看或修改以前生成的工具，可以说：

```text
先用 read_tool 列出已有动态工具，再读取 word-count.mjs，把它改成同时统计字符数和单词数。
```

不传 `file` 时 `read_tool` 返回文件清单；传入 `file` 时返回完整源码。修改时再调用
`write_tool` 覆盖同名文件，文件监听器会把新版工具热注册到当前会话。

### 3. 也可以从编辑器直接添加

用户可以直接在 `extensions/dynamic-tools/tools/` 创建符合下方格式的 `.mjs` 文件。
正在运行的 Pi 会监听这个目录并自动注册工具。若文件校验或加载失败，Pi 会显示错误通知，
而不会把无效工具注册为可调用工具。

模块格式：

```js
export default {
  name: "word_count",
  label: "Word Count",
  description: "统计文本中的单词数",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  execute({ text }) {
    return { words: text.trim() ? text.trim().split(/\\s+/).length : 0 };
  },
};
```

> 动态 `.mjs` 与普通 pi 扩展一样拥有本机代码执行权限，只应写入和加载可信代码。
