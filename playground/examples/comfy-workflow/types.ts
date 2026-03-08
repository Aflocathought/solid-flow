/**
 * AI Workflow Orchestrator — Port 类型系统
 * 
 * 核心设计原则:
 * 1. 每个端口有明确的数据类型 (PortDataType)
 * 2. 连线时进行类型兼容性检查
 * 3. 节点通过 NodeDefinition 声明 I/O 合约
 * 4. Python 端实现对应的节点类，遵守相同的 I/O 合约
 */

// ─── Port Data Types ─────────────────────────────────────

/** 端口携带的数据类型 — 核心类型枚举 */
export enum PortDataType {
  // 基础类型
  ANY        = "any",
  STRING     = "string",
  NUMBER     = "number",
  BOOLEAN    = "boolean",
  JSON       = "json",
  FILE_PATH  = "file_path",

  // AI Pipeline 类型
  DATASET        = "dataset",           // 数据集引用 { path, format, shape, columns }
  MODEL_CONFIG   = "model_config",      // 模型配置 { architecture, hyperparams }
  MODEL_ARTIFACT = "model_artifact",    // 已构建/训练的模型 { path, framework, format }
  CHECKPOINT     = "checkpoint",        // 训练快照 { path, epoch, metrics }
  METRICS        = "metrics",           // 指标集 { loss, mae, rmse, r2, ... }
  TRAIN_LOG      = "train_log",         // 训练日志 { csv_path, tensorboard_dir }
  TFLITE_MODEL   = "tflite_model",      // TFLite 产物
  ONNX_MODEL     = "onnx_model",        // ONNX 产物
  PRUNED_MODEL   = "pruned_model",      // 剪枝后的模型

  // 控制流类型
  TRIGGER        = "trigger",           // 触发信号（无数据，仅流程控制）
}

// ─── Type Compatibility ──────────────────────────────────

/**
 * 类型兼容矩阵
 * key: target 端口类型, value: 可以连接的 source 端口类型集合
 * 
 * 规则: 如果 target 期望类型 T, 那么 source 必须是 canConnectTo[T] 中的某一个
 */
const TYPE_COMPAT: Record<PortDataType, Set<PortDataType>> = (() => {
  const all = new Set(Object.values(PortDataType));
  
  // 默认: 每个类型只能连自己
  const compat: Record<string, Set<PortDataType>> = {};
  for (const t of Object.values(PortDataType)) {
    compat[t] = new Set([t]);
  }
  
  // ANY 接受所有类型
  compat[PortDataType.ANY] = all;
  
  // MODEL_ARTIFACT 可以接受 checkpoint / pruned_model / tflite / onnx
  compat[PortDataType.MODEL_ARTIFACT] = new Set([
    PortDataType.MODEL_ARTIFACT,
    PortDataType.CHECKPOINT,
    PortDataType.PRUNED_MODEL,
    PortDataType.TFLITE_MODEL,
    PortDataType.ONNX_MODEL,
  ]);
  
  // JSON 可以接受所有结构化类型
  compat[PortDataType.JSON] = new Set([
    PortDataType.JSON,
    PortDataType.MODEL_CONFIG,
    PortDataType.METRICS,
    PortDataType.DATASET,
  ]);

  return compat as Record<PortDataType, Set<PortDataType>>;
})();

/**
 * 检查两个端口类型是否兼容
 * @param sourceType - 输出端口的数据类型
 * @param targetType - 输入端口的数据类型
 * @returns 是否可以连接
 */
export function areTypesCompatible(sourceType: PortDataType, targetType: PortDataType): boolean {
  // ANY 作为 source 也能连任何 target
  if (sourceType === PortDataType.ANY) return true;
  return TYPE_COMPAT[targetType]?.has(sourceType) ?? false;
}

/**
 * 获取某个类型的颜色（用于端口 & 连线着色）
 */
export function getPortColor(dataType: PortDataType): string {
  const colorMap: Record<PortDataType, string> = {
    [PortDataType.ANY]:            "#9ca3af",
    [PortDataType.STRING]:         "#f59e0b",
    [PortDataType.NUMBER]:         "#3b82f6",
    [PortDataType.BOOLEAN]:        "#8b5cf6",
    [PortDataType.JSON]:           "#6366f1",
    [PortDataType.FILE_PATH]:      "#78716c",
    [PortDataType.DATASET]:        "#06b6d4",
    [PortDataType.MODEL_CONFIG]:   "#2563eb",
    [PortDataType.MODEL_ARTIFACT]: "#9333ea",
    [PortDataType.CHECKPOINT]:     "#a855f7",
    [PortDataType.METRICS]:        "#10b981",
    [PortDataType.TRAIN_LOG]:      "#14b8a6",
    [PortDataType.TFLITE_MODEL]:   "#ec4899",
    [PortDataType.ONNX_MODEL]:     "#f43f5e",
    [PortDataType.PRUNED_MODEL]:   "#d946ef",
    [PortDataType.TRIGGER]:        "#64748b",
  };
  return colorMap[dataType] ?? "#9ca3af";
}

// ─── Port & Param Definitions ────────────────────────────

/** 单个端口的定义 */
export interface PortDefinition {
  /** 端口 ID（在节点内唯一） */
  id: string;
  /** 显示名称 */
  label: string;
  /** 数据类型 */
  dataType: PortDataType;
  /** 是否必须连接 */
  required: boolean;
  /** 默认值（未连接时使用） */
  defaultValue?: unknown;
  /** 描述信息 */
  description?: string;
}

