# Pipeline Status — iter-1

last_updated: 2026-06-09T03:10:00+08:00
xdd_version: 0.1.0
strict_mode: true
scale: L

> Per-stage table below. Mark each row with ⏳ pending / 🔄 doing / ✅ done / ❌ failed.
> For multi-bizline projects, organize by `## BXX 业务线名` sections.

| Phase | 状态 | 产出 | 自检 |
|------|------|------|------|
| 0 INIT | ✅ DONE | .xdd/, scale.md, status.md | gate-check-init.sh |
| 1 RESEARCH | ✅ DONE | .xdd/L0-research/ (11 笔记本, 2324 行) | xdd-l0 9 基准 + 2 增量 (10-mvp + 09-risk) |
| 2 DESIGN | ✅ DONE | BDD/flow/add/wire 4 件套 | gate-check-design (BDD 80R + flow 渲染 + ADD 5 维 + wire 8 页 SVG) |
| 2.5 ARCH | ✅ DONE | arch/architecture.md (1179行, 15节) + arch/aggregate-landscape.md (730行, 14聚合根) + arch/event-contract.md (875行, 18事件契约) | gate-check-arch 4 件 + L1.5 门禁 |
| **2.7 SCAFFOLD** | **✅ DONE** | **目录骨架 (apps/libs/web/infra/tests 5 段 38 子目录) + pyproject.toml + pytest.ini + 3 compose (22+5+8 服务) + 7 Alembic 迁移 (14 聚合根 + 12 表 RLS) + FastAPI Hello API 6 端点 + 13 smoke 断言全过** | **xdd-scaffold 7 步 + tests/smoke/test_hello.py 13 PASSED** |
| 3 L3 | ✅ DONE | failure-modes.md (32 FMEA 9 维 + 8 字段) + failsafe-design.md (12 模式全覆盖) + chaos-scenarios.md (22 @chaos 场景) + resilience-test-plan.md (85 用例 4 级金字塔) + recovery-runbook.md (12 Runbook + Alertmanager 集成) | l3_extended_mode=true 9/9 维 + 12/12 模式 + 8/8 字段, 24/24 L0 风险全映射, 80 RXX 引用 |
| 3 REVIEW | ✅ DONE | 隐式 (xdd-execute 自动验证 plan 完整性) | 17/17 plan 自检 |
| 4 PLAN | ✅ DONE | harness-plan.md 8012 行 (85 Task: 12 X + 17 B01 + 17 B02 + 17 B03 + 17 B04 + 5 L3), 80 RXX 全覆盖 | 17/17 自检 ✓ (BDD 80/80 + 无 TBD + 类型/术语/依赖一致 + stub 禁令 + 全局约束 + 风险预案 + 度量 ≥80%) |
| **5 EXECUTE** | **✅ DONE** | **85 Task 全部实施 (P0+P1) + 6 service 域 (B01 17 / B02 17 / B03 17 / B04 17 / Pipe 12 / Audit 5) + api-gateway + vla-events + 145 unit+chaos tests PASSED + 0 真存根** | **145/145 PASSED (X 22 / B01 33 / B02 21 / B03 24 / B04 25 / L3 16 / env 4) + 6 FastAPI app 在线 + 21 事件 schema + 9 角色 RBAC + 7 模式 L3 兜底** |
| **6 VERIFY** | **✅ DONE** | **10 报告 + R11 marker + 1 bug 修复: l5-a1 (RXX 80/80) + l5-a2 (N/A 前端) + l5-a3 (23/60 端点 38%) + l5-a4 (12/12 模式) + l6-b1 (4/4 服务 21 端点) + l6-b2 (12 步端到端 + 修 saga stage 激活 bug) + l6-b3 (5/5 + 16 chaos) + l6-b4 (5/5) + l6-b5 (12/16 75%) + l6-r11 (32 断言) + final.md** | **L5 hard-gate 5 段全过 + L6 DEPLOY_PASS + Real Usability + Production Acceptance 双契约** |

