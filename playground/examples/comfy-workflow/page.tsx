import "./style.css";

import { createMemo, createSignal, For, Show } from "solid-js";

import {
  addEdge,
  Background,
  Controls,
  createEdgeStore,
  createNodeStore,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  type NodeTypes,
  Panel,
  SolidFlow,
  useSolidFlow,
  useUpdateNodeInternals,
} from "~/index";

// ── 新类型系统 ────────────────────────────────────────
import {
  type WorkflowNodeInstanceData,
  type NodeStatus,
  type PortDefinition,
  type ParamDefinition,
  NodeCategory,
  areTypesCompatible,
  getPortColor,
} from "./types";

import {
  getNodeCatalog,
  getNodeDefinition,
  createDefaultInstanceData,
} from "./node-registry";

import {
  compileGraph,
  validateGraph,
  solidFlowToSerializedGraph,
  type CompileResult,
} from "./graph-compiler";

// ─── Constants ───────────────────────────────────────────

const NODE_TYPE = "workflow-card";

const statusText: Record<NodeStatus, string> = {
  idle: "空闲",
  queued: "排队中",
  running: "执行中",
  success: "完成",
  error: "失败",
  skipped: "跳过",
};

// ─── Initial Nodes & Edges (使用新类型系统) ──────────────

function makeInitialNode(
  id: string,
  defType: string,
  position: { x: number; y: number },
  paramOverrides?: Record<string, unknown>,
): Node<WorkflowNodeInstanceData, typeof NODE_TYPE> {
  const data = createDefaultInstanceData(defType)!;
  if (paramOverrides) {
    Object.assign(data.paramValues, paramOverrides);
  }
  return { id, type: NODE_TYPE, position, data };
}

const initialNodes: Node<WorkflowNodeInstanceData, typeof NODE_TYPE>[] = [
  makeInitialNode("data-1", "data_source", { x: 40, y: 90 }, {
    data_path: "./data/train.csv",
    target_column: "close",
  }),
  makeInitialNode("config-1", "config", { x: 40, y: 400 }, {
    model_name: "my_lstm",
    epochs: 100,
    batch_size: 32,
  }),
  makeInitialNode("model-1", "model_builder", { x: 390, y: 60 }, {
    architecture: "lstm",
    units: 64,
  }),
  makeInitialNode("train-1", "trainer", { x: 750, y: 60 }),
  makeInitialNode("eval-1", "evaluator", { x: 1100, y: 60 }),
  makeInitialNode("output-1", "output_manager", { x: 1450, y: 60 }),
];

const initialEdges = [
  {
    id: "e-data-model",
    source: "data-1",
    sourceHandle: "out-dataset",
    target: "model-1",
    targetHandle: "in-dataset",
    animated: true,
  },
  {
    id: "e-config-model",
    source: "config-1",
    sourceHandle: "out-config",
    target: "model-1",
    targetHandle: "in-config",
    animated: true,
  },
  {
    id: "e-model-train",
    source: "model-1",
    sourceHandle: "out-model",
    target: "train-1",
    targetHandle: "in-model",
    animated: true,
  },
  {
    id: "e-data-train",
    source: "data-1",
    sourceHandle: "out-dataset",
    target: "train-1",
    targetHandle: "in-dataset",
    animated: true,
  },
  {
    id: "e-config-train",
    source: "config-1",
    sourceHandle: "out-config",
    target: "train-1",
    targetHandle: "in-config",
    animated: true,
  },
  {
    id: "e-train-eval",
    source: "train-1",
    sourceHandle: "out-checkpoint",
    target: "eval-1",
    targetHandle: "in-model",
    animated: true,
  },
  {
    id: "e-data-eval",
    source: "data-1",
    sourceHandle: "out-dataset",
    target: "eval-1",
    targetHandle: "in-dataset",
    animated: true,
  },
  {
    id: "e-eval-output",
    source: "eval-1",
    sourceHandle: "out-metrics",
    target: "output-1",
    targetHandle: "in-metrics",
    animated: true,
  },
];

// ─── WorkflowCardNode (增强版) ───────────────────────────