/** 参数控件类型 */
export type ParamWidgetType = 
  | "string" 
  | "number" 
  | "boolean" 
  | "select" 
  | "multi-select"
  | "json" 
  | "file" 
  | "code"
  | "slider"
  | "number-list";

/** 节点参数定义 */
export interface ParamDefinition {
  /** 参数 key（Python 端接收的字段名） */
  key: string;
  /** 显示名称 */
  label: string;
  /** 控件类型 */
  widget: ParamWidgetType;
  /** 默认值 */
  defaultValue?: unknown;
  /** 下拉选项 (for select / multi-select) */
  options?: { label: string; value: unknown }[];
  /** 验证规则 */
  validation?: {
    min?: number;
    max?: number;
    step?: number;
    pattern?: string;
    required?: boolean;
  };
  /** 分组名（用于参数面板折叠） */
  group?: string;
  /** 描述 */
  description?: string;
  /** 是否高级参数（默认折叠） */
  advanced?: boolean;
}

// ─── Node Definition ─────────────────────────────────────

/** 节点分类 */
export enum NodeCategory {
  DATA       = "data",
  CONFIG     = "config",       
  BUILD      = "build",
  TRAIN      = "train",
  EVALUATE   = "evaluate",
  OPTIMIZE   = "optimize",     // prune, quantize
  CONVERT    = "convert",      // tflite, onnx
  OUTPUT     = "output",
  UTILITY    = "utility",      // text output, log viewer
}

/** 节点分类元数据 */
export const NODE_CATEGORY_META: Record<NodeCategory, { label: string; color: string; icon: string }> = {
  [NodeCategory.DATA]:     { label: "数据",   color: "#06b6d4", icon: "📊" },
  [NodeCategory.CONFIG]:   { label: "配置",   color: "#2563eb", icon: "⚙️" },
  [NodeCategory.BUILD]:    { label: "构建",   color: "#7c3aed", icon: "🏗️" },
  [NodeCategory.TRAIN]:    { label: "训练",   color: "#9333ea", icon: "🎯" },
  [NodeCategory.EVALUATE]: { label: "评估",   color: "#10b981", icon: "📈" },
  [NodeCategory.OPTIMIZE]: { label: "优化",   color: "#f59e0b", icon: "⚡" },
  [NodeCategory.CONVERT]:  { label: "转换",   color: "#ec4899", icon: "🔄" },
  [NodeCategory.OUTPUT]:   { label: "输出",   color: "#059669", icon: "📦" },
  [NodeCategory.UTILITY]:  { label: "工具",   color: "#64748b", icon: "🔧" },
};

/** 
 * 节点类型定义 — 这是整个系统的核心注册单元
 * 
 * 每个新节点只需要:
 * 1. 定义一个 NodeDefinition
 * 2. 写对应的 Python 类（继承 BaseNode）
 * 3. 注册到 NODE_REGISTRY
 */
export interface NodeDefinition {
  /** 节点类型 ID (全局唯一) e.g. "model_builder", "trainer" */
  type: string;
  /** 分类 */
  category: NodeCategory;
  /** 显示名称 */
  label: string;
  /** 描述 */
  description: string;
  /** 图标 (emoji) */
  icon: string;

  /** 输入端口列表 */
  inputs: PortDefinition[];
  /** 输出端口列表 */
  outputs: PortDefinition[];
  /** 可配置参数列表 */
  params: ParamDefinition[];

  /** Python 端模块路径 e.g. "nodes.model_builder" */
  pythonModule: string;
  /** Python 端类名 e.g. "ModelBuilderNode" */
  pythonClass: string;

  /** 是否支持动态添加端口 */
  dynamicPorts?: boolean;
  /** 自带 Evaluate 子流程 (用于 optimize/convert 节点) */
  builtinEvaluate?: boolean;
}

// ─── Node Instance Data ──────────────────────────────────

/** 节点实例运行时状态 */
export type NodeStatus = "idle" | "queued" | "running" | "success" | "error" | "skipped";

/** 节点实例数据（存储在 solid-flow Node.data 中） */
export interface WorkflowNodeInstanceData {
  /** Index signature — required by solid-flow's UnknownStruct constraint */
  [key: string]: unknown;
  /** 对应的 NodeDefinition.type */
  definitionType: string;
  /** 用户自定义标题 */
  title: string;
  /** 运行状态 */
  status: NodeStatus;
  /** 进度 0-1 */
  progress: number;
  /** 状态消息 */
  statusMessage: string;
  /** 参数值 (key → value) */
  paramValues: Record<string, unknown>;
  /** 输入端口 IDs (可能被用户动态修改) */
  inputPortIds: string[];
  /** 输出端口 IDs */
  outputPortIds: string[];
  /** 最后一次执行的指标结果 */
  lastMetrics?: Record<string, number | string>;
  /** 最后一次执行的日志 */
  lastLogs?: string[];
  /** 执行耗时 (ms) */
  executionTime?: number;
}

// ─── Serialization ───────────────────────────────────────

/** 序列化的图（发送给 Worker） */
export interface SerializedGraph {
  version: string;
  name: string;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  metadata?: Record<string, unknown>;
}

export interface SerializedNode {
  id: string;
  definitionType: string;
  paramValues: Record<string, unknown>;
  inputPortIds: string[];
  outputPortIds: string[];
  position: { x: number; y: number };
}

export interface SerializedEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}
