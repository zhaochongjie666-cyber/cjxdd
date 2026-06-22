/* xdd workflow 编排画布 —— 前端逻辑
 *
 * 画布用 Drawflow,语义字段(name/skill/output_doc/model/extra/gate)存在节点的
 * data-attr 上。边类型:普通拖拽=next;按住 Shift 拖=loop(回退)。
 *
 * graph.json 双向同步:loadGraph() 把后端图灌进 Drawflow;serializeGraph() 把
 * Drawflow 当前状态收成 graph.json 结构。
 *
 * SSE:点"开始"拿 run_id,EventSource 订阅 /api/run/{id}/stream,按事件 type 更新
 * 节点徽章 + 追加日志。
 */
"use strict";

// ==================== 全局状态 ====================
let editor = null;          // Drawflow 实例
let availableModels = ["YACC"];
let defaultModel = "YACC";
let nodeCounter = 0;        // 新建节点 id 用
let currentGraph = null;    // 当前画布对应的 graph.json(含节点/边)
let editingNodeId = null;   // 正在编辑的 Drawflow 节点 id
let eventSource = null;     // 当前 SSE
let nodeStatus = {};        // nodeId -> 'idle'|'running'|'passed'|'failed'

const NODE_TEMPLATES = {
  standard: { name: "new-node", skill: "use skill: xdd-verify", output_doc: ".xdd/out.md", model: null, extra: "", gate: false },
  custom:   { name: "custom",   skill: "", output_doc: ".xdd/out.md", model: null, extra: "", gate: false },
  gate:     { name: "gate",     skill: "use skill: xdd-verify", output_doc: ".xdd/runs/iter-1/verify-report.md", model: null, extra: "", gate: true },
};

// ==================== 工具 ====================
const $ = (sel) => document.querySelector(sel);
const el = (id) => document.getElementById(id);

function logAppend(text, cls) {
  const box = el("log");
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = text;
  box.appendChild(line);
  if (el("autoscroll").checked) box.scrollTop = box.scrollHeight;
}

function setStatus(text, cls) {
  const s = el("runStatus");
  s.textContent = text;
  s.className = "status" + (cls ? " " + cls : "");
}

function nodeStatusBadge(st) {
  return { idle: "", running: "⏳", passed: "✅", failed: "❌" }[st] || "";
}

// ==================== 画布初始化 ====================
function initEditor() {
  editor = new Drawflow(el("canvas"));
  editor.reroute = true;
  editor.reroute_fix_curvature = true;
  editor.force_first_input = false;
  editor.start();

  // Shift+拖 = loop 边(回退):Drawflow 用 drawflow.connection_start 判断,
  // 我们在 exportConnection 时无法拿按键,改用全局 shift 标志 + 导出后染色。
  editor.on("connectionCreated", (info) => {
    // info: {output_id, input_id, output_class, input_class, ...}
    // 如果按住 Shift 建的连接,标 loop
    if (window.__lastShift) {
      markEdgeLoop(info.output_id, info.input_id);
    }
    refreshEdgeStyle();
  });

  // 双击节点 = 编辑
  editor.on("nodeSelected", (id) => { /* 选中即可 */ });
  el("canvas").addEventListener("dblclick", (e) => {
    const n = e.target.closest(".drawflow-node");
    if (n) openEditor(parseInt(n.id.replace("node-", "")));
  });

  // 右键删除
  el("canvas").addEventListener("contextmenu", (e) => {
    const n = e.target.closest(".drawflow-node");
    if (n) {
      e.preventDefault();
      const id = parseInt(n.id.replace("node-", ""));
      if (confirm("删除该节点?")) {
        editor.removeNodeId(`node-${id}`);
      }
    }
  });
}

// 记录 Shift 状态(建连瞬间用)
window.addEventListener("keydown", (e) => { if (e.key === "Shift") window.__lastShift = true; });
window.addEventListener("keyup", (e) => { if (e.key === "Shift") window.__lastShift = false; });