const WorkflowCardNode = (props: NodeProps<WorkflowNodeInstanceData, typeof NODE_TYPE>) => {
  const { updateNodeData } = useSolidFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  // 从注册表获取节点定义
  const definition = () => getNodeDefinition(props.data.definitionType);

  const inputPorts = (): PortDefinition[] => {
    const def = definition();
    if (!def) return [];
    return def.inputs.filter((p) => props.data.inputPortIds.includes(p.id));
  };

  const outputPorts = (): PortDefinition[] => {
    const def = definition();
    if (!def) return [];
    return def.outputs.filter((p) => props.data.outputPortIds.includes(p.id));
  };

  const category = () => definition()?.category ?? NodeCategory.CONFIG;

  // 参数更新 (使用对象形式避免回调类型问题)
  const updateParam = (key: string, value: unknown) => {
    updateNodeData(props.id, {
      paramValues: { ...props.data.paramValues, [key]: value },
    });
  };

  // 动态添加端口
  const addPort = (direction: "input" | "output") => {
    const def = definition();
    if (!def?.dynamicPorts) return;

    const current = direction === "input" ? props.data.inputPortIds : props.data.outputPortIds;
    const prefix = direction === "input" ? "dyn-in" : "dyn-out";
    const newId = `${prefix}-${current.length}`;
    const next = [...current, newId];
    updateNodeData(props.id, direction === "input" ? { inputPortIds: next } : { outputPortIds: next });
    updateNodeInternals(props.id);
  };

  // 渲染单个参数控件 (内嵌在节点卡片内)
  const renderParam = (param: ParamDefinition) => {
    if (param.advanced) return null;

    const value = () => props.data.paramValues[param.key] ?? param.defaultValue;

    switch (param.widget) {
      case "select":
        return (
          <label>
            {param.label}
            <select
              class="nodrag"
              value={String(value())}
              onChange={(e) => updateParam(param.key, e.currentTarget.value)}
            >
              <For each={param.options ?? []}>
                {(opt) => <option value={String(opt.value)}>{opt.label}</option>}
              </For>
            </select>
          </label>
        );
      case "boolean":
        return (
          <label class="wf-param-checkbox">
            <input
              class="nodrag"
              type="checkbox"
              checked={Boolean(value())}
              onChange={(e) => updateParam(param.key, e.currentTarget.checked)}
            />
            {param.label}
          </label>
        );
      case "number":
      case "slider":
        return (
          <label>
            {param.label}
            <input
              class="nodrag"
              type="number"
              min={param.validation?.min}
              max={param.validation?.max}
              step={param.validation?.step ?? 1}
              value={Number(value())}
              onInput={(e) => updateParam(param.key, Number(e.currentTarget.value))}
            />
          </label>
        );
      case "file":
      case "string":
      default:
        return (
          <label>
            {param.label}
            <input
              class="nodrag"
              value={String(value() ?? "")}
              onInput={(e) => updateParam(param.key, e.currentTarget.value)}
            />
          </label>
        );
    }
  };

  // 端口位置计算
  const portTopOffset = (index: number) => `${104 + index * 22}px`;

  return (
    <div class={`wf-node wf-node--${category()}`}>
      {/* 头部: 图标 + 标题 + 状态 */}
      <div class="wf-node__header">
        <span>
          <span class="wf-node__icon">{definition()?.icon ?? "🔲"}</span>
          {props.data.title}
        </span>
        <span class={`wf-status wf-status--${props.data.status}`}>
          {statusText[props.data.status]}
        </span>
      </div>

      {/* 元信息: 类型 + ID */}
      <div class="wf-node__meta">
        <span>{definition()?.label ?? props.data.definitionType}</span>
        <span>{props.id}</span>
      </div>

      {/* 描述 */}
      <div class="wf-node__description">{definition()?.description ?? ""}</div>

      {/* 进度条 */}
      <Show when={props.data.status === "running" && props.data.progress > 0}>
        <div class="wf-node__progress-bar">
          <div
            class="wf-node__progress-fill"
            style={{ width: `${Math.round(props.data.progress * 100)}%` }}
          />
        </div>
      </Show>

      {/* 状态消息 */}
      <Show when={props.data.statusMessage}>
        <div class="wf-node__description" style={{ "font-style": "italic", color: "#6b7280" }}>
          {props.data.statusMessage}
        </div>
      </Show>

      {/* 参数面板 (非高级参数) */}
      <Show when={definition()?.params.length}>
        <div class="wf-node__params">
          <For each={definition()!.params.filter((p) => !p.advanced)}>
            {(param) => renderParam(param)}
          </For>
        </div>
      </Show>

      {/* 指标结果 */}
      <Show when={props.data.lastMetrics && Object.keys(props.data.lastMetrics).length > 0}>
        <div class="wf-node__metrics">
          <For each={Object.entries(props.data.lastMetrics!)}>
            {([k, v]) => (
              <span>
                {k}: {typeof v === "number" ? v.toFixed(4) : v}
              </span>
            )}
          </For>
        </div>
      </Show>

      {/* 动态端口操作 */}
      <Show when={definition()?.dynamicPorts}>
        <div class="wf-node__port-actions">
          <button class="nodrag" onClick={() => addPort("input")}>
            + 输入
          </button>
          <button class="nodrag" onClick={() => addPort("output")}>
            + 输出
          </button>
        </div>
      </Show>

      {/* 输入 Handles (左侧) — 带颜色 + 标签 */}
      <For each={inputPorts()}>
        {(port, index) => (
          <>
            <Handle
              type="target"
              position="left"
              id={`in-${port.id}`}
              style={{
                top: portTopOffset(index()),
                background: getPortColor(port.dataType),
                width: "10px",
                height: "10px",
                border: "2px solid #fff",
                "box-shadow": `0 0 3px ${getPortColor(port.dataType)}`,
              }}
              aria-label={`${props.id}-in-${port.id}`}
            />
            <span
              class="wf-port-label wf-port-label--left"
              style={{ top: `${104 + index() * 22 - 6}px` }}
            >
              {port.label}
            </span>
          </>
        )}
      </For>

      {/* 输出 Handles (右侧) — 带颜色 + 标签 */}
      <For each={outputPorts()}>
        {(port, index) => (
          <>
            <Handle
              type="source"
              position="right"
              id={`out-${port.id}`}
              style={{
                top: portTopOffset(index()),
                background: getPortColor(port.dataType),
                width: "10px",
                height: "10px",
                border: "2px solid #fff",
                "box-shadow": `0 0 3px ${getPortColor(port.dataType)}`,
              }}
              aria-label={`${props.id}-out-${port.id}`}
            />
            <span
              class="wf-port-label wf-port-label--right"
              style={{ top: `${104 + index() * 22 - 6}px` }}
            >
              {port.label}
            </span>
          </>
        )}
      </For>
    </div>
  );
};