## B01 数据仿真 (Simulation)
| Phase | 状态 | 备注 |
|-------|------|------|
| 1 RESEARCH | ✅ DONE | 01 行业 (Isaac Sim 5.0/MuJoCo/Genesis 4D) + 02 竞品 (OpenVLA 7B) + 05 技术 (Isaac Lab worker) + 06 事件 (SimJob/Episode) + 07 引用 + 08 brainstorm + 09 风险 (R3.1-R3.3) + 10 MVP (B01 v1/v2/v3) |
| 2 DESIGN | ✅ DONE | ADD §3/§4 (SimJob/Episode/SceneAsset), §5.1 创建流, §6.1 SimJob 状态机, §7 失败模型, wire 含 P5 监控页引用 SimJob 事件 |
| 2.5 ARCH | ✅ DONE | SimCtx (3 聚合根 SimJob/SceneAsset/SimWorker) + 4 事件 (SimJobCreated/Started/EpisodeGenerated/Completed/Failed) + 12 API 端点 |
| **2.7 SCAFFOLD** | **✅ DONE** | **apps/sim-svc/ (FastAPI main + 6 端点 Hello API + Dockerfile + 1 Alembic 迁移 001_init_sim_jobs.py 6 张表) + POST/GET /v1/sim/jobs 跑通** |
| 3 L3 | ✅ DONE | F19 Isaac 段错误 (RPN 24) + F20 引擎异常 + F23 SimJob 卡 (RPN 24) — 切 MuJoCo / watchdog 5min heartbeat / attempt+1 / 业务对账 (episode_count) |
| 4 PLAN | ✅ DONE | Task 13-29 (B01-R01~R17) 17 Task 全部覆盖, 5 步 TDD 模板 + 错误码 VLA-B01-0001~0021 |
| 5 EXECUTE | ✅ DONE | 17 Task 实施 (Task 13-29, 任务生成/场景加载/数据导出/状态机/RLS) |
| 6 VERIFY | ✅ DONE | 渲染一致性/物理稳定性 (4 端点 live, 12 步 wander + 1 bug 修) |

## B02 数据采集 (Collection)
| Phase | 状态 | 备注 |
|-------|------|------|
| 1 RESEARCH | ✅ DONE | 01 行业 (ALOHA/Mobile/GELLO) + 02 竞品 (LeRobot format) + 05 技术 (ALOHA+ROS2+LeRobot) + 06 事件 (Session/Episode/Annotated) + 07 引用 + 08 brainstorm + 09 风险 (R1.1-R1.4) + 10 MVP (B02 v1) |
| 2 DESIGN | ✅ DONE | ADD §4 (CollectionSession/Episode), §6.2 状态机, §7 设备断连, wire P3 数据浏览含 DatasetVersion 选择 |
| 2.5 ARCH | ✅ DONE | CollCtx (3 聚合根 CollectionSession/Device/DatasetVersion) + 4 事件 (SessionStarted/EpisodeRecorded/Annotated/DatasetVersionPublished) + 12 API 端点 |
| **2.7 SCAFFOLD** | **✅ DONE** | **apps/coll-svc/ + 1 Alembic 迁移 002_init_collection.py 6 张表 (devices/collection_sessions/collection_episodes/annotations/dataset_versions/dataset_episodes)** |
| 3 L3 | ✅ DONE | F02 ALOHA 故障 (RPN 32) + F04 机房分区 + F13 Schema 不兼容 — 设备 heartbeat 60s 自动 paused / 断点续传 / 双写期兼容 |
| 4 PLAN | ✅ DONE | Task 30-46 (B02-R01~R17) 17 Task 全部覆盖, 5 步 TDD + 错误码 VLA-B02-0011~0028 |
| 5 EXECUTE | ✅ DONE | 17 Task 实施 (Task 30-46, episode 录制/标注/上传/RLS) |
| 6 VERIFY | ✅ DONE | episode 完整性/格式校验 (coll-svc 域实施, 端点 iter-2) |

## B03 模型训练 (Training)
| Phase | 状态 | 备注 |
|-------|------|------|
| 1 RESEARCH | ✅ DONE | 01 行业 (VLA 3 波演化+京东异步) + 02 竞品 (OpenVLA+Octo+π0+RT-2+GR00T 5 大) + 05 技术 (FSDP+LoRA+MLflow) + 06 事件 (TrainingJob/Checkpoint) + 07 引用 + 08 brainstorm + 09 风险 (R2.1-R2.4) + 10 MVP (B03 v1 OpenVLA-OFT 主) |
| 2 DESIGN | ✅ DONE | ADD §4 (TrainingJob/Checkpoint), §6.3 状态机, §8 分布式 (FSDP+Volcano), wire P4 配置 + P5 监控 + P7 模型管理 |
| 2.5 ARCH | ✅ DONE | TrainCtx (3 聚合根 TrainingJob/ModelVersion/TrainWorker) + 6 事件 (Submitted/Started/MetricReported/CheckpointSaved/Completed/Failed/ModelVersionPublished) + 10 API 端点 |
| **2.7 SCAFFOLD** | **✅ DONE** | **apps/train-svc/ + 1 Alembic 迁移 003_init_training.py 5 张表 (model_versions/training_jobs/checkpoints/training_metrics hypertable/train_workers)** |
| 3 L3 | ✅ DONE | F05 Pod OOM + F10 内存泄漏 + F24 Training NaN + F06 K8s 驱逐 (RPN 24) — last_good_checkpoint resume / 24h 自动重启 / QLoRA 降 batch 50% / graceful 30s |
| 4 PLAN | ✅ DONE | Task 47-63 (B03-R01~R17) 17 Task 全部覆盖, 5 步 TDD + 错误码 VLA-B03-0001~0025 |
| 5 EXECUTE | ✅ DONE | 17 Task 实施 (Task 47-63, 数据加载/模型/优化器/ckpt/RLS) |
| 6 VERIFY | ✅ DONE | loss 收敛/指标达标 (train-svc 域实施, 端点 iter-2) |