// 给连线下 loop 标记:在两个节点的连接 data 上记一笔
function markEdgeLoop(outNodeId, inNodeId) {
  // 用全局 map 记录哪条连接是 loop
  window.__loopEdges = window.__loopEdges || {};
  window.__loopEdges[`${outNodeId}->${inNodeId}`] = true;
}

function isLoopEdge(outNodeId, inNodeId) {
  window.__loopEdges = window.__loopEdges || {};
  return !!window.__loopEdges[`${outNodeId}->${inNodeId}`];
}

// 把 loop 连线染成红色虚线(Drawflow 的 path 渲染后改样式)
function refreshEdgeStyle() {
  const data = editor.export();
  const drawflow = data.drawflow.Home.data;
  // 遍历所有连接
  Object.values(drawflow).forEach((node) => {
    if (!node.outputs) return;
    Object.values(node.outputs).forEach((out) => {
      out.connections.forEach((conn) => {
        const isLoop = isLoopEdge(node.id, conn.node);
        // Drawflow 没有直接给单条 path 的句柄,靠 CSS class 不可行;
        // 这里靠给目标节点加 data-loop 属性,CSS 用虚线包表示
      });
    });
  });
  // 简化:loop 边视觉靠连接的两个节点 data-loop 标记 + CSS 边框虚线
  Object.values(drawflow).forEach((node) => {
    const dom = document.getElementById(`node-${node.id}`);
    if (!dom) return;
    let hasLoopIn = false, hasLoopOut = false;
    Object.values(drawflow).forEach((n2) => {
      Object.values(n2.outputs || {}).forEach((o) => o.connections.forEach((c) => {
        if (isLoopEdge(n2.id, node.id)) hasLoopIn = true;
        if (isLoopEdge(node.id, n2.id)) hasLoopOut = true;
      }));
    });
    dom.classList.toggle("has-loop", hasLoopIn || hasLoopOut);
  });
}

