import { useCallback, useRef, useState } from 'react';
import { UploadCloud, X, FileText, FileSpreadsheet, Presentation, FileImage, FileType } from 'lucide-react';

interface FileUploadProps {
  onUpload: (files: File[]) => void;
  supportedFormats?: string[];
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['pdf'].includes(ext)) return <FileText size={16} className="text-red-400 flex-shrink-0" />;
  if (['doc', 'docx'].includes(ext)) return <FileType size={16} className="text-blue-400 flex-shrink-0" />;
  if (['ppt', 'pptx'].includes(ext)) return <Presentation size={16} className="text-orange-400 flex-shrink-0" />;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet size={16} className="text-green-400 flex-shrink-0" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif'].includes(ext)) return <FileImage size={16} className="text-purple-400 flex-shrink-0" />;
  return <FileText size={16} className="text-gray-400 flex-shrink-0" />;
}

function getFormatIcon(format: string) {
  const ext = format.replace('.', '').toLowerCase();
  if (['pdf'].includes(ext)) return <FileText size={12} className="text-red-400" />;
  if (['doc', 'docx'].includes(ext)) return <FileType size={12} className="text-blue-400" />;
  if (['ppt', 'pptx'].includes(ext)) return <Presentation size={12} className="text-orange-400" />;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet size={12} className="text-green-400" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif'].includes(ext)) return <FileImage size={12} className="text-purple-400" />;
  return <FileText size={12} className="text-gray-400" />;
}

export default function FileUpload({
  onUpload,
  supportedFormats,
}: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    setSelectedFiles((prev) => [...prev, ...Array.from(files)]);
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (selectedFiles.length > 0) {
      onUpload(selectedFiles);
      setSelectedFiles([]);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer backdrop-blur-md ${
          dragActive
            ? 'border-indigo-400 bg-indigo-500/10'
            : 'border-white/20 hover:border-white/40 bg-white/5'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud
          className={`mx-auto mb-3 ${dragActive ? 'text-indigo-400' : 'text-gray-500'}`}
          size={36}
        />
        <p className="text-sm text-gray-400 mb-1">
          拖拽文件到此处，或 <span className="text-indigo-400 font-medium">点击选择文件</span>
        </p>
        <p className="text-xs text-gray-500">支持多文件同时上传</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {supportedFormats && supportedFormats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {supportedFormats.map((fmt) => (
            <span
              key={fmt}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 border border-white/10 rounded text-xs text-gray-400"
            >
              {getFormatIcon(fmt)}
              {fmt}
            </span>
          ))}
        </div>
      )}

      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          {selectedFiles.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center gap-3 bg-white/5 backdrop-blur-md border border-white/10 rounded-lg px-3 py-2"
            >
              {getFileIcon(file.name)}
              <span className="text-sm text-gray-300 flex-1 truncate">{file.name}</span>
              <span className="text-xs text-gray-500">{formatSize(file.size)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(i);
                }}
                className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={handleSubmit}
            className="w-full py-2.5 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-sm font-medium rounded-lg hover:from-indigo-400 hover:to-cyan-500 transition-colors btn-hover-scale"
          >
            {`上传 ${selectedFiles.length} 个文件`}
          </button>
        </div>
      )}
    </div>
  );
}
