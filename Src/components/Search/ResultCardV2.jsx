import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Folder, File, ChevronDown, ChevronRight, 
  Film, Music, Image, FileText, Archive, 
  HardDrive, Clock, Hash, Layers, Sparkles
} from 'lucide-react';
import GlassCard from '../ui/GlassCard';

// 文件类型图标
const FileTypeIcon = ({ type, extension }) => {
  const icons = {
    video: Film,
    audio: Music,
    image: Image,
    document: FileText,
    archive: Archive,
  };
  
  const Icon = icons[type] || File;
  const colors = {
    video: 'text-rose-400',
    audio: 'text-amber-400',
    image: 'text-emerald-400',
    document: 'text-blue-400',
    archive: 'text-purple-400',
    unknown: 'text-dark-400',
  };

  return (
    <div className={`p-1.5 rounded-lg bg-dark-800 ${colors[type] || colors.unknown}`}>
      <Icon className="w-4 h-4" />
    </div>
  );
};

// 文件树组件
const FileTree = ({ node, depth = 0, defaultExpanded = depth < 2 }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  
  const hasChildren = node.children && node.children.length > 0;
  const hasFiles = node.files && node.files.length > 0;

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-dark-700/50 pl-3' : ''}>
      {/* 目录名 */}
      {depth > 0 && hasChildren && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 py-1 text-sm text-dark-300 hover:text-dark-100 transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-dark-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-dark-500" />
          )}
          <Folder className="w-4 h-4 text-amber-400" />
          <span>{node.name}</span>
        </button>
      )}

      {/* 文件列表 */}
      <AnimatePresence>
        {(depth === 0 || expanded) && (
          <motion.div
            initial={depth > 0 ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            {/* 子目录 */}
            {node.children?.map((child, i) => (
              <FileTree key={i} node={child} depth={depth + 1} />
            ))}

            {/* 文件 */}
            {node.files?.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-3 py-1.5 text-sm group"
              >
                <FileTypeIcon type={file.type} extension={file.extension} />
                <span className="flex-1 truncate text-dark-300 group-hover:text-dark-100">
                  {file.name}
                </span>
                <span className="text-xs text-dark-500 tabular-nums">
                  {file.sizeFormatted}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// 统计徽章
const StatBadge = ({ icon: Icon, value, label, color }) => (
  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${color}`}>
    <Icon className="w-3.5 h-3.5" />
    <span className="text-xs font-medium">{value}</span>
    <span className="text-xs opacity-70">{label}</span>
  </div>
);

// 主结果卡片
const ResultCardV2 = ({ 
  result, 
  index, 
  isFavorite, 
  onClick, 
  onToggleFavorite,
  expanded: defaultExpanded = false
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showFiles, setShowFiles] = useState(false);

  const healthColor = 
    result.seeders > 100 ? 'bg-emerald-500' :
    result.seeders > 20 ? 'bg-cyan-500' :
    result.seeders > 5 ? 'bg-amber-500' :
    'bg-rose-500';

  const formatSize = (bytes) => {
    if (!bytes) return 'Unknown';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return `${size.toFixed(2)} ${units[unit]}`;
  };

  const formatDate = (iso) => {
    if (!iso) return '未知';
    const date = new Date(iso);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / 86400000);
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    if (days < 30) return `${Math.floor(days / 7)}周前`;
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 300 }}
    >
      <GlassCard
        className={`${expanded ? 'ring-1 ring-aurora-cyan/30' : ''}`}
        padding="p-0"
        glow={result.seeders > 100}
      >
        {/* 头部 - 始终显示 */}
        <div 
          className="p-4 cursor-pointer"
          onClick={() => onClick?.()}
        >
          <div className="flex items-start gap-4">
            {/* 健康指示器 */}
            <div className="relative flex-shrink-0">
              <div className={`
                w-14 h-14 rounded-2xl flex items-center justify-center
                ${result.verified ? 'bg-emerald-500/10' : 'bg-dark-800'}
              `}>
                {result.verified ? (
                  <Sparkles className="w-7 h-7 text-emerald-400" />
                ) : (
                  <HardDrive className="w-7 h-7 text-dark-400" />
                )}
              </div>
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-1 rounded-full ${
                      i < Math.min(4, Math.ceil((result.seeders || 0) / 25))
                        ? healthColor
                        : 'bg-dark-700'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* 主内容 */}
            <div className="flex-1 min-w-0">
              {/* 标题 */}
              <h3 className="font-semibold text-dark-100 leading-relaxed line-clamp-2 mb-2 hover:text-aurora-cyan transition-colors">
                {result.title}
              </h3>

              {/* 来源标签 */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {(result.sources || [result.engineName]).slice(0, 3).map((s, i) => (
                  <span key={i} className="px-2 py-0.5 bg-dark-800 rounded-md text-xs text-dark-400">
                    {s}
                  </span>
                ))}
                {result.quality && (
                  <span className="px-2 py-0.5 bg-aurora-purple/20 text-aurora-purple rounded-md text-xs font-medium">
                    {result.quality}
                  </span>
                )}
                {result.possibleCollection && (
                  <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-md text-xs">
                    可能为合集
                  </span>
                )}
              </div>

              {/* 核心统计 - 新增文件数、收录时间 */}
              <div className="flex flex-wrap items-center gap-3">
                {/* 文件大小 */}
                <StatBadge 
                  icon={HardDrive} 
                  value={formatSize(result.totalSize || result.size)}
                  label=""
                  color="bg-dark-800 text-dark-300"
                />

                {/* 文件数量 - 新增 */}
                {(result.fileCount || result.hasMetadata) && (
                  <StatBadge 
                    icon={Layers} 
                    value={result.fileCount || '?'}
                    label="个文件"
                    color="bg-aurora-cyan/10 text-aurora-cyan"
                  />
                )}

                {/* 收录时间 - 新增 */}
                {result.firstSeen && (
                  <StatBadge 
                    icon={Clock} 
                    value={formatDate(result.firstSeen)}
                    label="收录"
                    color="bg-purple-500/10 text-purple-400"
                  />
                )}

                {/* 最新时间 */}
                <StatBadge 
                  icon={Clock} 
                  value={formatDate(result.date)}
                  label="更新"
                  color="bg-dark-800 text-dark-500"
                />

                {/* 做种数 */}
                <div className={`
                  flex items-center gap-1.5 px-2 py-1 rounded-lg
                  ${result.seeders > 100 ? 'bg-emerald-500/10 text-emerald-400' : 
                    result.seeders > 20 ? 'bg-cyan-500/10 text-cyan-400' :
                    result.seeders > 5 ? 'bg-amber-500/10 text-amber-400' :
                    'bg-rose-500/10 text-rose-400'}
                `}>
                  <Hash className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium">
                    ↑{result.seeders?.toLocaleString() || 0}
                  </span>
                  {result.leechers > 0 && (
                    <span className="text-xs opacity-70">↓{result.leechers}</span>
                  )}
                </div>

                {/* 多源标记 */}
                {result.sources?.length > 1 && (
                  <span className="px-2 py-1 bg-aurora-blue/10 text-aurora-blue rounded-lg text-xs font-medium">
                    {result.sources.length}个来源
                  </span>
                )}

                {/* 元数据状态 */}
                {result.metadataStatus === 'pending' && (
                  <span className="flex items-center gap-1 text-xs text-amber-400 animate-pulse">
                    <Layers className="w-3 h-3" />
                    解析中...
                  </span>
                )}
                {result.metadataStatus === 'complete' && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <Layers className="w-3 h-3" />
                    已解析
                  </span>
                )}
              </div>
            </div>

            {/* 展开按钮 */}
            {(result.files || result.hasMetadata) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(!expanded);
                }}
                className="p-2 hover:bg-dark-800 rounded-xl transition-colors"
              >
                <ChevronDown className={`w-5 h-5 text-dark-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* 展开内容 - 文件列表 */}
        <AnimatePresence>
          {expanded && (result.files || result.fileTree) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-dark-800"
            >
              {/* 文件类型分布 */}
              {result.fileTypes && (
                <div className="px-4 py-3 border-b border-dark-800/50">
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-dark-500">文件构成:</span>
                    {Object.entries(result.fileTypes)
                      .filter(([, count]) => count > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => (
                        <span key={type} className="flex items-center gap-1 text-dark-400">
                          <span className="capitalize">{type}</span>
                          <span className="text-aurora-cyan">{count}</span>
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {/* 文件树 */}
              <div className="p-4 max-h-96 overflow-y-auto scrollbar-hide">
                {result.fileTree ? (
                  <FileTree node={result.fileTree} />
                ) : result.files ? (
                  <div className="space-y-1">
                    {result.files.slice(0, 50).map((file, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 py-1.5 text-sm group"
                      >
                        <FileTypeIcon type={file.type} extension={file.extension} />
                        <span className="flex-1 truncate text-dark-300">
                          {file.name}
                        </span>
                        <span className="text-xs text-dark-500 tabular-nums">
                          {file.sizeFormatted || formatSize(file.size)}
                        </span>
                      </div>
                    ))}
                    {result.files.length > 50 && (
                      <div className="text-center py-2 text-xs text-dark-500">
                        还有 {result.files.length - 50} 个文件...
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-dark-500">
                    <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>文件列表加载中...</p>
                  </div>
                )}
              </div>

              {/* 底部信息栏 */}
              <div className="px-4 py-3 bg-dark-900/50 border-t border-dark-800 text-xs text-dark-500 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {result.stats?.totalSizeFormatted && (
                    <span>总计: {result.stats.totalSizeFormatted}</span>
                  )}
                  {result.stats?.directories > 0 && (
                    <span>{result.stats.directories} 个目录</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {result.contentPreview?.description && (
                    <span>{result.contentPreview.description}</span>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  );
};

export default ResultCardV2;