// ==================== graph.json <-> Drawflow 同步 ====================
function nodeHtml(cfg, st) {
  const badge = nodeStatusBadge(st);
  const gate = cfg.gate ? '<span class="tag">gate</span>' : "";
  return `
    <div class="nd-head">${badge} ${escapeHtml(cfg.name)} ${gate}</div>
    <div class="nd-sub">${escapeHtml(cfg.skill || "(空)")}</div>
    <div class="nd-meta">${escapeHtml(cfg.model || "?")} · ${escapeHtml(shortPath(cfg.output_doc))}</div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function shortPath(p) {
  if (!p) return "";
  const parts = String(p).split("/");
  return parts.length > 2 ? ".../" + parts.slice(-2).join("/") : p;
}

function loadGraphIntoEditor(graph) {
  editor.clear();
  currentGraph = graph;
  window.__loopEdges = {};

  // 1. 建节点,记录 dfId <-> 逻辑 id 映射
  const idMap = {}; // 逻辑id -> dfId
  // 用列布局:8 节点排成两行,自动布局
  const cols = Math.ceil(Math.sqrt(graph.nodes.length || 1));
  graph.nodes.forEach((n, i) => {
    const cfg = { name: n.name, skill: n.skill, output_doc: n.output_doc, model: n.model, extra: n.extra || "", gate: !!n.gate };
    const pos = layoutPos(i, graph.nodes.length);
    const dfId = editor.addNode(
      "xdd",            // 模板名(用默认即可)
      1,                // inputs
      1,                // outputs
      pos.x, pos.y,
      cfg.id,           // 用逻辑 id 作 dom id 后缀(Drawflow 会前缀 node-)
      nodeHtml(cfg, "idle"),
      false
    );
    idMap[n.id] = dfId;
    // 把语义字段也存到节点 data 上
    const nodeData = editor.drawflow.drawflow.Home.data[dfId];
    nodeData.cfg = cfg;
    nodeData.logicalId = n.id;
  });

  // 2. 建边
  graph.edges.forEach((e) => {
    const from = idMap[e.from], to = idMap[e.to];
    if (from == null || to == null) return;
    editor.addConnection(from, to, "output_1", "input_1");
    if (e.type === "loop") markEdgeLoop(from, to);
  });
  refreshEdgeStyle();
}

function layoutPos(i, total) {
  // 简单网格布局:每 4 个一列,行间距 180,列间距 280
  const perCol = 4;
  const col = Math.floor(i / perCol);
  const row = i % perCol;
  return { x: 80 + col * 280, y: 80 + row * 180 };
}

function serializeFromEditor() {
  const data = editor.export().drawflow.Home.data;
  const nodes = [];
  const idMap = {}; // dfId -> 逻辑id
  Object.values(data).forEach((n) => {
    const cfg = n.cfg || { name: "(未配置)", skill: "", output_doc: "", model: defaultModel, extra: "", gate: false };
    let lid = n.logicalId;
    if (!lid) {
      lid = `n_${n.id}_${Date.now().toString(36)}`;
    }
    idMap[n.id] = lid;
    nodes.push({
      id: lid,
      name: cfg.name,
      skill: cfg.skill,
      output_doc: cfg.output_doc,
      model: cfg.model || defaultModel,
      extra: cfg.extra || "",
      gate: !!cfg.gate,
    });
  });
  const edges = [];
  Object.values(data).forEach((n) => {
    (n.outputs?.output_1?.connections || []).forEach((c) => {
      edges.push({
        from: idMap[n.id],
        to: idMap[c.node],
        type: isLoopEdge(n.id, c.node) ? "loop" : "next",
        condition: isLoopEdge(n.id, c.node) ? "gate_fail" : undefined,
      });
    });
  });
  return { task_dir: el("taskDir").value.trim(), nodes, edges };
}

// ==================== API 调用 ====================
async function fetchModels() {
  const r = await fetch("/api/models").then((r) => r.json());
  availableModels = r.models || ["YACC"];
  defaultModel = r.default || availableModels[0] || "YACC";
  // 填模型下拉
  const sel = el("edModel");
  sel.innerHTML = "";
  availableModels.forEach((m) => {
    const o = document.createElement("option");
    o.value = m; o.textContent = m;
    sel.appendChild(o);
  });
}

async function loadGraph() {
  const taskDir = el("taskDir").value.trim();
  if (!taskDir) { alert("先填任务目录"); return; }
  try {
    const g = await fetch(`/api/graph?task_dir=${encodeURIComponent(taskDir)}`).then((r) => {
      if (!r.ok) return r.json().then((j) => { throw new Error(j.detail || r.statusText); });
      return r.json();
    });
    loadGraphIntoEditor(g);
    setStatus(`已加载 ${g.nodes.length} 节点 / ${g.edges.length} 边`);
  } catch (e) {
    alert("加载失败: " + e.message);
  }
}

async function saveGraph() {
  const g = serializeFromEditor();
  if (!g.task_dir) { alert("先填任务目录"); return; }
  const r = await fetch("/api/graph", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_dir: g.task_dir, graph: g }),
  });
  const j = await r.json();
  if (!r.ok) { alert("保存失败: " + (j.detail || r.statusText)); return; }
  setStatus("已保存到 " + j.path);
}

async function resetGraph() {
  const taskDir = el("taskDir").value.trim();
  if (!taskDir) { alert("先填任务目录"); return; }
  // 用空图 + 空节点触发后端默认图:调 /api/graph(不存在 graph.json 即返回默认图)
  const g = await fetch(`/api/graph?task_dir=${encodeURIComponent(taskDir)}`).then((r) => r.json());
  loadGraphIntoEditor(g);
  setStatus("已重置为默认 8 节点图");
}

// ==================== 节点编辑弹窗 ====================
function openEditor(dfId) {
  editingNodeId = dfId;
  const nodeData = editor.drawflow.drawflow.Home.data[dfId];
  const cfg = nodeData.cfg || {};
  el("edId").textContent = `(drawflow #${dfId})`;
  el("edName").value = cfg.name || "";
  el("edSkill").value = cfg.skill || "";
  el("edDoc").value = cfg.output_doc || "";
  // 模型下拉:若 cfg.model 不在列表里,临时加一项
  let found = false;
  [...el("edModel").options].forEach((o) => { if (o.value === cfg.model) found = true; });
  if (cfg.model && !found) {
    const o = document.createElement("option");
    o.value = cfg.model; o.textContent = cfg.model + "(未配)";
    el("edModel").appendChild(o);
  }
  el("edModel").value = cfg.model || defaultModel;
  el("edExtra").value = cfg.extra || "";
  el("edGate").checked = !!cfg.gate;
  el("editor").classList.remove("hidden");
}

function closeEditor() {
  el("editor").classList.add("hidden");
  editingNodeId = null;
}

function applyEditor() {
  if (editingNodeId == null) return;
  const cfg = {
    name: el("edName").value.trim() || "(unnamed)",
    skill: el("edSkill").value.trim(),
    output_doc: el("edDoc").value.trim(),
    model: el("edModel").value,
    extra: el("edExtra").value,
    gate: el("edGate").checked,
  };
  const nodeData = editor.drawflow.drawflow.Home.data[editingNodeId];
  nodeData.cfg = cfg;
  refreshNodeDom(nodeData);
  closeEditor();
}

// ==================== 拖拽添加节点 ====================
function setupPaletteDrag() {
  document.querySelectorAll(".drag-item").forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("kind", item.dataset.kind);
    });
  });
  el("canvas").addEventListener("drop", (e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData("kind");
    if (!kind) return;
    const tmpl = NODE_TEMPLATES[kind] || NODE_TEMPLATES.custom;
    const cfg = { ...tmpl, model: tmpl.model || defaultModel };
    const rect = el("canvas").getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dfId = editor.addNode("xdd", 1, 1, x, y, `n_new_${++nodeCounter}`, nodeHtml(cfg, "idle"), false);
    const nodeData = editor.drawflow.drawflow.Home.data[dfId];
    nodeData.cfg = cfg;
    nodeData.logicalId = `n_new_${nodeCounter}`;
  });
  el("canvas").addEventListener("dragover", (e) => e.preventDefault());
}

