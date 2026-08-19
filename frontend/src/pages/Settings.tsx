import { useState, useEffect, useRef } from 'react';
import {
  Settings as SettingsIcon,
  Upload,
  Eye,
  EyeOff,
  Save,
  Loader2,
  ImageIcon,
  Sun,
  Moon,
  Sliders,
} from 'lucide-react';
import { getSettings, updateSettings, uploadLogo } from '../api/client';
import { useToast } from '../components/Toast';
import { useSystem } from '../App';
import type { SettingsResponse } from '../types';

export default function Settings() {
  const { addToast } = useToast();
  const { refreshSettings, theme, setTheme } = useSystem();
  const [loading, setLoading] = useState(true);
  const [settingsData, setSettingsData] = useState<SettingsResponse | null>(null);

  // 系统信息表单
  const [systemName, setSystemName] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingSystem, setSavingSystem] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // LLM 配置表单
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModelName, setLlmModelName] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingLlm, setSavingLlm] = useState(false);

  // 图谱提取精度表单
  const [graphMaxGleanings, setGraphMaxGleanings] = useState(1);
  const [graphDedupEnabled, setGraphDedupEnabled] = useState(false);
  const [graphConfidenceFilter, setGraphConfidenceFilter] = useState(false);
  const [graphConfidenceThreshold, setGraphConfidenceThreshold] = useState(0.5);
  const [savingGraph, setSavingGraph] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await getSettings();
      setSettingsData(data);
      setSystemName(data.system_name);
      setLlmBaseUrl(data.llm_base_url);
      setLlmApiKey(data.llm_api_key);
      setLlmModelName(data.llm_model_name);
      setGraphMaxGleanings(data.graph_max_gleanings);
      setGraphDedupEnabled(data.graph_dedup_enabled);
      setGraphConfidenceFilter(data.graph_confidence_filter);
      setGraphConfidenceThreshold(data.graph_confidence_threshold);
      if (data.logo_url) {
        setLogoPreview(`http://localhost:8000${data.logo_url}`);
      }
    } catch {
      addToast('error', '获取配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (!file.type.match(/image\/(png|jpeg|svg\+xml)/)) {
      addToast('error', '仅支持 PNG/JPG/SVG 格式');
      return;
    }
    try {
      setUploadingLogo(true);
      const res = await uploadLogo(file);
      setLogoPreview(`http://localhost:8000${res.logo_url}`);
      addToast('success', 'Logo 上传成功');
      refreshSettings();
    } catch {
      addToast('error', 'Logo 上传失败');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleLogoUpload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleLogoUpload(file);
  };

  const handleSaveSystem = async () => {
    try {
      setSavingSystem(true);
      await updateSettings({ system_name: systemName });
      addToast('success', '系统信息已保存');
      refreshSettings();
      loadSettings();
    } catch {
      addToast('error', '保存失败');
    } finally {
      setSavingSystem(false);
    }
  };

  const handleSaveLlm = async () => {
    try {
      setSavingLlm(true);
      await updateSettings({
        llm_base_url: llmBaseUrl,
        llm_api_key: llmApiKey,
        llm_model_name: llmModelName,
      });
      addToast('success', 'LLM 配置已保存');
      loadSettings();
    } catch {
      addToast('error', '保存失败');
    } finally {
      setSavingLlm(false);
    }
  };

  const handleSaveGraph = async () => {
    try {
      setSavingGraph(true);
      await updateSettings({
        graph_max_gleanings: graphMaxGleanings,
        graph_dedup_enabled: graphDedupEnabled,
        graph_confidence_filter: graphConfidenceFilter,
        graph_confidence_threshold: graphConfidenceThreshold,
      });
      addToast('success', '图谱提取精度已保存');
      loadSettings();
    } catch {
      addToast('error', '保存失败');
    } finally {
      setSavingGraph(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">系统配置</h1>
        <p className="text-sm text-gray-400 mt-1">管理系统信息和LLM配置</p>
      </div>

      {/* 外观设置卡片 */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6 mb-6 animate-stagger">
        <div className="flex items-center gap-2 mb-5">
          <Sun size={20} className="text-indigo-400" />
          <h2 className="text-lg font-semibold text-white">外观设置</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* 深色主题 */}
          <button
            onClick={() => setTheme('dark')}
            className={`relative flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all duration-200 ${
              theme === 'dark'
                ? 'border-indigo-400 bg-indigo-500/10 shadow-lg shadow-indigo-500/10'
                : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
            }`}
          >
            {/* 深色预览色块 */}
            <div className="w-full h-20 rounded-lg overflow-hidden flex flex-col"
              style={{ background: 'linear-gradient(135deg, #0f172a 0%, #0c1929 50%, #0f172a 100%)' }}
            >
              <div className="flex items-center gap-1.5 px-3 py-2">
                <div className="w-3 h-3 rounded-sm bg-indigo-500/30" />
                <div className="w-12 h-2 rounded-sm bg-white/20" />
              </div>
              <div className="flex-1 flex items-center justify-center gap-3 px-3">
                <div className="w-8 h-6 rounded bg-white/10 border border-white/10" />
                <div className="w-8 h-6 rounded bg-white/10 border border-white/10" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Moon size={16} className={theme === 'dark' ? 'text-indigo-400' : 'text-gray-400'} />
              <span className={`text-sm font-medium ${theme === 'dark' ? 'text-indigo-400' : 'text-gray-300'}`}>
                深色主题
              </span>
            </div>
            {theme === 'dark' && (
              <div className="absolute top-2 right-2 w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </button>

          {/* 浅色主题 */}
          <button
            onClick={() => setTheme('light')}
            className={`relative flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all duration-200 ${
              theme === 'light'
                ? 'border-indigo-400 bg-indigo-500/10 shadow-lg shadow-indigo-500/10'
                : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
            }`}
          >
            {/* 浅色预览色块 */}
            <div className="w-full h-20 rounded-lg overflow-hidden flex flex-col"
              style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #eef2f7 50%, #f8fafc 100%)' }}
            >
              <div className="flex items-center gap-1.5 px-3 py-2">
                <div className="w-3 h-3 rounded-sm bg-indigo-500/20" />
                <div className="w-12 h-2 rounded-sm bg-gray-300" />
              </div>
              <div className="flex-1 flex items-center justify-center gap-3 px-3">
                <div className="w-8 h-6 rounded bg-white border border-gray-200 shadow-sm" />
                <div className="w-8 h-6 rounded bg-white border border-gray-200 shadow-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Sun size={16} className={theme === 'light' ? 'text-indigo-400' : 'text-gray-400'} />
              <span className={`text-sm font-medium ${theme === 'light' ? 'text-indigo-400' : 'text-gray-300'}`}>
                浅色主题
              </span>
            </div>
            {theme === 'light' && (
              <div className="absolute top-2 right-2 w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </button>
        </div>
      </div>

      {/* 系统信息卡片 */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6 mb-6 animate-stagger" style={{ animationDelay: '60ms' }}>
        <div className="flex items-center gap-2 mb-5">
          <SettingsIcon size={20} className="text-indigo-400" />
          <h2 className="text-lg font-semibold text-white">系统信息</h2>
        </div>

        {/* Logo 上传 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-300 mb-2">系统 Logo</label>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative border-2 rounded-lg p-6 text-center transition-colors cursor-pointer ${
              dragOver ? 'border-indigo-400 bg-indigo-500/10' : 'border-white/20 bg-white/5 hover:border-white/40'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.svg"
              onChange={handleFileChange}
              className="hidden"
            />
            {uploadingLogo ? (
              <div className="flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                <span className="ml-2 text-sm text-gray-400">上传中...</span>
              </div>
            ) : logoPreview ? (
              <div className="flex flex-col items-center gap-2">
                <img
                  src={logoPreview}
                  alt="Logo"
                  className="w-16 h-16 object-contain rounded"
                  onError={() => setLogoPreview(null)}
                />
                <p className="text-xs text-gray-500">点击或拖拽更换 Logo</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <ImageIcon size={32} className="text-gray-600" />
                <p className="text-sm text-gray-400">点击或拖拽上传 Logo</p>
                <p className="text-xs text-gray-500">支持 PNG / JPG / SVG</p>
              </div>
            )}
          </div>
        </div>

        {/* 系统名称 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-300 mb-2">系统名称</label>
          <input
            type="text"
            value={systemName}
            onChange={(e) => setSystemName(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="矩阵-知识库管理系统"
          />
          {systemName && (
            <p className="mt-2 text-xs text-gray-500">
              预览效果：<span className="font-semibold text-gray-300">{systemName}</span>
            </p>
          )}
        </div>

        {/* 版本号（只读） */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-300 mb-2">系统版本</label>
          <input
            type="text"
            value={settingsData?.system_version || 'v1.02'}
            readOnly
            className="w-full px-4 py-2.5 border border-white/5 rounded-lg text-sm bg-white/5 text-gray-500"
          />
          <p className="mt-1 text-xs text-gray-500">版本号由系统自动管理</p>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSaveSystem}
            disabled={savingSystem}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 btn-hover-scale"
          >
            {savingSystem ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {savingSystem ? '保存中...' : '保存系统信息'}
          </button>
        </div>
      </div>

      {/* LLM 配置卡片 */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6 animate-stagger" style={{ animationDelay: '120ms' }}>
        <div className="flex items-center gap-2 mb-5">
          <SettingsIcon size={20} className="text-gray-400" />
          <h2 className="text-lg font-semibold text-white">LLM 配置</h2>
        </div>

        <div className="space-y-4">
          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Base URL</label>
            <input
              type="text"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
              placeholder="https://api.openai.com/v1"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                className="w-full px-4 py-2.5 pr-10 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
                placeholder="sk-..."
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-white transition-colors"
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">API Key 存储时完整保存，返回时仅显示最后4位</p>
          </div>

          {/* 模型名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">模型名称</label>
            <input
              type="text"
              value={llmModelName}
              onChange={(e) => setLlmModelName(e.target.value)}
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
              placeholder="gpt-4"
            />
          </div>

          {/* 测试连接 */}
          <div className="flex items-center gap-3">
            <button
              disabled
              className="flex items-center gap-2 px-4 py-2 bg-white/5 text-gray-500 text-sm font-medium rounded-lg cursor-not-allowed border border-white/5"
            >
              <Upload size={16} />
              测试连接
            </button>
            <span className="text-xs text-gray-500">即将支持</span>
          </div>
        </div>

        <div className="flex justify-end mt-5">
          <button
            onClick={handleSaveLlm}
            disabled={savingLlm}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-sm font-medium rounded-lg hover:from-indigo-400 hover:to-cyan-500 transition-colors disabled:opacity-50 btn-hover-scale"
          >
            {savingLlm ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {savingLlm ? '保存中...' : '保存 LLM 配置'}
          </button>
        </div>
      </div>

      {/* 图谱提取精度卡片 */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6 mt-6 animate-stagger" style={{ animationDelay: '180ms' }}>
        <div className="flex items-center gap-2 mb-5">
          <Sliders size={20} className="text-purple-400" />
          <h2 className="text-lg font-semibold text-white">图谱提取精度</h2>
        </div>

        <div className="space-y-5">
          {/* Gleaning 轮数 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Gleaning 轮数</label>
            <input
              type="number"
              min={0}
              max={3}
              step={1}
              value={graphMaxGleanings}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setGraphMaxGleanings(Math.min(3, Math.max(0, v)));
              }}
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
            />
            <p className="mt-1.5 text-xs text-gray-500">提取后追问LLM是否遗漏的轮数，0=禁用，推荐1-2</p>
          </div>

          {/* 实体去重 */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-300">实体去重</label>
              <p className="text-xs text-gray-500 mt-0.5">启用模糊匹配去重，合并相似实体</p>
            </div>
            <button
              type="button"
              onClick={() => setGraphDedupEnabled(!graphDedupEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                graphDedupEnabled ? 'bg-indigo-500' : 'bg-white/10'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                  graphDedupEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* 置信度过滤 */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-300">置信度过滤</label>
              <p className="text-xs text-gray-500 mt-0.5">过滤低置信度关系，提升图谱质量</p>
            </div>
            <button
              type="button"
              onClick={() => setGraphConfidenceFilter(!graphConfidenceFilter)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                graphConfidenceFilter ? 'bg-indigo-500' : 'bg-white/10'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                  graphConfidenceFilter ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* 置信度阈值 */}
          {graphConfidenceFilter && (
            <div className="pl-0">
              <label className="block text-sm font-medium text-gray-300 mb-2">置信度阈值</label>
              <input
                type="number"
                min={0.1}
                max={1.0}
                step={0.05}
                value={graphConfidenceThreshold}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) setGraphConfidenceThreshold(Math.min(1.0, Math.max(0.1, v)));
                }}
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
              />
              <p className="mt-1.5 text-xs text-gray-500">低于此阈值的关系将被过滤</p>
            </div>
          )}
        </div>

        <div className="flex justify-end mt-5">
          <button
            onClick={handleSaveGraph}
            disabled={savingGraph}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-medium rounded-lg hover:from-indigo-400 hover:to-purple-500 transition-colors disabled:opacity-50 btn-hover-scale"
          >
            {savingGraph ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {savingGraph ? '保存中...' : '保存图谱配置'}
          </button>
        </div>
      </div>
    </div>
  );
}