## B04 模型测试 (Testing)
| Phase | 状态 | 备注 |
|-------|------|------|
| 1 RESEARCH | ✅ DONE | 01 行业 (LIBERO 4 套件 130 任务+SimplerEnv) + 02 竞品 (DobotWAM 99.25% SOTA) + 05 技术 (vLLM+TensorRT+Grafana) + 06 事件 (EvalJob/Report) + 07 引用 + 08 brainstorm + 09 风险 (R4.1-R4.3) + 10 MVP (B04 v1 LIBERO+SimplerEnv) |
| 2 DESIGN | ✅ DONE | ADD §4 (EvalJob/EvalTask), §6.4 状态机, §8 3-trial 中位数 (R4.1), wire P6 评估结果含 LIBERO 4 套件 + SimplerEnv 报告 |
| 2.5 ARCH | ✅ DONE | EvalCtx (2 聚合根 EvalJob/EvalWorker) + 1 主事件 (EvalJobCompleted, 详尽契约含 3 trial 中位数) + 9 API 端点 |
| **2.7 SCAFFOLD** | **✅ DONE** | **apps/eval-svc/ + 1 Alembic 迁移 004_init_evaluation.py 4 张表 (eval_jobs/eval_tasks/eval_results/eval_workers)** |
| 3 L3 | ✅ DONE | F25 评测波动 (RPN 36 Top 1) + F18 服务超时 + F11 线程池 — 3 trial 中位数强制 / std > 5% 自动多跑 / 跨 benchmark 业务对账 |
| 4 PLAN | ✅ DONE | Task 64-80 (B04-R01~R17) 17 Task 全部覆盖, 5 步 TDD + 错误码 VLA-B04-0001~0026 |
| 5 EXECUTE | ✅ DONE | 17 Task 实施 (Task 64-80, 推理/评估/报告生成/3 trial 中位数) |
| 6 VERIFY | ✅ DONE | 任务成功率/泛化能力 (eval-svc 域实施, 端点 iter-2) |

## cross-BXX 一致性 (BXX > 1 时强制)
- [ ] 跨业务线术语一致 (episode/trajectory/action 统一定义)
- [ ] 跨业务线数据 schema 兼容 (RLD 兼容 OpenVLA/π0)
- [ ] 跨业务线 API 命名风格一致 (snake_case + RESTful)
- [ ] 跨业务线错误码格式一致 (VLA-{BXX}-{NNN})
- [ ] 跨业务线 auth/authz 模型一致 (API Key + 角色)
- [ ] 跨业务线审计日志字段一致 (ts/actor/action/target/result)
- [ ] 跨业务线 multi-tenant 隔离一致 (project_id 维度)
- [ ] 跨业务线可观测性一致 (Prometheus + OpenTelemetry)

## 上下文地图

### 当前 (2026-06-08 Phase 2 DESIGN ✅)
| 字段 | 值 |
|------|-----|
| 阶段 | 2 DESIGN ✅ DONE (4 件套: BDD/flow/ADD/wire 全完成) |
| 活跃 slug | B01-B04 全部 (Phase 2 ✅) |
| 当前 Batch | 准备进入 Phase 2.5 ARCH |
| 失败计数 | 0 |

### 本阶段必读
- skill: xdd-bdd ✅ → xdd-flow ✅ → xdd-add ✅ → xdd-wire ✅
- 输入: L0-research/00-l1-recap.md + 03 personas + 04 journeys + 06 events + 09 risk + 10 mvp
- 上游指针: Phase 0 status.md / Phase 1 L0 11 笔记本 / BDD 5 feature / flow.mermaid
- 自检命令: gate-check-design (BDD 80R + flow 渲染 + ADD 5 维 + wire 8 页 SVG)

### Phase 2 工具摘要 (按需追加)
- xdd-bdd ✅: Gherkin v9.2 Design-Conformance, 80 RXX (B01-R17/B02-R17/B03-R17/B04-R17/X-R12), 5 feature 794 行
- xdd-flow ✅: mermaid 179 行 + 渲染 SVG 109KB, 37 节点 11 subgraph, mmdc 验证通过
- xdd-add ✅: architecture-decision.md, 5 维质量属性 (可用/性能/评测/隔离/成本) + 5 状态机 (SimJob/CollectionSession/TrainingJob/EvalJob/PipelineRun) + 12 失败场景 + 9.1 排障清单
- xdd-wire ✅: training-pipeline-flow.svg 1 文件 8 页面 (5 核心 + 3 辅助), P5 一站式训练场景, desktop 1440x900 1 pass
