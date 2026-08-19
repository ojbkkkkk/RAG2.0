import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from '@dagrejs/dagre';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY } from 'd3-force';
import {
  Network,
  Search,
  Filter,
  Plus,
  Link2,
  X,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Edit3,
  Save,
  FolderOpen,
  FileText,
} from 'lucide-react';
import {
  getKnowledgeGraph,
  getGraphStats,
  getAllKnowledgeGraphs,
  createGraphNode,
  updateGraphNode,
  deleteGraphNode,
  createGraphEdge,
  deleteGraphEdge,
  getCollections,
  getDocuments,
  getNodeDetail,
} from '../api/client';
import type {
  Collection,
  Document,
  GraphNode,
  GraphEdge,
  GraphStats,
  NodeDetailResponse,
} from '../types';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import GraphinView from '../components/GraphinView';

// ── Constants ──────────────────────────────────────────────

const ENTITY_COLORS: Record<string, string> = {
  Person: '#3B82F6',
  Organization: '#10B981',
  Technology: '#8B5CF6',
  Product: '#F59E0B',
  Location: '#EC4899',
  Event: '#06B6D4',
  Concept: '#6B7280',
};

const DEFAULT_COLOR = '#6B7280';

const ENTITY_TYPE_LABELS: Record<string, string> = {
  Person: '人物',
  Organization: '组织',
  Technology: '技术',
  Product: '产品',
  Location: '地点',
  Event: '事件',
  Concept: '概念',
};

const ENTITY_TYPES = [
  'Person',
  'Organization',
  'Technology',
  'Product',
  'Location',
  'Event',
  'Concept',
];



// ── Layout types ──────────────────────────────────────────

type LayoutMode = 'force' | 'concentric' | 'hierarchy' | 'radial';
type ViewMode = 'dotMatrix' | 'topology';

// ── Hierarchy layout (dagre) ──────────────────────────────

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const NODE_WIDTH = 160;
const NODE_HEIGHT = 40;

function hierarchyLayout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const laidNodes = nodes.map((node) => {
    const pos = dagreGraph.node(node.id);
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });

  return { nodes: laidNodes, edges };
}

// ── Force-directed layout (d3-force) ──────────────────────

interface SimNode {
  id: string;
  x: number;
  y: number;
  entityType: string;
}

function forceLayout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  // 按 entity_type 分区，给每种类型分配一个角度位置
  const types = [...new Set(nodes.map(n => n.data.entityType as string))];
  const typeAngle: Record<string, number> = {};
  types.forEach((t, i) => { typeAngle[t] = (2 * Math.PI * i) / types.length; });

  const RADIUS = Math.max(300, nodes.length * 3); // 聚类半径

  const simNodes: SimNode[] = nodes.map(n => ({
    id: n.id,
    x: Math.cos(typeAngle[n.data.entityType as string] || 0) * RADIUS * 0.5 + (Math.random() - 0.5) * 100,
    y: Math.sin(typeAngle[n.data.entityType as string] || 0) * RADIUS * 0.5 + (Math.random() - 0.5) * 100,
    entityType: n.data.entityType as string,
  }));

  const simLinks = edges.map(e => ({ source: e.source, target: e.target }));

  const simulation = forceSimulation(simNodes)
    .force('link', forceLink(simLinks).id((d: any) => d.id).distance(80).strength(0.3))
    .force('charge', forceManyBody().strength(-200))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide(35))
    // 聚类引力 - 同类型节点朝各自角度区域聚拢
    .force('x', forceX<SimNode>(d => Math.cos(typeAngle[d.entityType] || 0) * RADIUS * 0.4).strength(0.15))
    .force('y', forceY<SimNode>(d => Math.sin(typeAngle[d.entityType] || 0) * RADIUS * 0.4).strength(0.15))
    .stop();

  // 同步运行 300 次迭代
  for (let i = 0; i < 300; i++) simulation.tick();

  const posMap = new Map(simNodes.map(n => [n.id, { x: n.x, y: n.y }]));

  const laidNodes = nodes.map(n => ({
    ...n,
    position: posMap.get(n.id) || { x: 0, y: 0 },
  }));

  return { nodes: laidNodes, edges };
}

// ── Concentric layout ────────────────────────────────────

function concentricLayout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const groups: Record<string, Node[]> = {};
  nodes.forEach(n => {
    const t = n.data.entityType as string;
    if (!groups[t]) groups[t] = [];
    groups[t].push(n);
  });

  // 按节点数排序，最多的在中心
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  const laidNodes: Node[] = [];
  sorted.forEach(([_, group], ringIdx) => {
    const radius = (ringIdx + 1) * 150;
    group.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / group.length;
      laidNodes.push({
        ...n,
        position: {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        },
      });
    });
  });

  return { nodes: laidNodes, edges };
}

// ── Radial layout ────────────────────────────────────────

