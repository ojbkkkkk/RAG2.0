import { useEffect, useRef, useMemo } from 'react';
import { Graph } from '@antv/g6';
import { useSystem } from '../App';

// ── Props 接口（与 KnowledgeGraph.tsx 调用保持一致）──────────────

interface GraphinViewProps {
  nodes: { id: string; label: string; entityType: string; highlighted?: boolean }[];
  edges: { id: string; source: string; target: string; label: string; confidence: number }[];
  layoutMode: 'force' | 'concentric' | 'hierarchy' | 'radial';
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  onCanvasClick?: () => void;
  entityColors: Record<string, string>;
  selectedNodeId?: string | null;
  highlightedNodeIds?: Set<string>;
  highlightedEdgeIds?: Set<string>;
}

// ── 大图阈值 ─────────────────────────────────────────────────────

const LARGE_GRAPH_THRESHOLD = 2000;

// ── 布局配置 ─────────────────────────────────────────────────────

function getLayout(mode: string, nodeCount: number) {
  const isLarge = nodeCount > LARGE_GRAPH_THRESHOLD;
  switch (mode) {
    case 'force':
      return {
        type: 'd3-force',
        preventOverlap: true,
        nodeSize: 50,
        linkDistance: isLarge ? 60 : 100,
        alphaDecay: isLarge ? 0.08 : 0.028,
      };
    case 'concentric':
      return { type: 'concentric', sortBy: 'degree', nodeSize: 50 };
    case 'hierarchy':
      return { type: 'dagre', rankdir: 'TB', nodesep: 60, ranksep: 80 };
    case 'radial':
      return { type: 'radial', unitRadius: 150, nodeSize: 50, preventOverlap: true };
    default:
      return { type: 'd3-force', preventOverlap: true, nodeSize: 50, alphaDecay: 0.028 };
  }
}

// ── 交互行为配置 ──────────────────────────────────────────────────

function getBehaviors(layoutMode: string) {
  const base = ['zoom-canvas', 'drag-canvas', 'click-select'];
  if (layoutMode === 'force') {
    base.push('drag-element-force');
  } else {
    base.push('drag-element');
  }
  return base;
}

// ── 主组件 ────────────────────────────────────────────────────────

