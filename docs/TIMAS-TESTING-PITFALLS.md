# xdd Tmux + m2cc 端到端测试踩坑记录

> 本文件记录在 `/tmp/test-xdd-product-s` 上用 tmux 启 `m2cc` 测 xdd 6 Phase 实际跑通时遇到的坑.
> 用于避免下次重复踩. 2026-06-08.

---

## 坑 1: `m2cc` 是 bash function, 不是 binary

**症状**:
```bash
$ which m2cc
$ (空)
$ type m2cc
bash: type: m2cc: not found
```

**原因**: `m2cc` 是 `~/.bashrc` 里的 bash function, 不是 `/usr/bin/` 下的可执行文件.

```bash
m2cc() {
    export ANTHROPIC_BASE_URL="https://api.minimaxi.com/anthropic"
    export ANTHROPIC_AUTH_TOKEN="sk-cp-..."
    export ANTHROPIC_MODEL="MiniMax-M3[1m]"
    # ...
    claude --permission-mode bypassPermissions $@
}
```

**解决**:
- `bash -lc '...'` 不 source `~/.bashrc` (因为是 -c 一次性命令, 不是 -i 交互)
- 必须显式 `source ~/.bashrc`, 且要在**同一个 shell** 执行 m2cc
- tmux send-keys 多次发命令, 但每条命令在新的 sub-shell, m2cc function 不会继承

**正确做法**:
```bash
# 一次性: 在 tmux 里用 source + 同一行调用
tmux send-keys -t xdd-test "bash -lc 'source ~/.bashrc && m2cc \"请用 xdd-walker 给我做一个登录系统\"'" Enter

# 或: 直接用 -i (interactive) 启动 bash
tmux send-keys -t xdd-test "bash -li" Enter
sleep 2
tmux send-keys -t xdd-test "m2cc" Enter
```

---

## 坑 2: `m2cc --version` 不透传

**症状**:
```bash
$ m2cc --version
# claude 启动 REPL, 报 "Unknown command: --version" 或类似
```

**原因**: m2cc 直接 `claude --permission-mode bypassPermissions $@`, 第一个参数被 claude 当 command 解析, 不是给 m2cc 的 flag.

**解决**: 别用 `--version` 测 m2cc 存在. 改测:
```bash
# 测 m2cc function 存在 (不实际启 Claude)
type m2cc | head -1

# 测 claude binary 存在
which claude && claude --version

# 直接启 m2cc 看 prompt 出现 (最快判断)
m2cc <<< "" | head -5   # 或: timeout 5 m2cc
```

---

## 坑 3: tmux 启动后需 sleep 等 m2cc 启动 + SessionStart hook

**症状**:
```bash
tmux new-session -d -s xdd-test
tmux send-keys "m2cc" Enter
sleep 2
tmux capture-pane    # 还是 shell prompt, claude 还没启
```

**原因**:
- m2cc = `claude --permission-mode bypassPermissions`, 启动要 3-5s
- Claude Code 启动后, `SessionStart` hook 触发, 跑 xdd-gate-session-start.sh
- hook 输出要等 m2cc 完整 prompt 出来 (输入框 `>`) 才算 ready

**解决**:
```bash
# 等到 m2cc prompt `>` 出现
tmux send-keys -t xdd-test "m2cc" Enter
for i in {1..30}; do
    sleep 1
    if tmux capture-pane -p -t xdd-test | tail -5 | grep -q "^>"; then
        echo "m2cc ready after ${i}s"
        break
    fi
done
```

---

## 坑 4: tmux capture-pane 输出不刷新

**症状**:
```bash
tmux send-keys "m2cc" Enter
sleep 5
tmux capture-pane -p -t xdd-test
# 还是空 / 旧内容
```

**原因**: tmux 的 pane 内容按 alternate screen 缓存, `capture-pane` 不一定拿最新.

**解决**:
```bash
# 加 -S - 参数 (start line, 负数表倒数 N 行)
tmux capture-pane -p -t xdd-test -S -50

# 或: 直接 attach 看 (Ctrl+B D 退出)
tmux attach -t xdd-test

# 或: 用 script 命令捕获 m2cc 输出
script -q -c "m2cc" /tmp/m2cc.log
```

---

## 坑 5: xdd install 不会自动 source ~/.bashrc

**症状**:
```bash
./install-to-claude-code.sh
ls ~/.claude/hooks/xdd-gate-*.sh  # 16 个软链
# 但: m2cc 在新 tmux 会话里找不到 (因为 m2cc 是 bash function, 装 xdd 不动 ~/.bashrc)
```

**原因**: install-to-claude-code.sh 只装软链, 不动 shell 配置.

**解决**: xdd install + m2cc bash function 各自独立, 互不影响. m2cc 已在 `~/.bashrc` 里. 装 xdd 不需要碰 m2cc.

---

## 坑 6: SessionStart hook 在 m2cc 启动后才跑, 不是 tmux 创建后

