# Glossary — workflow 通用语言

> 术语的唯一源。spec 的 RXX、architecture 的决策、代码的命名都要用这里的词,1:1 一致。
> 未知项标「待确认」,绝不私自造词。

## 核心概念

| 术语 | 含义 | 备注 |
|---|---|---|
| **节点(node)** | workflow 图里的一个执行单元,对应一个 xdd skill 调用 | 字段:name/skill/output_doc/model/extra/gate |
| **边(edge)** | 节点间的连接,两种类型 | next(前进)/ loop(回退) |
| **next 边** | 拓扑序前进,源节点的所有 next 上游都 done 才跑目标 | 实线 |
| **loop 边(回退边)** | 源节点 done 后,若 condition 满足则把目标及下游重置 pending 重跑 | 虚线,做循环 |
| **gate(验收闸)** | 节点跑完后统计产出文档的自检清单,判通过/未过 | condition=gate_fail 用它 |
| **自检清单** | skill 产出文档末尾的检查项,`□` 未完成 / `- [x]`/`☑` 已完成 | gate 据此判 |
| **业务线(BXX)** | DDD 限界上下文,workflow 有 B01-cli / B02-web | slug 用 BXX-kebab |
| **iter(迭代)** | xdd 的工作轮次,`runs/iter-N/` 单轮工作区,design/ 跨轮保留 | current-iteration 指针 |
| **节点定义(node spec)** | 一个节点"调哪个 skill、产出落哪、用什么模型、prompt 注入什么"的描述 | build_nodes / graph.json |

## 模型/执行术语

| 术语 | 含义 |
|---|---|
| **claude CLI** | workflow 调用的 AI 编程工具,`claude -p --output-format stream-json` |
| **stream-json** | claude 的流式输出格式,逐行 JSON,parser_msg 归一化 |
| **models.yaml** | 每个模型的 env 配置(API key/base_url),不入库 |
| **SSE** | Server-Sent Events,Web 端实时推送节点事件给浏览器 |
| **run_id** | 一次 Web 执行的句柄,SSE 订阅用 |

## 状态术语

| 术语 | 含义 |
|---|---|
| **idle / running / passed / failed** | 节点的四种执行状态 |
| **pending / done** | 图引擎里节点的调度状态 |
| **force** | 忽略已有产出全重跑的开关 |

## 缩写

- **RXX**:spec 规则编号(R01, R02...),代码用 `@implements RXX` 回指
- **GXX**:goal 编号,项目级高层目标
- **TXX**:plan task 编号,文件内独立
- **FXX**:failure mode 编号(resilience)