function radialLayout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  // 找到度数最高的节点作为中心
  const degreeMap: Record<string, number> = {};
  nodes.forEach(n => { degreeMap[n.id] = 0; });
  edges.forEach(e => {
    degreeMap[e.source] = (degreeMap[e.source] || 0) + 1;
    degreeMap[e.target] = (degreeMap[e.target] || 0) + 1;
  });

  const centerId = Object.entries(degreeMap).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!centerId) return { nodes, edges };

  // BFS 分层
  const visited = new Set<string>([centerId]);
  const layers: string[][] = [[centerId]];
  const adj: Record<string, string[]> = {};
  nodes.forEach(n => { adj[n.id] = []; });
  edges.forEach(e => {
    adj[e.source]?.push(e.target);
    adj[e.target]?.push(e.source);
  });

  let current = [centerId];
  while (current.length > 0) {
    const next: string[] = [];
    for (const id of current) {
      for (const neighbor of (adj[id] || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    if (next.length > 0) layers.push(next);
    current = next;
  }

  // 未连接的节点放最外层
  const unvisited = nodes.filter(n => !visited.has(n.id)).map(n => n.id);
  if (unvisited.length > 0) layers.push(unvisited);

  const posMap = new Map<string, { x: number; y: number }>();
  posMap.set(centerId, { x: 0, y: 0 });

  layers.forEach((layer, layerIdx) => {
    if (layerIdx === 0) return;
    const radius = layerIdx * 180;
    layer.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / layer.length;
      posMap.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
  });

  const laidNodes = nodes.map(n => ({
    ...n,
    position: posMap.get(n.id) || { x: 0, y: 0 },
  }));

  return { nodes: laidNodes, edges };
}

// ── Layout dispatcher ────────────────────────────────────

function applyLayout(mode: LayoutMode, nodes: Node[], edges: Edge[]) {
  switch (mode) {
    case 'force': return forceLayout(nodes, edges);
    case 'concentric': return concentricLayout(nodes, edges);
    case 'hierarchy': return hierarchyLayout(nodes, edges);
    case 'radial': return radialLayout(nodes, edges);
    default: return forceLayout(nodes, edges);
  }
}

// ── Custom node component ──────────────────────────────────

function EntityNode({ data }: { data: { label: string; entityType: string; highlighted: boolean; dimmed?: boolean; selected?: boolean } }) {
  const color = ENTITY_COLORS[data.entityType] || DEFAULT_COLOR;
  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 text-xs font-medium text-center shadow-sm transition-all duration-200 ${
        data.selected ? 'ring-2 ring-offset-2 ring-white scale-110' : data.highlighted ? 'ring-2 ring-offset-2 ring-indigo-500 scale-110' : ''
      } ${
        data.dimmed ? 'opacity-20' : ''
      }`}
      style={{
        borderColor: data.selected ? '#ffffff' : color,
        backgroundColor: `${color}25`,
        color: 'var(--text-primary)',
        minWidth: 80,
        maxWidth: 180,
      }}
    >
      <div className="flex items-center gap-1.5 justify-center">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{data.label}</span>
      </div>
      <span className="text-[10px] opacity-60">{ENTITY_TYPE_LABELS[data.entityType] || data.entityType}</span>
    </div>
  );
}



// ── Main Component ─────────────────────────────────────────

export default function KnowledgeGraph() {
  const { addToast } = useToast();

  // Data state
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(false);

  // Document filter state
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  // 左侧目录树状态
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [docsMap, setDocsMap] = useState<Record<string, Document[]>>({});

  // UI state
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force');
  const [viewMode, setViewMode] = useState<ViewMode>('topology');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingNode, setEditingNode] = useState(false);
  const [editNodeText, setEditNodeText] = useState('');
  const [editNodeType, setEditNodeType] = useState('');

  // Node detail state
  const [nodeDetail, setNodeDetail] = useState<NodeDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['info', 'sources', 'relations']));
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set());

  // Modal state
  const [showAddNodeModal, setShowAddNodeModal] = useState(false);
  const [showAddEdgeModal, setShowAddEdgeModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'node' | 'edge';
    id: string;
  } | null>(null);

  // Add node form
  const [newNodeText, setNewNodeText] = useState('');
  const [newNodeType, setNewNodeType] = useState('Person');

  // Add edge form
  const [edgeSourceId, setEdgeSourceId] = useState('');
  const [edgeTargetId, setEdgeTargetId] = useState('');
  const [edgeRelationType, setEdgeRelationType] = useState('');

  // React Flow state
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState([]);

const nodeTypes = { entity: EntityNode };

  // ── Load collections ───────────────────────────────────

  useEffect(() => {
    getCollections()
      .then(setCollections)
      .catch(() => addToast('error', '获取知识库列表失败'));
  }, []);

  // ── 目录树交互逻辑 ────────────────────────────────────

  // 折叠/展开知识库
  const toggleExpand = (collectionId: string) => {
    setExpandedCollections(prev => {
      const next = new Set(prev);
      if (next.has(collectionId)) {
        next.delete(collectionId);
      } else {
        next.add(collectionId);
        // 展开时加载文档列表（如果还未加载）
        if (!docsMap[collectionId]) {
          getDocuments(collectionId).then(docs => {
            setDocsMap(prev => ({ ...prev, [collectionId]: docs }));
          });
        }
      }
      return next;
    });
  };

  // 点击知识库 → 展示整库图谱
  const handleCollectionClick = (collectionId: string) => {
    setSelectedCollectionId(collectionId);
    setSelectedDocumentIds([]); // 清空文档选择 = 展示整库
  };

  // 点击文档 → toggle 多选
  const handleDocumentClick = (collectionId: string, docId: string) => {
    if (selectedCollectionId !== collectionId) {
      setSelectedCollectionId(collectionId);
      setSelectedDocumentIds([docId]);
    } else {
      setSelectedDocumentIds(prev => {
        if (prev.includes(docId)) {
          return prev.filter(id => id !== docId); // 如果全部取消，回到整库视图
        } else {
          return [...prev, docId];
        }
      });
    }
  };

  // ── Load graph data ─────────────────────────────────

  const loadGraph = async () => {
    setLoading(true);
    try {
      let data;
      if (selectedCollectionId) {
        data = await getKnowledgeGraph(selectedCollectionId, selectedDocumentIds.length > 0 ? selectedDocumentIds : undefined);
      } else {
        data = await getAllKnowledgeGraphs();
      }
      setGraphNodes(data.nodes || []);
      setGraphEdges(data.edges || []);
      if (selectedCollectionId) {
        const graphStats = await getGraphStats(selectedCollectionId);
        setStats(graphStats);
      } else {
        // Compute stats from loaded data for the all-graphs view
        const typeDist: Record<string, number> = {};
        (data.nodes || []).forEach((n: GraphNode) => {
          typeDist[n.entity_type] = (typeDist[n.entity_type] || 0) + 1;
        });
        setStats({
          node_count: (data.nodes || []).length,
          edge_count: (data.edges || []).length,
          entity_type_distribution: typeDist,
        });
      }
    } catch {
      addToast('error', '获取知识图谱失败');
      setGraphNodes([]);
      setGraphEdges([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraph();
  }, [selectedCollectionId, selectedDocumentIds]);

  // ── Compute filtered data ─────────────────────────────

  const filteredNodes = useMemo(() => {
    let result = graphNodes;
    if (typeFilters.length > 0) {
      result = result.filter((n) => typeFilters.includes(n.entity_type));
    }
    return result;
  }, [graphNodes, typeFilters]);

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes]
  );

  const filteredEdges = useMemo(
    () =>
      graphEdges.filter(
        (e) => filteredNodeIds.has(e.source_node_id) && filteredNodeIds.has(e.target_node_id)
      ),
    [graphEdges, filteredNodeIds]
  );

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>();
    const q = searchQuery.toLowerCase();
    return new Set(
      graphNodes
        .filter((n) => n.entity_text.toLowerCase().includes(q))
        .map((n) => n.id)
    );
  }, [searchQuery, graphNodes]);

  // 计算选中节点的直接关联节点集合
  const highlightedNodeIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const related = new Set<string>();
    related.add(selectedNode.id);
    graphEdges.forEach(e => {
      if (e.source_node_id === selectedNode.id) related.add(e.target_node_id);
      if (e.target_node_id === selectedNode.id) related.add(e.source_node_id);
    });
    return related;
  }, [selectedNode, graphEdges]);

  // 关联边的ID集合
  const highlightedEdgeIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const related = new Set<string>();
    graphEdges.forEach(e => {
      if (e.source_node_id === selectedNode.id || e.target_node_id === selectedNode.id) {
        related.add(e.id);
      }
    });
    return related;
  }, [selectedNode, graphEdges]);

  // 用 ref 存储，避免加入 useEffect 依赖导致频繁重建布局
  const highlightedNodeIdsRef = useRef(highlightedNodeIds);
  const highlightedEdgeIdsRef = useRef(highlightedEdgeIds);
  highlightedNodeIdsRef.current = highlightedNodeIds;
  highlightedEdgeIdsRef.current = highlightedEdgeIds;

  // ── Update React Flow ─────────────────────────────────

  useEffect(() => {
    if (filteredNodes.length === 0) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }

    const hasSelection = highlightedNodeIdsRef.current.size > 0;

    const flowNodes: Node[] = filteredNodes.map((gn) => ({
      id: gn.id,
      type: 'entity',
      data: {
        label: gn.entity_text,
        entityType: gn.entity_type,
        highlighted: searchMatches.has(gn.id),
        dimmed: hasSelection && !highlightedNodeIdsRef.current.has(gn.id),
        selected: hasSelection && gn.id === selectedNode?.id,
      },
      position: { x: 0, y: 0 },
    }));

    const flowEdges: Edge[] = filteredEdges.map((ge) => {
      const isHighlighted = highlightedEdgeIdsRef.current.has(ge.id);
      return {
        id: ge.id,
        source: ge.source_node_id,
        target: ge.target_node_id,
        style: {
          stroke: '#8B5CF6',
          strokeWidth: isHighlighted && hasSelection ? 2 : 1,
          opacity: hasSelection ? (isHighlighted ? 0.9 : 0.08) : 0.15,
        },
      };
    });

    const laid = applyLayout(layoutMode, flowNodes, flowEdges);
    setRfNodes(laid.nodes);
    setRfEdges(laid.edges);
  }, [filteredNodes, filteredEdges, searchMatches, layoutMode, selectedNode?.id, setRfNodes, setRfEdges]);

  // ── Node click handler ────────────────────────────────

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const gn = graphNodes.find((n) => n.id === node.id);
      if (gn) {
        setSelectedNode(gn);
        setSelectedEdge(null);
        setEditingNode(false);
        setEditNodeText(gn.entity_text);
        setEditNodeType(gn.entity_type);
        setPanelOpen(true);
      }
    },
    [graphNodes]
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const ge = graphEdges.find((e) => e.id === edge.id);
      if (ge) {
        setSelectedEdge(ge);
        setSelectedNode(null);
        setEditingNode(false);
        setPanelOpen(true);
      }
    },
    [graphEdges]
  );

  // ── Load node detail when selected ─────────────────────────
  useEffect(() => {
    if (selectedNode) {
      setDetailLoading(true);
      getNodeDetail(selectedNode.id)
        .then(setNodeDetail)
        .catch(() => setNodeDetail(null))
        .finally(() => setDetailLoading(false));
    } else {
      setNodeDetail(null);
    }
  }, [selectedNode?.id]);

  // ── CRUD handlers ─────────────────────────────────────

  const handleAddNode = async () => {
    if (!selectedCollectionId || !newNodeText.trim()) return;
    try {
      const created = await createGraphNode(selectedCollectionId, {
        entity_text: newNodeText.trim(),
        entity_type: newNodeType,
      });
      setGraphNodes((prev) => [...prev, created]);
      setShowAddNodeModal(false);
      setNewNodeText('');
      setNewNodeType('Person');
      addToast('success', '节点添加成功');
    } catch {
      addToast('error', '添加节点失败');
    }
  };

  const handleUpdateNode = async () => {
    if (!selectedCollectionId || !selectedNode) return;
    try {
      const updated = await updateGraphNode(selectedCollectionId, selectedNode.id, {
        entity_text: editNodeText.trim(),
        entity_type: editNodeType,
      });
      setGraphNodes((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n))
      );
      setSelectedNode(updated);
      setEditingNode(false);
      addToast('success', '节点更新成功');
    } catch {
      addToast('error', '更新节点失败');
    }
  };

  const handleDeleteNode = async () => {
    if (!selectedCollectionId || !confirmDelete || confirmDelete.type !== 'node') return;
    try {
      await deleteGraphNode(selectedCollectionId, confirmDelete.id);
      setGraphNodes((prev) => prev.filter((n) => n.id !== confirmDelete.id));
      setSelectedNode(null);
      setPanelOpen(false);
      setConfirmDelete(null);
      addToast('success', '节点已删除');
    } catch {
      addToast('error', '删除节点失败');
    }
  };

  const handleAddEdge = async () => {
    if (!selectedCollectionId || !edgeSourceId || !edgeTargetId || !edgeRelationType.trim()) return;
    if (edgeSourceId === edgeTargetId) {
      addToast('warning', '源节点和目标节点不能相同');
      return;
    }
    try {
      const created = await createGraphEdge(selectedCollectionId, {
        source_node_id: edgeSourceId,
        target_node_id: edgeTargetId,
        relation_type: edgeRelationType.trim(),
      });
      setGraphEdges((prev) => [...prev, created]);
      setShowAddEdgeModal(false);
      setEdgeSourceId('');
      setEdgeTargetId('');
      setEdgeRelationType('');
      addToast('success', '关系添加成功');
    } catch {
      addToast('error', '添加关系失败');
    }
  };

  const handleDeleteEdge = async () => {
    if (!selectedCollectionId || !confirmDelete || confirmDelete.type !== 'edge') return;
    try {
      await deleteGraphEdge(selectedCollectionId, confirmDelete.id);
      setGraphEdges((prev) => prev.filter((e) => e.id !== confirmDelete.id));
      setSelectedEdge(null);
      setPanelOpen(false);
      setConfirmDelete(null);
      addToast('success', '关系已删除');
    } catch {
      addToast('error', '删除关系失败');
    }
  };

  // ── GraphinView 数据（useMemo 避免每次渲染都新建数组触发重建） ──
  const graphinNodes = useMemo(
    () => filteredNodes.map(n => ({ id: n.id, label: n.entity_text, entityType: n.entity_type, highlighted: searchMatches.has(n.id) })),
    [filteredNodes, searchMatches]
  );

  const graphinEdges = useMemo(
    () => filteredEdges.map(e => ({ id: e.id, source: e.source_node_id, target: e.target_node_id, label: e.relation_type, confidence: e.confidence })),
    [filteredEdges]
  );

  // ── Render ────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* ── Top toolbar ──────────────────────────────── */}
      <div className="flex-shrink-0 relative z-20 bg-white/5 backdrop-blur-xl border-b border-white/10 px-5 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Title */}
          <div className="flex items-center gap-2 mr-2">
            <Network size={20} className="text-indigo-400" />
            <h1 className="text-lg font-bold text-white">知识图谱</h1>
          </div>



              {/* View mode selector */}
              <div className="flex items-center bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('dotMatrix')}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    viewMode === 'dotMatrix'
                      ? 'bg-indigo-500/20 text-indigo-400'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                  }`}
                >
                  点阵式
                </button>
                <button
                  onClick={() => setViewMode('topology')}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    viewMode === 'topology'
                      ? 'bg-indigo-500/20 text-indigo-400'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                  }`}
                >
                  拓扑式
                </button>
              </div>

              {/* Search */}
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索实体..."
                  className="pl-8 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white w-48 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
                />
              </div>

              {/* Layout mode selector */}
              <select
                value={layoutMode}
                onChange={(e) => setLayoutMode(e.target.value as LayoutMode)}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
              >
                <option value="force">力导向布局</option>
                <option value="concentric">同心圆布局</option>
                <option value="hierarchy">层级布局</option>
                <option value="radial">径向布局</option>
              </select>

              {/* Type filter */}
              <div className="relative">
                <button
                  onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors ${
                    typeFilters.length > 0
                      ? 'border-indigo-400/50 bg-indigo-500/10 text-indigo-400'
                      : 'border-white/10 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  <Filter size={14} />
                  过滤
                  {typeFilters.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-xs rounded-full">
                      {typeFilters.length}
                    </span>
                  )}
                </button>
                {showFilterDropdown && (
                  <div className="absolute top-full mt-1 left-0 bg-slate-800/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-lg z-50 py-2 w-44">
                    {ENTITY_TYPES.map((t) => (
                      <label
                        key={t}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/10 cursor-pointer text-sm text-gray-300"
                      >
                        <input
                          type="checkbox"
                          checked={typeFilters.includes(t)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setTypeFilters((prev) => [...prev, t]);
                            } else {
                              setTypeFilters((prev) => prev.filter((f) => f !== t));
                            }
                          }}
                          className="rounded border-gray-600 text-indigo-500 focus:ring-indigo-400 bg-white/5"
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: ENTITY_COLORS[t] || DEFAULT_COLOR }}
                        />
                        {ENTITY_TYPE_LABELS[t] || t}
                      </label>
                    ))}
                    <div className="border-t border-white/10 mt-1 pt-1 px-3">
                      <button
                        onClick={() => {
                          setTypeFilters([]);
                          setShowFilterDropdown(false);
                        }}
                        className="text-xs text-gray-500 hover:text-gray-300"
                      >
                        清除过滤
                      </button>
                    </div>
                  </div>
                )}
              </div>



              <div className="flex-1" />

              {/* Stats badge */}
              {stats && (
                <span className="text-xs text-gray-500 bg-white/5 px-2.5 py-1.5 rounded-lg border border-white/10">
                  {stats.node_count} 节点 · {stats.edge_count} 关系
                </span>
              )}

              {/* Action buttons */}
              <button
                onClick={() => setShowAddNodeModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-lg hover:bg-indigo-500/20 transition-colors"
              >
                <Plus size={14} />
                添加节点
              </button>
              <button
                onClick={() => {
                  if (graphNodes.length < 2) {
                    addToast('warning', '至少需要2个节点才能添加关系');
                    return;
                  }
                  setShowAddEdgeModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
              >
                <Link2 size={14} />
                添加关系
              </button>
        </div>
      </div>

      {/* ── Main content ──────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* ── Left sidebar: 知识库/文档目录树（浮动覆盖层） ────────────────── */}
        <aside
          className={`absolute top-0 left-0 bottom-0 w-60 z-30 bg-white/5 backdrop-blur-xl border-r border-white/10 shadow-[4px_0_24px_rgba(0,0,0,0.4)] flex flex-col transition-transform duration-300 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          {/* 收起按钮 */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">知识库</h3>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              title="收起目录"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {collections.length === 0 && (
              <p className="text-xs text-gray-500 py-2">暂无知识库</p>
            )}
            {collections.map(collection => (
              <div key={collection.id}>
                {/* 知识库行 */}
                <div
                  className={`flex items-center gap-1 py-1.5 px-2 rounded-md cursor-pointer hover:bg-white/5 group ${selectedCollectionId === collection.id && selectedDocumentIds.length === 0 ? 'bg-white/5' : ''}`}
                  onClick={() => handleCollectionClick(collection.id)}
                >
                  {/* 展开/折叠箭头 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(collection.id); }}
                    className="p-0.5 text-gray-500 hover:text-gray-300"
                  >
                    <ChevronRight size={14} className={`transition-transform ${expandedCollections.has(collection.id) ? 'rotate-90' : ''}`} />
                  </button>
                  {/* 文件夹图标 */}
                  <FolderOpen size={14} className="text-indigo-400 flex-shrink-0" />
                  {/* 知识库名 */}
                  <span
                    className={`text-sm truncate flex-1 ${selectedCollectionId === collection.id && selectedDocumentIds.length === 0 ? 'text-indigo-400 font-medium' : 'text-gray-300'}`}
                    title={collection.name}
                  >
                    {collection.name}
                  </span>
                </div>
                {/* 展开后的文档列表 */}
                {expandedCollections.has(collection.id) && (
                  <div className="ml-5 border-l border-white/5 pl-2">
                    {(docsMap[collection.id] || []).length === 0 && (
                      <p className="text-xs text-gray-600 py-1 px-2">加载中...</p>
                    )}
                    {(docsMap[collection.id] || []).map(doc => (
                      <div
                        key={doc.id}
                        onClick={() => handleDocumentClick(collection.id, doc.id)}
                        className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer text-sm hover:bg-white/5 ${selectedCollectionId === collection.id && selectedDocumentIds.includes(doc.id) ? 'bg-indigo-500/10 text-indigo-300' : 'text-gray-400'}`}
                      >
                        {/* 提取状态标记 */}
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${doc.graph_extracted ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                        {/* 文件图标 */}
                        <FileText size={12} className="flex-shrink-0 opacity-60" />
                        <span className="truncate" title={doc.filename}>{doc.filename}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* 展开按钮（目录栏收起时显示） */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-3 left-3 z-30 p-2 rounded-lg bg-white/5 backdrop-blur-xl border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors shadow-[0_0_12px_rgba(0,0,0,0.3)]"
            title="展开目录"
          >
            <FolderOpen size={18} />
          </button>
        )}

        {/* Graph area */}
        <div className="flex-1 relative overflow-hidden">
          {loading ? (
            <LoadingSpinner size="lg" />
          ) : graphNodes.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <EmptyState
                icon={<Network size={64} className="text-indigo-500/30" />}
                title="暂无图谱数据"
                description="请先在知识库管理中提取实体"
              />
            </div>
          ) : (
            <>
              {viewMode === 'topology' ? (
                <GraphinView
                  nodes={graphinNodes}
                  edges={graphinEdges}
                  layoutMode={layoutMode}
                  onNodeClick={(id) => {
                    const gn = graphNodes.find(n => n.id === id);
                    if (gn) {
                      setSelectedNode(gn);
                      setSelectedEdge(null);
                      setEditingNode(false);
                      setEditNodeText(gn.entity_text);
                      setEditNodeType(gn.entity_type);
                      setPanelOpen(true);
                    }
                  }}
                  onEdgeClick={(id) => {
                    const ge = graphEdges.find(e => e.id === id);
                    if (ge) {
                      setSelectedEdge(ge);
                      setSelectedNode(null);
                      setEditingNode(false);
                      setPanelOpen(true);
                    }
                  }}
                  onCanvasClick={() => {
                    setSelectedNode(null);
                    setSelectedEdge(null);
                    setPanelOpen(false);
                  }}
                  entityColors={ENTITY_COLORS}
                  selectedNodeId={selectedNode?.id || null}
                  highlightedNodeIds={highlightedNodeIds}
                  highlightedEdgeIds={highlightedEdgeIds}
                />
              ) : (
                <ReactFlow
                  nodes={rfNodes}
                  edges={rfEdges}
                  onNodesChange={onRfNodesChange}
                  onEdgesChange={onRfEdgesChange}
                  onNodeClick={onNodeClick}
                  onEdgeClick={onEdgeClick}
                  onPaneClick={() => {
                    setSelectedNode(null);
                    setSelectedEdge(null);
                    setPanelOpen(false);
                  }}
                  nodeTypes={nodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  minZoom={0.1}
                  maxZoom={2}
                  className="bg-slate-900/80 theme-surface"
                >
                  <Controls />
                  <Background color="var(--text-muted)" gap={16} />
                  <MiniMap
                    nodeColor={(node) => {
                      const et = node.data?.entityType as string | undefined;
                      return ENTITY_COLORS[et || ''] || DEFAULT_COLOR;
                    }}
                    maskColor="rgba(0,0,0,0.08)"
                  />
                </ReactFlow>
              )}
              {/* 图例面板 - 左下角 */}
              <div className="absolute bottom-4 left-4 z-10 bg-gray-900/90 backdrop-blur-sm border border-white/10 rounded-lg p-3 max-h-60 overflow-y-auto">
                <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">图例</h4>
                {Object.entries(
                  filteredNodes.reduce<Record<string, number>>((acc, n) => {
                    acc[n.entity_type] = (acc[n.entity_type] || 0) + 1;
                    return acc;
                  }, {})
                )
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <div key={type} className="flex items-center gap-2 py-1">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: ENTITY_COLORS[type] || DEFAULT_COLOR }} />
                      <span className="text-xs text-gray-300 flex-1">{ENTITY_TYPE_LABELS[type] || type}</span>
                      <span className="text-xs text-gray-500">{count}</span>
                    </div>
                  ))
                }
              </div>
            </>
          )}
        </div>

        {/* ── Right panel ────────────────────────────────── */}
        {panelOpen && (
          <div className="absolute top-0 right-0 bottom-0 w-80 z-30 bg-white/5 backdrop-blur-xl border-l border-white/10 flex flex-col overflow-y-auto shadow-[-4px_0_24px_rgba(0,0,0,0.4)] transition-transform duration-300 ease-out">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">
                {selectedNode ? '节点详情' : '关系详情'}
              </h3>
              <button
                onClick={() => {
                  setPanelOpen(false);
                  setSelectedNode(null);
                  setSelectedEdge(null);
                }}
                className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            {/* Node detail */}
            {selectedNode && (
              <div className="p-4 space-y-4">
                {editingNode ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        实体名称
                      </label>
                      <input
                        type="text"
                        value={editNodeText}
                        onChange={(e) => setEditNodeText(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        实体类型
                      </label>
                      <select
                        value={editNodeType}
                        onChange={(e) => setEditNodeType(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
                      >
                        {ENTITY_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {ENTITY_TYPE_LABELS[t] || t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleUpdateNode}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-cyan-600 rounded-lg hover:from-indigo-400 hover:to-cyan-500"
                      >
                        <Save size={14} />
                        保存
                      </button>
                      <button
                        onClick={() => setEditingNode(false)}
                        className="flex-1 px-3 py-2 text-sm font-medium text-gray-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-1">
                    {/* ── 折叠区块1: 基本信息 ── */}
                    <button
                      onClick={() => {
                        setExpandedSections(prev => {
                          const next = new Set(prev);
                          next.has('info') ? next.delete('info') : next.add('info');
                          return next;
                        });
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg text-sm hover:bg-white/10 transition-colors"
                    >
                      <span className="font-medium text-white">基本信息</span>
                      <ChevronRight
                        size={14}
                        className={`text-gray-400 transition-transform ${expandedSections.has('info') ? 'rotate-90' : ''}`}
                      />
                    </button>
                    {expandedSections.has('info') && (
                      <div className="px-3 pb-3 pt-1 space-y-3">
                        <div>
                          <span className="text-xs font-medium text-gray-500">实体名称</span>
                          <p className="text-sm text-white mt-0.5">{selectedNode.entity_text}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-gray-500">实体类型</span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: ENTITY_COLORS[selectedNode.entity_type] || DEFAULT_COLOR }}
                            />
                            <span className="text-sm text-white">
                              {ENTITY_TYPE_LABELS[selectedNode.entity_type] || selectedNode.entity_type}
                            </span>
                          </div>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-gray-500">创建时间</span>
                          <p className="text-sm text-white mt-0.5">
                            {new Date(selectedNode.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex gap-2 pt-2 border-t border-white/10">
                          <button
                            onClick={() => setEditingNode(true)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-lg hover:bg-indigo-500/20"
                          >
                            <Edit3 size={14} />
                            编辑
                          </button>
                          <button
                            onClick={() => setConfirmDelete({ type: 'node', id: selectedNode.id })}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20"
                          >
                            <Trash2 size={14} />
                            删除
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── 折叠区块2: 来源出处 ── */}
                    <button
                      onClick={() => {
                        setExpandedSections(prev => {
                          const next = new Set(prev);
                          next.has('sources') ? next.delete('sources') : next.add('sources');
                          return next;
                        });
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg text-sm hover:bg-white/10 transition-colors"
                    >
                      <span className="font-medium text-white">来源出处</span>
                      <div className="flex items-center gap-2">
                        {nodeDetail && nodeDetail.source_chunks.length > 0 && (
                          <span className="px-1.5 py-0.5 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-xs rounded-full">
                            {nodeDetail.source_chunks.length}
                          </span>
                        )}
                        <ChevronRight
                          size={14}
                          className={`text-gray-400 transition-transform ${expandedSections.has('sources') ? 'rotate-90' : ''}`}
                        />
                      </div>
                    </button>
                    {expandedSections.has('sources') && (
                      <div className="px-3 pb-3 pt-1 space-y-2">
                        {detailLoading ? (
                          <div className="flex items-center justify-center py-4">
                            <LoadingSpinner size="sm" />
                          </div>
                        ) : nodeDetail && nodeDetail.source_chunks.length > 0 ? (
                          nodeDetail.source_chunks.map((chunk) => {
                            const content = chunk.content;
                            const isLong = content.length > 150;
                            const isExpanded = expandedChunks.has(chunk.chunk_id);
                            const displayText = isExpanded ? content : content.slice(0, 150);
                            return (
                              <div key={chunk.chunk_id} className="bg-white/5 rounded-lg p-2.5">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <FileText size={12} className="text-indigo-400" />
                                  <span className="text-xs font-medium text-white">{chunk.document_name}</span>
                                  <span className="text-xs text-gray-500">#{chunk.chunk_index}</span>
                                </div>
                                <p className="text-xs text-gray-300 leading-relaxed">
                                  {displayText}
                                  {isLong && !isExpanded && '...'}
                                  {isLong && (
                                    <button
                                      onClick={() => {
                                        setExpandedChunks(prev => {
                                          const next = new Set(prev);
                                          next.has(chunk.chunk_id) ? next.delete(chunk.chunk_id) : next.add(chunk.chunk_id);
                                          return next;
                                        });
                                      }}
                                      className="ml-1 text-indigo-400 hover:text-indigo-300"
                                    >
                                      {isExpanded ? '收起' : '展开全文'}
                                    </button>
                                  )}
                                </p>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-gray-500 py-2">暂无来源数据</p>
                        )}
                      </div>
                    )}

                    {/* ── 折叠区块3: 相关关系 ── */}
                    <button
                      onClick={() => {
                        setExpandedSections(prev => {
                          const next = new Set(prev);
                          next.has('relations') ? next.delete('relations') : next.add('relations');
                          return next;
                        });
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg text-sm hover:bg-white/10 transition-colors"
                    >
                      <span className="font-medium text-white">相关关系</span>
                      <div className="flex items-center gap-2">
                        {(nodeDetail?.related_edges.length ?? graphEdges.filter(e => e.source_node_id === selectedNode.id || e.target_node_id === selectedNode.id).length) > 0 && (
                          <span className="px-1.5 py-0.5 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-xs rounded-full">
                            {nodeDetail?.related_edges.length ?? graphEdges.filter(e => e.source_node_id === selectedNode.id || e.target_node_id === selectedNode.id).length}
                          </span>
                        )}
                        <ChevronRight
                          size={14}
                          className={`text-gray-400 transition-transform ${expandedSections.has('relations') ? 'rotate-90' : ''}`}
                        />
                      </div>
                    </button>
                    {expandedSections.has('relations') && (
                      <div className="px-3 pb-3 pt-1 space-y-1.5">
                        {/* 优先从 nodeDetail 取，fallback 从 graphEdges 过滤 */}
                        {(nodeDetail?.related_edges.length ?? 0) > 0
                          ? nodeDetail!.related_edges.map((de) => {
                              const isOutgoing = de.direction === 'outgoing';
                              const otherText = isOutgoing ? de.target_text : de.source_text;
                              // 尝试从 graphNodes 获取对端节点类型
                              const otherNodeId = isOutgoing ? de.target_node_id : de.source_node_id;
                              const otherNode = graphNodes.find(n => n.id === otherNodeId);
                              const otherType = otherNode?.entity_type || '';
                              const otherColor = ENTITY_COLORS[otherType] || DEFAULT_COLOR;
                              return (
                                <div
                                  key={de.id}
                                  className="flex items-center justify-between px-2.5 py-1.5 bg-white/5 rounded-lg text-xs hover:bg-white/10 transition-colors"
                                >
                                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                    <span className="text-gray-400 flex-shrink-0">
                                      {isOutgoing ? '→' : '←'}
                                    </span>
                                    <span className="text-indigo-300 font-medium truncate">{de.relation_type}</span>
                                    <span className="text-gray-300 truncate">{otherText}</span>
                                    {otherType && (
                                      <span
                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: otherColor }}
                                      />
                                    )}
                                    <span className="text-gray-500 ml-auto">
                                      {(de.confidence * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => {
                                      const ge = graphEdges.find(e => e.id === de.id);
                                      if (ge) {
                                        setSelectedEdge(ge);
                                        setSelectedNode(null);
                                        setEditingNode(false);
                                      }
                                    }}
                                    className="text-gray-500 hover:text-white ml-1"
                                  >
                                    <ChevronRight size={14} />
                                  </button>
                                </div>
                              );
                            })
                          : graphEdges
                              .filter(e => e.source_node_id === selectedNode.id || e.target_node_id === selectedNode.id)
                              .length > 0
                            ? graphEdges
                                .filter(e => e.source_node_id === selectedNode.id || e.target_node_id === selectedNode.id)
                                .map((e) => {
                                  const isSource = e.source_node_id === selectedNode.id;
                                  const otherId = isSource ? e.target_node_id : e.source_node_id;
                                  const other = graphNodes.find(n => n.id === otherId);
                                  return (
                                    <div
                                      key={e.id}
                                      className="flex items-center justify-between px-2.5 py-1.5 bg-white/5 rounded-lg text-xs hover:bg-white/10 transition-colors"
                                    >
                                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                        <span className="text-gray-400 flex-shrink-0">
                                          {isSource ? '→' : '←'}
                                        </span>
                                        <span className="text-indigo-300 font-medium truncate">{e.relation_type}</span>
                                        <span className="text-gray-300 truncate">{other?.entity_text || otherId.slice(0, 8)}</span>
                                        {other && (
                                          <span
                                            className="w-2 h-2 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: ENTITY_COLORS[other.entity_type] || DEFAULT_COLOR }}
                                          />
                                        )}
                                        <span className="text-gray-500 ml-auto">
                                          {(e.confidence * 100).toFixed(0)}%
                                        </span>
                                      </div>
                                      <button
                                        onClick={() => {
                                          setSelectedEdge(e);
                                          setSelectedNode(null);
                                          setEditingNode(false);
                                        }}
                                        className="text-gray-500 hover:text-white ml-1"
                                      >
                                        <ChevronRight size={14} />
                                      </button>
                                    </div>
                                  );
                                })
                            : (
                              <p className="text-xs text-gray-500 py-2">暂无相关关系</p>
                            )
                        }
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Edge detail */}
            {selectedEdge && !selectedNode && (
              <div className="p-4 space-y-4">
                <div className="space-y-3">
                  <div>
                    <span className="text-xs font-medium text-gray-500">源节点</span>
                    <p className="text-sm text-white mt-0.5">
                      {graphNodes.find((n) => n.id === selectedEdge.source_node_id)
                        ?.entity_text || selectedEdge.source_node_id.slice(0, 8)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500">关系类型</span>
                    <p className="text-sm text-white mt-0.5">
                      {selectedEdge.relation_type}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500">目标节点</span>
                    <p className="text-sm text-white mt-0.5">
                      {graphNodes.find((n) => n.id === selectedEdge.target_node_id)
                        ?.entity_text || selectedEdge.target_node_id.slice(0, 8)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500">置信度</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-cyan-600 rounded-full"
                          style={{ width: `${selectedEdge.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-sm text-white">
                        {(selectedEdge.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500">证据Chunk数</span>
                    <p className="text-sm text-white mt-0.5">
                      {selectedEdge.evidence_chunks?.length ?? 0}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500">创建时间</span>
                    <p className="text-sm text-white mt-0.5">
                      {new Date(selectedEdge.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 pt-2 border-t border-white/10">
                  <button
                    onClick={() =>
                      setConfirmDelete({ type: 'edge', id: selectedEdge.id })
                    }
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20"
                  >
                    <Trash2 size={14} />
                    删除关系
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Add Node Modal ──────────────────────────────── */}
      <Modal
        isOpen={showAddNodeModal}
        onClose={() => setShowAddNodeModal(false)}
        title="添加节点"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">实体名称</label>
            <input
              type="text"
              value={newNodeText}
              onChange={(e) => setNewNodeText(e.target.value)}
              placeholder="输入实体名称"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">实体类型</label>
            <select
              value={newNodeType}
              onChange={(e) => setNewNodeType(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ENTITY_TYPE_LABELS[t] || t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setShowAddNodeModal(false)}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-300 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20"
            >
              取消
            </button>
            <button
              onClick={handleAddNode}
              disabled={!newNodeText.trim()}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-cyan-600 rounded-lg hover:from-indigo-400 hover:to-cyan-500 disabled:opacity-50"
            >
              添加
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Add Edge Modal ──────────────────────────────── */}
      <Modal
        isOpen={showAddEdgeModal}
        onClose={() => setShowAddEdgeModal(false)}
        title="添加关系"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">源节点</label>
            <select
              value={edgeSourceId}
              onChange={(e) => setEdgeSourceId(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
            >
              <option value="">选择源节点</option>
              {graphNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.entity_text} ({n.entity_type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              关系类型
            </label>
            <input
              type="text"
              value={edgeRelationType}
              onChange={(e) => setEdgeRelationType(e.target.value)}
              placeholder="如：belongs_to, located_in, created_by"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">目标节点</label>
            <select
              value={edgeTargetId}
              onChange={(e) => setEdgeTargetId(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
            >
              <option value="">选择目标节点</option>
              {graphNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.entity_text} ({n.entity_type})
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setShowAddEdgeModal(false)}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-300 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20"
            >
              取消
            </button>
            <button
              onClick={handleAddEdge}
              disabled={!edgeSourceId || !edgeTargetId || !edgeRelationType.trim()}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-cyan-600 rounded-lg hover:from-indigo-400 hover:to-cyan-500 disabled:opacity-50"
            >
              添加
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Confirm delete dialog ──────────────────────── */}
      <ConfirmDialog
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDelete?.type === 'node' ? handleDeleteNode : handleDeleteEdge}
        title={confirmDelete?.type === 'node' ? '删除节点' : '删除关系'}
        message={
          confirmDelete?.type === 'node'
            ? '确定要删除此节点吗？相关的所有关系也会被删除。'
            : '确定要删除此关系吗？'
        }
      />
    </div>
  );
}