**症状**:
```bash
tmux new-session -d -s xdd-test -c /tmp/test-xdd-product-s
tmux send-keys "m2cc" Enter
# 等 m2cc prompt 出现
tmux send-keys "请用 xdd-walker" Enter
# 期望: xdd-gate-session-start.sh 跑, 注入项目上下文
# 实际: 第一次进 m2cc 时, 启动消息 + 第一次 user input 才触发 SessionStart
```

**原因**: Claude Code `SessionStart` 事件是 m2cc 启 Claude Code 客户端时触发, 不是 tmux 创建会话.

**解决**: 等到 m2cc 完整启动 (见坑 3), 第一次 user input 会触发 SessionStart. 之后所有 user input 触发 `UserPromptSubmit` hook, 装 skill 触发 `PreToolUse` hook.

---

## 坑 7: demo 目录必须在 xdd-gate-meta.sh 旁路之外

**症状**: 跑 xdd 在 `/tmp/test-xdd-product-s` 失败, m2cc 说"未检测到 .xdd/".

**原因**: 
- `/tmp/test-xdd-product-s/.xdd/` 存在 (我们创建的)
- 但 tmux 启动 m2cc 时, m2cc CWD 是 `/tmp/test-xdd-product-s`
- xdd-gate-session-start.sh 找 `.xdd/`, 应该能找到

**解决**: 验证
```bash
cd /tmp/test-xdd-product-s
ls .xdd/iterations/iter-1/pipeline/status.md
# 应该存在
```

如果还失败, 检查:
- `xdd-gate-session-start.sh` 是否有 Meta 旁路 (它会跳过, 不输出)
- `/tmp/test-xdd-product-s/.xdd/xdd-version` 是否存在

---

## 坑 8: m2cc 配 MiniMax 模型可能拒收某些 hook 输出

**症状**:
- hook 输出 `"[shadow] ⚠️ ..."` 旧字符串, 模型报 "content filter triggered" / 输出被截断
- 或 hook 输出含 "exploit/vulnerability/CVE" 关键词, 触发教学悖论

**解决**: 
- 我们已经清理完所有 shadow 引用 + trigger 词 (commit `cb2e198` + `71be08d` + 之前几次)
- 跑 `grep -rE "\b(exploit|vulnerability|attack|malware|shellcode|0day|CVE)\b" skills/` 应该是 0 命中
- 跑 `grep -rn "\[shadow\]" hooks/ plugins/` 应该是 0 命中

---

## 坑 9: tmux send-keys 字符串转义

**症状**:
```bash
tmux send-keys "请用 xdd-walker 给我做一个登录系统" Enter
# 期望: m2cc 收到完整 prompt
# 实际: 中途断 (因为 send-keys 按键发送, 某些字符如 `/` 触发补全)
```

**解决**:
```bash
# 把命令存到文件, 让 m2cc 从文件读
cat > /tmp/xdd-prompt.txt <<'EOF'
请用 xdd-walker subagent 给我做一个登录系统
EOF
tmux send-keys -t xdd-test "m2cc < /tmp/xdd-prompt.txt" Enter
# 缺点: m2cc REPL 模式下从 stdin 读可能不工作, 试:
tmux send-keys -t xdd-test "cat /tmp/xdd-prompt.txt | xargs -I{} m2cc \"{}\"" Enter
# 更简单: tmux load-buffer + paste-buffer
tmux load-buffer /tmp/xdd-prompt.txt
tmux paste-buffer -t xdd-test
tmux send-keys -t xdd-test Enter
```

---

## 坑 10: 安装 xdd 后旧 hook 还在 (没装到 .claude/)

**症状**:
```bash
tmux send-keys "m2cc" Enter
# m2cc 加载 Claude Code, SessionStart hook 跑
# 期望: xdd-gate-session-start.sh 输出当前 stage context
# 实际: 没输出 (因为 ~/.claude/settings.json 没指到新 hook)
```

**原因**: 没跑 `./install-to-claude-code.sh`, 或 install 失败.

**解决**:
```bash
# 1. 验证
ls ~/.claude/hooks/ | grep xdd-gate
# 应该有 16 个软链

# 2. 验证 settings.json
grep "xdd-gate" ~/.claude/settings.json
# 应该有 5 个 hook 注册

# 3. 如果没装, 跑 install
cd /home/zhaocj/ws/cjxdd
./install-to-claude-code.sh
```

---

## 坑 11: 测完想复盘 → 去 `~/.claude/<session-id>/` 找原始记录

**症状**: 测完 xdd 流程, 想知道:
- m2cc 实际跑了哪 6 Phase
- 哪个 skill 装了几次 (auto-mark DOING 时机)
- hook 警告触发了多少次
- 模型卡在哪 / 哪里重试过

**解决**: Claude Code 把每次 session 持久化到 `~/.claude/<session-id>/` 目录:

```bash
# 1. 找最近 session (按 mtime 排序)
ls -t ~/.claude/ | grep -E "^[a-f0-9-]{36}$" | head -5

# 2. 进 session 目录, 看完整对话
cd ~/.claude/<session-id>/
ls
# 通常有: .jsonl (对话日志) + 其他元数据

# 3. 用 jq 抽用户输入 (测试时跑的命令)
cat *.jsonl 2>/dev/null | jq -r 'select(.type == "user") | .message.content' | tail -20

# 4. 抽 Assistant 输出 (看模型实际答了什么)
cat *.jsonl 2>/dev/null | jq -r 'select(.type == "assistant") | .message.content[]?.text' | tail -30

# 5. 抽 tool calls (看实际跑了哪些 skill/写文件/读文件)
cat *.jsonl 2>/dev/null | jq -r '.message.content[]? | select(.type == "tool_use") | .name' | sort | uniq -c

# 6. 抽 hook 警告 (m2cc 输出里 [xdd] ⚠️ 开头的)
cat *.jsonl 2>/dev/null | grep -oE '\[xdd\] ⚠️.*' | sort | uniq -c
```

**常用复盘维度**:

| 问题 | 复盘命令 |
|------|---------|
| m2cc 真的调了 walker 吗？ | `grep -E '"subagent_type".*xdd-walker\|xdd-walker-pi"' ~/.claude/<sid>/*.jsonl` |
| 6 Phase 哪几个跳过了？ | `grep -oE 'Phase [0-9.]+ [A-Z]+\b' ~/.claude/<sid>/*.jsonl \| sort -u` |
| Skill 装载次数 | `jq -r 'select(.message.content[]?.name \| test("xdd-")) \| .message.content[].name' ~/.claude/<sid>/*.jsonl \| sort \| uniq -c` |
| Hook 阻止了几次 (exit 2)? | `grep -c 'exit code: 2\|❌ HARD BLOCK' ~/.claude/<sid>/*.jsonl` |
| 5 段 stop-gate 警告 (drift / pending / stub)? | `grep -c '\[xdd\] ⚠️\|DRIFT:' ~/.claude/<sid>/*.jsonl` |
| 是否写到产物 (.xdd/bdd/, .xdd/L0-research/)? | `jq -r '.message.content[]? \| select(.type == "tool_use" and .name == "Write") \| .input.file_path' ~/.claude/<sid>/*.jsonl \| grep ".xdd/"` |
| 模型卡在哪? (重复 user message) | `jq -r 'select(.type == "user") \| .message.content' ~/.claude/<sid>/*.jsonl \| sort \| uniq -c \| sort -rn` |

**示例复盘流程**:
```bash
# 假设 session-id 是 abc-123
SID=~/.claude/abc-123

# 1. 总交互轮数
echo "轮数: $(jq -r '.type' $SID/*.jsonl | grep -c user)"

# 2. 写的 xdd 产物
jq -r '.message.content[]? | select(.type == "tool_use" and .name == "Write") | .input.file_path' $SID/*.jsonl | grep ".xdd/" | sort -u

# 3. 阻止的次数 (Phase 跳序 / L0 未做等)
echo "硬阻断: $(grep -c '❌ HARD BLOCK' $SID/*.jsonl)"

# 4. L5 drift 检测
echo "L5 drift: $(grep -c 'L5 Stage Drift\|DRIFT:' $SID/*.jsonl)"

# 5. 3 试 HALT 触发
echo "HALT 触发: $(grep -c 'HALT' $SID/*.jsonl)"
```

**保留 vs 清理**:
- ✅ 测试成功的 session: 保留, 作教学 / regression 对照
- ❌ 反复重试没用的 session: 删 `rm -rf ~/.claude/<bad-sid>`, 避免占空间

---

## 测试前的预检清单

跑 m2cc 测 xdd 之前, 在 `/tmp/test-xdd-product-s` 跑:

```bash
# 1. m2cc function 存在
type m2cc | head -1
# 期望: m2cc is a function

# 2. m2cc 配 MiniMax (调 m2cc 看 env 注入)
bash -lc 'm2cc() { env | grep -E "ANTHROPIC|MiniMax"; }; m2cc'
# 期望: ANTHROPIC_BASE_URL=api.minimaxi.com, ANTHROPIC_MODEL=MiniMax-M3[1m]

# 3. xdd 装到 Claude Code
ls ~/.claude/hooks/xdd-gate-*.sh | wc -l
# 期望: 16

# 4. demo 完整
ls /tmp/test-xdd-product-s/.xdd/iterations/iter-1/pipeline/status.md
ls /tmp/test-xdd-product-s/.xdd/{xdd-version,current-iteration,scale.md,bdd/,core/}
# 都应该存在

# 5. 11 hook 在 demo 里正常工作
cd /tmp/test-xdd-product-s
echo '{}' | bash ~/.claude/hooks/xdd-gate-session-start.sh | head -5
# 期望: 注入 project_root, active_iter, pipeline state

# 6. trigger 词 0 命中 + 无 shadow 残留
grep -rE "\b(exploit|vulnerability|attack|malware|shellcode|0day|CVE)\b" /home/zhaocj/ws/cjxdd/skills/ 2>/dev/null | wc -l
# 期望: 0
grep -rn "\[shadow\]" /home/zhaocj/ws/cjxdd/hooks/ /home/zhaocj/ws/cjxdd/plugins/ 2>/dev/null | wc -l
# 期望: 0
```

全部通过再开 tmux 跑 m2cc.