const nodeTypes = {
  [NODE_TYPE]: WorkflowCardNode,
} satisfies NodeTypes;

// ─── Utilities ───────────────────────────────────────────

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Main Component ──────────────────────────────────────

export const ComfyWorkflow = () => {
  const [nodes, setNodes] = createNodeStore<typeof nodeTypes>(initialNodes);
  const [edges, setEdges] = createEdgeStore(initialEdges);

  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>("config-1");
  const [taskPayload, setTaskPayload] = createSignal("");
  const [logs, setLogs] = createSignal<string[]>(["系统启动完成，等待任务..."]);
  const [isRunning, setIsRunning] = createSignal(false);
  const [showCatalog, setShowCatalog] = createSignal(false);
  const [compiledScript, setCompiledScript] = createSignal<CompileResult | null>(null);
  const [showScript, setShowScript] = createSignal(false);

  const { addNodes, fitView, toObject, updateNodeData } = useSolidFlow();

  const selectedNode = createMemo(
    () =>
      nodes.find((node) => node.id === selectedNodeId()) as
        | Node<WorkflowNodeInstanceData, typeof NODE_TYPE>
        | undefined,
  );

  const appendLog = (text: string) => {
    const stamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${stamp}] ${text}`, ...prev].slice(0, 14));
  };

  const setNodeStatus = (id: string, status: NodeStatus) => {
    updateNodeData(id, () => ({ status }));
  };

  // ── 连接类型检查 ──────────────────────────────────

  const checkConnectionCompatibility = (
    sourceNodeId: string,
    sourceHandleId: string,
    targetNodeId: string,
    targetHandleId: string,
  ): { compatible: boolean; message: string } => {
    const sourceNode = nodes.find((n) => n.id === sourceNodeId);
    const targetNode = nodes.find((n) => n.id === targetNodeId);
    if (!sourceNode || !targetNode) return { compatible: false, message: "节点不存在" };

    const sourceDef = getNodeDefinition((sourceNode.data as WorkflowNodeInstanceData).definitionType);
    const targetDef = getNodeDefinition((targetNode.data as WorkflowNodeInstanceData).definitionType);
    if (!sourceDef || !targetDef) return { compatible: false, message: "节点定义不存在" };

    // 从 handle ID 还原端口 ID: "out-dataset" → "dataset", "in-config" → "config"
    const sourcePortId = sourceHandleId.replace(/^out-/, "");
    const targetPortId = targetHandleId.replace(/^in-/, "");

    const sourcePort = sourceDef.outputs.find((p) => p.id === sourcePortId);
    const targetPort = targetDef.inputs.find((p) => p.id === targetPortId);

    if (!sourcePort || !targetPort) {
      return { compatible: true, message: "动态端口，允许连接" };
    }

    if (areTypesCompatible(sourcePort.dataType, targetPort.dataType)) {
      return { compatible: true, message: `✅ ${sourcePort.dataType} → ${targetPort.dataType}` };
    }

    return {
      compatible: false,
      message: `类型不兼容: ${sourcePort.label}(${sourcePort.dataType}) → ${targetPort.label}(${targetPort.dataType})`,
    };
  };

  // ── 模拟流水线执行 ────────────────────────────────

  const runPipeline = async () => {
    if (isRunning()) return;
    setIsRunning(true);
    appendLog("开始执行工作流任务 (模拟)");

    // 使用拓扑排序确定执行顺序
    const flowObj = toObject();
    const serialized = solidFlowToSerializedGraph(flowObj, "pipeline");
    const validation = validateGraph(serialized);

    if (!validation.valid) {
      for (const err of validation.errors) {
        appendLog(`❌ ${err}`);
      }
      setIsRunning(false);
      return;
    }

    // 标记所有节点为排队
    for (const n of nodes) {
      setNodeStatus(n.id, "queued");
    }

    // 编译并获取执行顺序
    const result = compileGraph(serialized);

    if (!result.success) {
      appendLog(`❌ 编译失败: ${result.errors.join(", ")}`);
      setIsRunning(false);
      return;
    }

    // 模拟按拓扑顺序执行各节点
    for (const nodeId of result.executionOrder) {
      setNodeStatus(nodeId, "running");
      updateNodeData(nodeId, () => ({ progress: 0, statusMessage: "执行中..." }));
      appendLog(`节点 ${nodeId} 执行中`);

      // 模拟进度
      for (let p = 0; p <= 1; p += 0.25) {
        await wait(300);
        updateNodeData(nodeId, () => ({ progress: p }));
      }

      setNodeStatus(nodeId, "success");
      updateNodeData(nodeId, () => ({ progress: 1, statusMessage: "完成" }));
      appendLog(`节点 ${nodeId} 执行完成`);
    }

    appendLog("✅ 工作流执行完成");
    setIsRunning(false);
  };

  // ── 编译脚本预览 ──────────────────────────────────

  const previewScript = () => {
    const flowObj = toObject();
    const serialized = solidFlowToSerializedGraph(flowObj, "workflow");
    const result = compileGraph(serialized);
    setCompiledScript(result);
    setShowScript(true);
    appendLog(result.success ? "脚本编译成功" : `编译错误: ${result.errors.join(", ")}`);
  };

  // ── 导出/导入 ─────────────────────────────────────

  const exportTask = () => {
    const serialized = JSON.stringify(toObject(), null, 2);
    setTaskPayload(serialized);
    appendLog("已打包任务，可发送到远程机器执行");
  };

  const parseAndLoadTask = () => {
    try {
      const parsed = JSON.parse(taskPayload());
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        appendLog("任务解析失败：格式错误");
        return;
      }
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
      setSelectedNodeId(parsed.nodes[0]?.id ?? null);
      appendLog("远程任务已解析并注入画布");
      void fitView({ padding: 0.25 });
    } catch {
      appendLog("任务解析失败：JSON 无法解析");
    }
  };

  const sendToRemote = () => {
    exportTask();
    appendLog("任务已发送到 workstation-02");
    setTimeout(() => appendLog("workstation-02: 已接收任务并开始执行"), 800);
  };

  // ── 从目录添加节点 ────────────────────────────────

  const addWorkflowNode = (defType: string) => {
    const def = getNodeDefinition(defType);
    if (!def) return;

    const data = createDefaultInstanceData(defType);
    if (!data) return;

    const count = nodes.filter((n) => (n.data as WorkflowNodeInstanceData).definitionType === defType).length + 1;
    const id = `${defType}-${count}-${Math.random().toString(36).slice(2, 6)}`;

    addNodes({
      id,
      type: NODE_TYPE,
      position: { x: 200 + count * 60, y: 200 + count * 40 },
      data: { ...data, title: `${def.label} ${count}` },
    });

    setSelectedNodeId(id);
    setShowCatalog(false);
    appendLog(`新增节点 ${def.icon} ${def.label} (${id})`);
  };

  // ── 节点详情面板 ──────────────────────────────────

  const updateSelectedNodeMeta = (field: "title" | "statusMessage", value: string) => {
    const id = selectedNodeId();
    if (!id) return;
    updateNodeData(id, () => ({ [field]: value }));
  };

  // ── 节点目录组件 ──────────────────────────────────

  const NodeCatalog = () => {
    const catalog = getNodeCatalog();
    return (
      <div class="wf-panel wf-panel--catalog">
        <strong>节点目录</strong>
        <For each={catalog}>
          {(group) => (
            <div class="wf-catalog-group">
              <div class="wf-catalog-group__title">
                {group.icon} {group.label}
              </div>
              <For each={group.nodes}>
                {(node) => (
                  <div class="wf-catalog-item" onClick={() => addWorkflowNode(node.type)}>
                    <span class="wf-catalog-item__icon">{node.icon}</span>
                    <div class="wf-catalog-item__info">
                      <span class="wf-catalog-item__name">{node.label}</span>
                      <span class="wf-catalog-item__desc">{node.description}</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    );
  };

  return (
    <div class="comfy-page">
      <SolidFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        maxZoom={2}
        minZoom={0.2}
        connectionMode="strict"
        defaultEdgeOptions={{ animated: true }}
        onNodeClick={({ node }) => setSelectedNodeId(node.id)}
        onConnect={(connection) => {
          if (!connection.source || !connection.target || connection.source === connection.target) {
            appendLog("连接失败：不能自连接或空连接");
            return;
          }

          // 类型兼容性检查
          const compat = checkConnectionCompatibility(
            connection.source,
            connection.sourceHandle ?? "",
            connection.target,
            connection.targetHandle ?? "",
          );

          if (!compat.compatible) {
            appendLog(`连接被拒绝: ${compat.message}`);
            return;
          }

          setEdges((allEdges) =>
            addEdge(
              {
                ...connection,
                id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
                animated: true,
              },
              allEdges,
            ),
          );

          appendLog(
            `连接成功：${connection.source}:${connection.sourceHandle ?? "source"} -> ${connection.target}:${connection.targetHandle ?? "target"} (${compat.message})`,
          );
        }}
      >
        <Background variant="dots" gap={18} size={1} />
        <MiniMap zoomable pannable />
        <Controls />

        {/* ── 左上: 操作面板 ── */}
        <Panel position="top-left">
          <div class="wf-panel wf-panel--ops">
            <strong>AI Workflow Orchestrator</strong>
            <div class="wf-panel__btn-row">
              <button class="wf-btn" disabled={isRunning()} onClick={() => void runPipeline()}>
                {isRunning() ? "执行中..." : "▶ 执行流程"}
              </button>
              <button class="wf-btn" onClick={previewScript}>
                📜 编译脚本
              </button>
              <button class="wf-btn" onClick={sendToRemote}>
                🚀 发送到远程
              </button>
            </div>
            <div class="wf-panel__btn-row">
              <button class="wf-btn wf-btn--ghost" onClick={() => setShowCatalog(!showCatalog())}>
                {showCatalog() ? "✕ 关闭目录" : "＋ 添加节点"}
              </button>
              <button class="wf-btn wf-btn--ghost" onClick={exportTask}>
                导出
              </button>
              <button class="wf-btn wf-btn--ghost" onClick={parseAndLoadTask}>
                导入
              </button>
            </div>
          </div>
          <Show when={showCatalog()}>
            <NodeCatalog />
          </Show>
        </Panel>

        {/* ── 右上: 节点详情 ── */}
        <Panel position="top-right">
          <div class="wf-panel wf-panel--inspect">
            <strong>节点详情</strong>
            <Show when={selectedNode()} fallback={<span>未选中节点</span>}>
              {(node) => {
                const def = () => getNodeDefinition(node().data.definitionType);
                return (
                  <>
                    <div class="wf-kv">
                      <span>ID</span>
                      <span>{node().id}</span>
                    </div>
                    <div class="wf-kv">
                      <span>类型</span>
                      <span>
                        {def()?.icon} {def()?.label ?? node().data.definitionType}
                      </span>
                    </div>
                    <div class="wf-kv">
                      <span>状态</span>
                      <span class={`wf-status wf-status--${node().data.status}`}>
                        {statusText[node().data.status]}
                      </span>
                    </div>
                    <label>
                      标题
                      <input
                        class="nodrag"
                        value={node().data.title}
                        onInput={(e) => updateSelectedNodeMeta("title", e.currentTarget.value)}
                      />
                    </label>

                    {/* 显示端口列表 */}
                    <Show when={def()}>
                      <div style={{ "font-size": "11px", color: "#6b7280" }}>
                        <div>
                          输入:{" "}
                          {def()!
                            .inputs.map((p) => `${p.label}(${p.dataType})`)
                            .join(", ") || "无"}
                        </div>
                        <div>
                          输出:{" "}
                          {def()!
                            .outputs.map((p) => `${p.label}(${p.dataType})`)
                            .join(", ") || "无"}
                        </div>
                      </div>
                    </Show>

                    {/* 高级参数在详情面板编辑 */}
                    <Show when={def()?.params.filter((p) => p.advanced).length}>
                      <strong style={{ "font-size": "11px", "margin-top": "6px" }}>
                        高级参数
                      </strong>
                      <div class="wf-node__params">
                        <For each={def()!.params.filter((p) => p.advanced)}>
                          {(param) => {
                            const value = () =>
                              node().data.paramValues[param.key] ?? param.defaultValue;
                            return (
                              <label>
                                {param.label}
                                <input
                                  class="nodrag"
                                  type={
                                    param.widget === "number" || param.widget === "slider"
                                      ? "number"
                                      : "text"
                                  }
                                  value={String(value() ?? "")}
                                  onInput={(e) => {
                                    const v =
                                      param.widget === "number" || param.widget === "slider"
                                        ? Number(e.currentTarget.value)
                                        : param.widget === "boolean"
                                          ? e.currentTarget.value === "true"
                                          : e.currentTarget.value;
                                    updateNodeData(node().id, {
                                      paramValues: { ...node().data.paramValues, [param.key]: v },
                                    });
                                  }}
                                />
                              </label>
                            );
                          }}
                        </For>
                      </div>
                    </Show>

                    {/* 指标结果 */}
                    <Show when={node().data.lastMetrics}>
                      <strong style={{ "font-size": "11px", "margin-top": "6px" }}>
                        最近指标
                      </strong>
                      <For each={Object.entries(node().data.lastMetrics!)}>
                        {([k, v]) => (
                          <div class="wf-kv">
                            <span>{k}</span>
                            <span>{typeof v === "number" ? v.toFixed(6) : v}</span>
                          </div>
                        )}
                      </For>
                    </Show>
                  </>
                );
              }}
            </Show>
          </div>
        </Panel>

        {/* ── 左下: 任务载荷 / 脚本预览 ── */}
        <Panel position="bottom-left">
          <Show when={showScript() && compiledScript()}>
            <div class="wf-panel wf-panel--script">
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                }}
              >
                <strong>编译脚本预览</strong>
                <button
                  class="wf-btn"
                  style={{ padding: "2px 8px", "font-size": "11px" }}
                  onClick={() => setShowScript(false)}
                >
                  ✕
                </button>
              </div>
              <Show when={compiledScript()!.success}>
                <div style={{ "font-size": "10px", color: "#6b7280" }}>
                  执行顺序: {compiledScript()!.executionOrder.join(" → ")}
                </div>
                <pre>{compiledScript()!.script}</pre>
              </Show>
              <Show when={!compiledScript()!.success}>
                <div class="wf-script-errors">
                  <For each={compiledScript()!.errors}>
                    {(err) => <div>❌ {err}</div>}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
          <Show when={!showScript()}>
            <div class="wf-panel wf-panel--payload">
              <strong>任务交换载荷（跨电脑同步）</strong>
              <textarea
                class="nodrag"
                rows={8}
                value={taskPayload()}
                placeholder='点击"导出"生成 JSON，然后在另一台机器粘贴并点击"导入"'
                onInput={(event) => setTaskPayload(event.currentTarget.value)}
              />
            </div>
          </Show>
        </Panel>

        {/* ── 右下: 执行日志 ── */}
        <Panel position="bottom-right">
          <div class="wf-panel wf-panel--logs">
            <strong>执行回传日志</strong>
            <For each={logs()}>{(line) => <div class="wf-log-line">{line}</div>}</For>
          </div>
        </Panel>
      </SolidFlow>
    </div>
  );
};