export default function GraphinView({
  nodes,
  edges,
  layoutMode,
  onNodeClick,
  onEdgeClick,
  onCanvasClick,
  entityColors,
  selectedNodeId,
  highlightedNodeIds,
  highlightedEdgeIds,
}: GraphinViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const { theme } = useSystem();

  // 通过 ref 传递回调，避免加入 useEffect 依赖导致频繁重建
  const onNodeClickRef = useRef(onNodeClick);
  const onEdgeClickRef = useRef(onEdgeClick);
  const onCanvasClickRef = useRef(onCanvasClick);

  // 选中/高亮状态通过 ref 传递，样式函数中读取最新值
  const entityColorsRef = useRef(entityColors);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const highlightedNodeIdsRef = useRef(highlightedNodeIds);
  const highlightedEdgeIdsRef = useRef(highlightedEdgeIds);

  // 保持 ref 同步最新
  onNodeClickRef.current = onNodeClick;
  onEdgeClickRef.current = onEdgeClick;
  onCanvasClickRef.current = onCanvasClick;
  entityColorsRef.current = entityColors;
  selectedNodeIdRef.current = selectedNodeId;
  highlightedNodeIdsRef.current = highlightedNodeIds;
  highlightedEdgeIdsRef.current = highlightedEdgeIds;

  // ── 稳定的数据 key：长度+首尾id+布局模式+主题 ────────────────────
  // 仅当数据内容、布局模式或主题真正变化时才触发图谱重建
  const dataKey = useMemo(() => {
    const nLen = nodes.length;
    const eLen = edges.length;
    const firstNode = nodes[0]?.id || '';
    const lastNode = nodes[nLen - 1]?.id || '';
    const firstEdge = edges[0]?.id || '';
    const lastEdge = edges[eLen - 1]?.id || '';
    return `${nLen}|${eLen}|${firstNode}|${lastNode}|${firstEdge}|${lastEdge}|${layoutMode}|${theme}`;
  }, [nodes, edges, layoutMode, theme]);

  // ── 主 useEffect：dataKey 变化时销毁旧图→创建新图→渲染→绑事件 ─
  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return;

    // 销毁旧实例
    if (graphRef.current) {
      graphRef.current.destroy();
      graphRef.current = null;
    }

    const colors = entityColorsRef.current;
    const isLargeGraph = nodes.length > LARGE_GRAPH_THRESHOLD;
    const isDark = theme === 'dark';
    const labelColor = isDark ? '#e2e8f0' : '#1e293b';
    const edgeLabelBg = isDark ? 'rgba(17, 24, 39, 0.8)' : 'rgba(241, 245, 249, 0.9)';
    const edgeLabelColor = isDark ? '#e2e8f0' : '#1e293b';

    // ── 节点样式辅助 ──────────────────────────────────────
    const hasHighlight = () =>
      highlightedNodeIdsRef.current && highlightedNodeIdsRef.current.size > 0;

    const isNodeHighlighted = (id: string) =>
      highlightedNodeIdsRef.current?.has(id) ?? false;

    const isNodeSelected = (id: string) =>
      id === selectedNodeIdRef.current;

    const getNodeSize = (d: any) => {
      const nodeId = d.id;
      if (hasHighlight()) {
        if (isNodeHighlighted(nodeId)) {
          return d.data?.highlighted ? 56 : 56;
        }
        return 32; // 非关联节点缩小
      }
      return d.data?.highlighted ? 56 : 40;
    };

    const getNodeFill = (d: any) =>
      colors[d.data?.entityType] || '#6B7280';

    const getNodeFillOpacity = (_d: any) => {
      if (!hasHighlight()) return 1;
      return isNodeHighlighted(_d.id) ? 1 : 0.2;
    };

    const getNodeStroke = (d: any) => {
      if (isNodeSelected(d.id)) return '#ffffff';
      return colors[d.data?.entityType] || '#6B7280';
    };

    const getNodeStrokeOpacity = (d: any) => {
      if (!hasHighlight()) return 0.6;
      return isNodeHighlighted(d.id) ? 0.8 : 0.1;
    };

    const getNodeLineWidth = (d: any) =>
      isNodeSelected(d.id) ? 3 : 1;

    const getNodeLabelText = (d: any) => {
      // 超大图仅显示高亮节点标签
      if (isLargeGraph) {
        return isNodeHighlighted(d.id) ? (d.data?.label || '') : '';
      }
      return d.data?.label || '';
    };

    // ── 边样式辅助 ──────────────────────────────────────
    const hasEdgeHighlight = () =>
      highlightedEdgeIdsRef.current && highlightedEdgeIdsRef.current.size > 0;

    const isEdgeHighlighted = (id: string) =>
      highlightedEdgeIdsRef.current?.has(id) ?? false;

    const getEdgeOpacity = (d: any) => {
      if (hasEdgeHighlight()) {
        return isEdgeHighlighted(d.id) ? 0.9 : 0.08;
      }
      return Math.max(0.3, d.data?.confidence || 0.5);
    };

    const getEdgeLineWidth = (d: any) => {
      if (hasEdgeHighlight() && isEdgeHighlighted(d.id)) return 2;
      return 1;
    };

    // ── 创建 Graph 实例 ─────────────────────────────────
    const graph = new Graph({
      container: containerRef.current,
      autoFit: 'view',
      theme: isDark ? 'dark' : 'light',

      node: {
        type: 'circle',
        style: {
          size: getNodeSize,
          fill: getNodeFill,
          fillOpacity: getNodeFillOpacity,
          stroke: getNodeStroke,
          strokeOpacity: getNodeStrokeOpacity,
          lineWidth: getNodeLineWidth,
          // 小图(<2000): shadowBlur 发光效果；大图关闭（Canvas shadowBlur 是极其昂贵的 GPU 操作）
          ...(isLargeGraph ? {} : {
            shadowColor: getNodeFill,
            shadowBlur: 12,
          }),
          // 标签
          labelText: getNodeLabelText,
          labelFill: labelColor,
          labelFontSize: 10,
          labelPlacement: 'bottom',
          labelOffsetY: 6,
        },
      },

      edge: {
        type: 'line',
        style: {
          stroke: '#8B5CF6',
          strokeOpacity: getEdgeOpacity,
          lineWidth: getEdgeLineWidth,
          // 小图显示边标签（关系类型），暗色半透明背景
          ...(isLargeGraph ? {} : {
            labelText: (d: any) => d.data?.label || '',
            labelFill: edgeLabelColor,
            labelFontSize: 9,
            labelBackground: true,
            labelBackgroundFill: edgeLabelBg,
            labelBackgroundRadius: 3,
          }),
          endArrow: true,
        },
      },

      layout: getLayout(layoutMode, nodes.length),
      behaviors: getBehaviors(layoutMode),
      // 大图禁用动画，避免每帧 O(n²) 力模拟阻塞主线程
      animation: !isLargeGraph,
    } as any);

    graphRef.current = graph;

    // ── 设置数据 ──────────────────────────────────────────
    const graphData = {
      nodes: nodes.map(n => ({
        id: n.id,
        data: { label: n.label, entityType: n.entityType, highlighted: n.highlighted },
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        data: { label: e.label, confidence: e.confidence },
      })),
    };

    graph.setData(graphData as any);

    // ── 异步渲染，避免大数据量同步阻塞主线程 ─────────────
    let destroyed = false;
    const rafId = requestAnimationFrame(() => {
      if (destroyed) return;
      graph.render();

      // ── 事件监听 ──────────────────────────────────────
      const handleNodeClick = (evt: any) => {
        const id = evt.target?.id || evt.targetId;
        if (id) onNodeClickRef.current?.(id);
      };
      const handleEdgeClick = (evt: any) => {
        const id = evt.target?.id || evt.targetId;
        if (id) onEdgeClickRef.current?.(id);
      };
      const handleCanvasClick = () => {
        onCanvasClickRef.current?.();
      };

      graph.on('node:click', handleNodeClick);
      graph.on('edge:click', handleEdgeClick);
      graph.on('canvas:click', handleCanvasClick);
    });

    // ── ResizeObserver 监听容器尺寸变化 ──────────────────
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (graphRef.current && !graphRef.current.destroyed) {
          try {
            graphRef.current.resize();
          } catch {
            // graph 可能尚未完全初始化，忽略
          }
        }
      });
      resizeObserver.observe(containerRef.current);
    }

    // ── 清理函数 ──────────────────────────────────────────
    return () => {
      destroyed = true;
      cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (graphRef.current) {
        graphRef.current.destroy();
        graphRef.current = null;
      }
    };
  }, [dataKey]);

  // ── 选中/高亮变化时，仅重绘样式，不重建图谱 ──────────────────
  useEffect(() => {
    if (!graphRef.current) return;
    try {
      graphRef.current.draw();
    } catch {
      // graph 可能尚未渲染完成，忽略
    }
  }, [selectedNodeId, highlightedNodeIds, highlightedEdgeIds]);

  return <div ref={containerRef} className="w-full h-full" />;
}