// ==================== 执行 + SSE ====================
async function startRun() {
  // 先保存当前画布(保证后端按最新图跑)
  const graph = serializeFromEditor();
  if (!graph.nodes.length) { alert("画布为空"); return; }
  if (!graph.task_dir) { alert("先填任务目录"); return; }
  // 保存
  await fetch("/api/graph", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_dir: graph.task_dir, graph }),
  });

  const force = el("btnForce").classList.contains("active");
  const r = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_dir: graph.task_dir, force }),
  });
  const j = await r.json();
  if (!r.ok) { alert("启动失败: " + (j.detail || r.statusText)); return; }

  el("btnRun").disabled = true;
  el("btnStop").disabled = false;
  setStatus(`运行中 (run ${j.run_id})`, "running");
  logAppend(`=== 开始 run ${j.run_id} force=${force} ===`, "ev-run");

  // 复位所有节点徽章
  resetAllBadges();
  subscribeRun(j.run_id);
}

function resetAllBadges() {
  const data = editor.drawflow.drawflow.Home.data;
  Object.values(data).forEach((n) => {
    nodeStatus[n.logicalId] = "idle";
    refreshNodeDom(n);
  });
}

function subscribeRun(runId) {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/run/${runId}/stream`);
  const evHandler = (ev) => {
    const data = JSON.parse(ev.data);
    handleEvent(data);
  };
  ["node_start", "node_log", "node_done", "node_reset", "loop_trigger", "workflow_done"].forEach((t) => {
    eventSource.addEventListener(t, evHandler);
  });
  eventSource.onerror = () => {
    // EventSource 会自动重连;只有 finished 才真结束
  };
}

function findDfIdByLogicalId(lid) {
  const data = editor.drawflow.drawflow.Home.data;
  for (const n of Object.values(data)) {
    if (n.logicalId === lid) return n.id;
  }
  return null;
}

function refreshNodeDom(nodeData) {
  const st = nodeStatus[nodeData.logicalId] || "idle";
  const dom = document.getElementById(`node-${nodeData.id}`);
  if (dom) {
    const content = dom.querySelector(".drawflow_content_node");
    if (content) content.innerHTML = nodeHtml(nodeData.cfg || {}, st);
    dom.classList.remove("st-running", "st-passed", "st-failed");
    if (st === "running") dom.classList.add("st-running");
    if (st === "passed") dom.classList.add("st-passed");
    if (st === "failed") dom.classList.add("st-failed");
  }
}

function handleEvent(ev) {
  const t = ev.type;
  if (t === "node_start") {
    const dfId = findDfIdByLogicalId(ev.node);
    if (dfId != null) {
      nodeStatus[ev.node] = "running";
      refreshNodeDom(editor.drawflow.drawflow.Home.data[dfId]);
    }
    logAppend(`▶ [${ev.node}] 开始`, "ev-node");
  } else if (t === "node_log") {
    logAppend(`  [${ev.node}] ${ev.text}`);
  } else if (t === "node_done") {
    const dfId = findDfIdByLogicalId(ev.node);
    if (dfId != null) {
      nodeStatus[ev.node] = ev.passed ? "passed" : "failed";
      refreshNodeDom(editor.drawflow.drawflow.Home.data[dfId]);
    }
    const tag = ev.skipped ? "(跳过,产物已存在)" : "";
    logAppend(`${ev.passed ? "✅" : "❌"} [${ev.node}] ${ev.passed ? "通过" : "未过"} ${tag}`, ev.passed ? "ev-pass" : "ev-fail");
  } else if (t === "node_reset") {
    const dfId = findDfIdByLogicalId(ev.node);
    if (dfId != null) {
      nodeStatus[ev.node] = "idle";
      refreshNodeDom(editor.drawflow.drawflow.Home.data[dfId]);
    }
    logAppend(`↻ [${ev.node}] 回退重置`, "ev-loop");
  } else if (t === "loop_trigger") {
    logAppend(`⟳ 回退触发: ${ev.from} → ${ev.to} (${ev.condition})`, "ev-loop");
  } else if (t === "workflow_done") {
    logAppend(`=== 完成${ev.stopped ? "(已停止)" : ""}${ev.error ? " 错误:" + ev.error : ""} ===`, "ev-run");
    if (ev.blocked) logAppend(`  受阻节点: ${ev.blocked.join(", ")}`, "ev-fail");
    setStatus(ev.stopped ? "已停止" : (ev.error ? "出错" : "完成"), ev.error ? "failed" : "passed");
    el("btnRun").disabled = false;
    el("btnStop").disabled = true;
    if (eventSource) { eventSource.close(); eventSource = null; }
  }
}

async function stopRun() {
  // 找当前活跃 run(从 runs 列表拿最新的)
  const runs = await fetch("/api/runs").then((r) => r.json());
  const alive = (runs.runs || []).filter((r) => r.alive);
  if (!alive.length) { setStatus("没有运行中的任务"); return; }
  const rid = alive[alive.length - 1].run_id;
  await fetch(`/api/run/${rid}/stop`, { method: "POST" });
  setStatus("正在停止...");
}

// ==================== 启动 ====================
window.addEventListener("DOMContentLoaded", async () => {
  initEditor();
  setupPaletteDrag();
  await fetchModels();

  // 默认加载一个空图占位(等用户填 task_dir)
  loadGraphIntoEditor({ nodes: [], edges: [], task_dir: "" });
  setStatus("就绪 · 填任务目录后点【加载图】");

  // 事件绑定
  el("btnLoad").onclick = loadGraph;
  el("btnSave").onclick = saveGraph;
  el("btnReset").onclick = resetGraph;
  el("btnRun").onclick = startRun;
  el("btnStop").onclick = stopRun;
  el("btnForce").onclick = (e) => e.target.classList.toggle("active");
  el("btnClearLog").onclick = () => el("log").innerHTML = "";

  el("edSave").onclick = applyEditor;
  el("edCancel").onclick = closeEditor;
  el("edDelete").onclick = () => {
    if (editingNodeId == null) return;
    editor.removeNodeId(`node-${editingNodeId}`);
    closeEditor();
  };
});
