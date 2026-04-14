import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, Zap, Clock, HardDrive, ArrowUpDown, Filter,
  ChevronLeft, ChevronRight, Activity, Server, CheckCircle2,
  AlertCircle, Loader2, X, Heart, Copy, Download, ExternalLink,
  Shield, Eye, Share2, MoreVertical, Play, Pause, RotateCcw
} from 'lucide-react';

import { useParallelSearch, useFavorites, useLinkVerifier } from '../hooks/useParallelSearch';
import AuroraBackground from '../components/ui/AuroraBackground';
import GlassCard from '../components/ui/GlassCard';
import LiquidInput from '../components/ui/LiquidInput';

// 引擎分类配置（84个引擎分组）
const ENGINE_GROUPS = [
  { id: 'all', name: '全部引擎', icon: '🔍', count: 84, color: 'from-aurora-cyan to-aurora-blue' },
  { id: 'movies', name: '电影专区', icon: '🎬', engines: 'yts,rarbg,1337x,thepiratebay,torrentgalaxy,zooqle', color: 'from-red-500 to-pink-500' },
  { id: 'tv', name: '剧集追踪', icon: '📺', engines: 'eztv,1337x,rarbg,torrentgalaxy', color: 'from-purple-500 to-indigo-500' },
  { id: 'anime', name: '动漫世界', icon: '🇯🇵', engines: 'nyaa,sukebei,dmhy,mikan,acgrip,bangumimoe,tokyotosho,animetosho,subsplease,erairaws', color: 'from-pink-500 to-rose-500' },
  { id: 'games', name: '游戏资源', icon: '🎮', engines: 'fitgirl,skidrowreloaded,csrinru,rutracker', color: 'from-green-500 to-emerald-500' },
  { id: 'software', name: '软件工具', icon: '💻', engines: '1337x,thepiratebay,linuxtracker', color: 'from-blue-500 to-cyan-500' },
  { id: 'books', name: '电子书库', icon: '📚', engines: 'zlibrary,academic,audiobookbay', color: 'from-amber-500 to-orange-500' },
  { id: 'general', name: '综合搜索', icon: '📦', engines: 'bitsearch,solidtorrents,knaben,snowfl,magnetdl,torlock,kickass,extratorrent', color: 'from-slate-500 to-gray-500' },
  { id: 'russian', name: '俄区资源', icon: '🇷🇺', engines: 'rutracker,kinozal,nnmclub,rutor,rustorka,tapochek', color: 'from-blue-600 to-blue-400' },
  { id: 'chinese', name: '中文磁力', icon: '🇨🇳', engines: 'cilipro,cilimao,ciligou,zhongziso,btfox,cld,bt1207,sofan', color: 'from-red-600 to-red-400' },
  { id: 'dht', name: 'DHT网络', icon: '🕸️', engines: 'btdig,bt4g,dht_crawler', color: 'from-emerald-600 to-teal-400' },
  { id: 'premium', name: '高级服务', icon: '💎', engines: 'jackett,prowlarr,realdebrid,alldebrid,premiumize', color: 'from-amber-400 to-yellow-300' },
];

const SORT_OPTIONS = [
  { id: 'seeders', name: '热度最高', icon: Zap, desc: '按做种人数排序', color: 'text-amber-400' },
  { id: 'date', name: '最新发布', icon: Clock, desc: '按发布时间排序', color: 'text-cyan-400' },
  { id: 'size_asc', name: '体积最小', icon: HardDrive, desc: '从小到大', color: 'text-emerald-400', sizeOrder: 'asc' },
  { id: 'size_desc', name: '体积最大', icon: HardDrive, desc: '从大到小', color: 'text-rose-400', sizeOrder: 'desc' },
  { id: 'name', name: '名称排序', icon: ArrowUpDown, desc: '按字母顺序', color: 'text-purple-400' },
];

const UltimateSearch = () => {
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState('all');
  const [activeSort, setActiveSort] = useState('seeders');
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [selectedResult, setSelectedResult] = useState(null);
  const [searchHistory, setSearchHistory] = useState(() => {
    const saved = localStorage.getItem('search_history');
    return saved ? JSON.parse(saved) : [];
  });

  const scrollRef = useRef(null);
  const {
    results,
    isLoading,
    progress,
    sortConfig,
    streamSearch,
    changeSort,
    cancelSearch,
    hasResults,
    totalEngines,
    completedEngines,
  } = useParallelSearch();

  const { favorites, addFavorite, removeFavorite, isFavorite } = useFavorites();
  const { verify, verifying, result: verifyResult } = useLinkVerifier();

  // 执行搜索
  const handleSearch = useCallback(async (searchQuery) => {
    if (!searchQuery.trim()) return;

    // 保存历史
    const newHistory = [searchQuery, ...searchHistory.filter(h => h !== searchQuery)].slice(0, 20);
    setSearchHistory(newHistory);
    localStorage.setItem('search_history', JSON.stringify(newHistory));

    const group = ENGINE_GROUPS.find(g => g.id === activeGroup);
    const engines = group?.engines || 'all';

    try {
      await streamSearch(searchQuery, {
        engines,
        onProgress: (data) => {
          console.log('Progress:', data);
        },
      });
    } catch (err) {
      console.error('Search failed:', err);
    }
  }, [activeGroup, searchHistory, streamSearch]);

  // 切换排序
  const handleSortChange = useCallback((sortId) => {
    setActiveSort(sortId);
    
    const option = SORT_OPTIONS.find(s => s.id === sortId);
    let sortBy = sortId;
    let order = 'desc';
    
    if (sortId === 'size_asc') {
      sortBy = 'size';
      order = 'asc';
    } else if (sortId === 'size_desc') {
      sortBy = 'size';
      order = 'desc';
    } else if (sortId === 'date') {
      sortBy = 'date';
      order = 'desc';
    }
    
    changeSort(sortBy, order);
  }, [changeSort]);

  // 打开操作面板
  const openActionSheet = useCallback((result) => {
    setSelectedResult(result);
    setShowActionSheet(true);
    // 自动开始验证
    verify(result.magnet);
  }, [verify]);

  // 复制磁力链接
  const copyMagnet = useCallback(async (magnet) => {
    try {
      await navigator.clipboard.writeText(magnet);
      // 显示成功提示
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }, []);

  // 滚动引擎标签
  const scrollEngines = useCallback((direction) => {
    scrollRef.current?.scrollBy({
      left: direction === 'left' ? -300 : 300,
      behavior: 'smooth',
    });
  }, []);

  // 健康度颜色
  const getHealthColor = (seeders) => {
    if (seeders > 100) return 'bg-emerald-500';
    if (seeders > 20) return 'bg-cyan-500';
    if (seeders > 5) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  // 格式化大小
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

  return (
    <div className="min-h-screen bg-dark-950 text-dark-100 font-sans overflow-hidden">
      <AuroraBackground />
      
      {/* ========== 顶部搜索区 ========== */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="glass-strong border-b border-dark-700/30">
          <div className="max-w-[1600px] mx-auto px-4 py-4">
            {/* Logo + 搜索框 */}
            <div className="flex items-center gap-4 mb-4">
              <motion.div 
                className="flex items-center gap-3"
                whileHover={{ scale: 1.02 }}
              >
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-aurora-cyan to-aurora-purple flex items-center justify-center shadow-glow-cyan">
                  <Search className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="font-bold text-lg leading-tight">深度搜索</h1>
                  <p className="text-xs text-dark-500">84引擎并行 · 实时聚合</p>
                </div>
              </motion.div>

              <div className="flex-1 max-w-3xl">
                <LiquidInput
                  value={query}
                  onChange={setQuery}
                  onSubmit={handleSearch}
                  placeholder="输入关键词，84个引擎同时搜索..."
                  suggestions={searchHistory}
                  onSuggestionClick={handleSearch}
                  loading={isLoading}
                />
              </div>

              {/* 控制按钮 */}
              <div className="flex items-center gap-2">
                {isLoading && (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={cancelSearch}
                    className="p-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded-2xl transition-colors"
                  >
                    <Pause className="w-5 h-5" />
                  </motion.button>
                )}
                
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleSearch(query)}
                  disabled={isLoading || !query.trim()}
                  className="px-6 py-3 bg-gradient-to-r from-aurora-cyan to-aurora-blue text-dark-950 font-semibold rounded-2xl shadow-glow-cyan disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Zap className="w-5 h-5" />
                  )}
                </motion.button>
              </div>
            </div>

            {/* 引擎分组标签 - 可左右滑动 */}
            <div className="relative">
              <button
                onClick={() => scrollEngines('left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-2 bg-dark-900/80 backdrop-blur rounded-xl border border-dark-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div
                ref={scrollRef}
                className="flex gap-2 overflow-x-auto scrollbar-hide px-12 py-2 scroll-smooth"
              >
                {ENGINE_GROUPS.map((group) => (
                  <motion.button
                    key={group.id}
                    onClick={() => setActiveGroup(group.id)}
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                    className={`
                      relative flex items-center gap-2 px-4 py-2.5 rounded-2xl font-medium text-sm
                      whitespace-nowrap transition-all duration-300 border
                      ${activeGroup === group.id
                        ? `bg-gradient-to-r ${group.color} text-white border-transparent shadow-lg`
                        : 'bg-dark-850/80 text-dark-300 border-dark-700 hover:border-dark-600 hover:bg-dark-800'
                      }
                    `}
                  >
                    <span className="text-lg">{group.icon}</span>
                    <span>{group.name}</span>
                    {group.count && (
                      <span className={`
                        px-1.5 py-0.5 text-xs rounded-md
                        ${activeGroup === group.id ? 'bg-white/20' : 'bg-dark-700 text-dark-400'}
                      `}>
                        {group.count}
                      </span>
                    )}
                    
                    {/* 活跃指示器 */}
                    {activeGroup === group.id && isLoading && (
                      <motion.span
                        className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full"
                        animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      />
                    )}
                  </motion.button>
                ))}
              </div>

              <button
                onClick={() => scrollEngines('right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-2 bg-dark-900/80 backdrop-blur rounded-xl border border-dark-700"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* 排序与状态栏 */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-dark-800/50">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-dark-500" />
                <span className="text-sm text-dark-500 mr-2">排序:</span>
                
                {SORT_OPTIONS.map((sort) => (
                  <motion.button
                    key={sort.id}
                    onClick={() => handleSortChange(sort.id)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`
                      flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm transition-all
                      ${activeSort === sort.id
                        ? 'bg-dark-750 text-white shadow-lg'
                        : 'text-dark-400 hover:text-dark-200 hover:bg-dark-800/50'
                      }
                    `}
                  >
                    <sort.icon className={`w-3.5 h-3.5 ${activeSort === sort.id ? sort.color : ''}`} />
                    {sort.name}
                  </motion.button>
                ))}
              </div>

              {/* 引擎状态 */}
              <div className="flex items-center gap-4 text-sm">
                {isLoading ? (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-amber-400">
                      <Activity className="w-4 h-4 animate-pulse" />
                      <span>搜索中... {completedEngines}/{totalEngines}</span>
                    </div>
                    
                    {/* 进度条 */}
                    <div className="w-32 h-1.5 bg-dark-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-aurora-cyan to-aurora-blue"
                        initial={{ width: 0 }}
                        animate={{ width:                        `${(completedEngines / totalEngines) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>
                ) : hasResults ? (
                  <div className="flex items-center gap-3 text-dark-400">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>找到 {results.length.toLocaleString()} 个结果</span>
                    <span className="text-dark-600">|</span>
                    <span>{completedEngines} 个引擎响应</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ========== 主内容区 ========== */}
      <main className="pt-40 pb-32 px-4 overflow-hidden">
        <div className="max-w-[1600px] mx-auto h-[calc(100vh-180px)]">
          
          {/* 引擎实时状态面板 */}
          {isLoading && Object.keys(progress).length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-4"
            >
              <GlassCard className="p-3" glow={false}>
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                  <span className="text-xs text-dark-500 whitespace-nowrap">引擎状态:</span>
                  {Object.entries(progress).map(([engine, status]) => (
                    <div
                      key={engine}
                      className={`
                        flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs whitespace-nowrap
                        ${status.status === 'searching' ? 'bg-amber-500/20 text-amber-400 animate-pulse' : ''}
                        ${status.status === 'complete' ? 'bg-emerald-500/20 text-emerald-400' : ''}
                        ${status.status === 'error' ? 'bg-rose-500/20 text-rose-400' : ''}
                      `}
                    >
                      <Server className="w-3 h-3" />
                      <span className="capitalize">{engine}</span>
                      {status.results > 0 && (
                        <span className="text-dark-500">({status.results})</span>
                      )}
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* 结果列表 - 虚拟滚动优化 */}
          <div className="h-full overflow-y-auto scrollbar-hide space-y-2 pb-20">
            <AnimatePresence mode="popLayout">
              {results.map((result, index) => (
                <ResultItem
                  key={result.hash || result.id}
                  result={result}
                  index={index}
                  isFavorite={isFavorite(result.hash)}
                  onClick={() => openActionSheet(result)}
                  onToggleFavorite={() => 
                    isFavorite(result.hash) 
                      ? removeFavorite(result.hash)
                      : addFavorite(result)
                  }
                  healthColor={getHealthColor(result.seeders)}
                  formatSize={formatSize}
                />
              ))}
            </AnimatePresence>

            {/* 空状态 */}
            {!isLoading && !hasResults && query && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center h-full"
              >
                <div className="p-8 bg-dark-850 rounded-3xl mb-6">
                  <Search className="w-16 h-16 text-dark-600" />
                </div>
                <h3 className="text-xl font-semibold text-dark-300 mb-2">未找到结果</h3>
                <p className="text-dark-500 text-center max-w-md">
                  尝试更换关键词或选择不同的引擎分组
                </p>
              </motion.div>
            )}

            {/* 初始状态 */}
            {!query && !hasResults && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-full"
              >
                <div className="text-center">
                  <motion.div
                    animate={{ 
                      rotate: [0, 10, -10, 0],
                      scale: [1, 1.1, 1]
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="inline-block p-6 bg-gradient-to-br from-aurora-cyan/20 to-aurora-purple/20 rounded-3xl mb-6"
                  >
                    <Zap className="w-12 h-12 text-aurora-cyan" />
                  </motion.div>
                  <h3 className="text-2xl font-bold text-gradient mb-3">84引擎并行搜索</h3>
                  <p className="text-dark-500 max-w-md">
                    输入关键词，同时搜索全球84个磁力引擎，实时聚合结果，智能去重排序
                  </p>
                  
                  {/* 热门搜索 */}
                  <div className="mt-8 flex flex-wrap justify-center gap-2">
                    {['复仇者联盟', '奥本海默', '进击的巨人', 'Ubuntu 24.04', 'FLAC音乐'].map((term) => (
                      <button
                        key={term}
                        onClick={() => {
                          setQuery(term);
                          handleSearch(term);
                        }}
                        className="px-4 py-2 bg-dark-850 hover:bg-dark-800 rounded-xl text-sm text-dark-400 hover:text-dark-200 transition-colors"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </main>

      {/* ========== 底部操作面板 ========== */}
      <AnimatePresence>
        {showActionSheet && selectedResult && (
          <ActionSheet
            result={selectedResult}
            onClose={() => setShowActionSheet(false)}
            isFavorite={isFavorite(selectedResult.hash)}
            onToggleFavorite={() => 
              isFavorite(selectedResult.hash)
                ? removeFavorite(selectedResult.hash)
                : addFavorite(selectedResult)
            }
            onCopy={() => copyMagnet(selectedResult.magnet)}
            verifyResult={verifyResult}
            verifying={verifying}
            formatSize={formatSize}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ========== 结果项组件 ==========
const ResultItem = ({ result, index, isFavorite, onClick, onToggleFavorite, healthColor, formatSize }) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ 
        duration: 0.3, 
        delay: index * 0.03,
        type: "spring",
        stiffness: 300,
        damping: 25
      }}
    >
      <GlassCard
        onClick={onClick}
        hover={true}
        glow={result.seeders > 100}
        className="group cursor-pointer"
        padding="p-4"
      >
        <div className="flex items-start gap-4">
          {/* 健康指示器 */}
          <div className="relative flex-shrink-0">
            <div className={`
              w-12 h-12 rounded-2xl flex items-center justify-center
              ${result.verified ? 'bg-emerald-500/10' : 'bg-dark-750'}
            `}>
              {result.verified ? (
                <Shield className="w-6 h-6 text-emerald-400" />
              ) : (
                <Server className="w-6 h-6 text-dark-400" />
              )}
            </div>
            {/* 种子健康条 */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1 rounded-full ${
                    i < Math.min(4, Math.ceil((result.seeders || 0) / 25))
                      ? healthColor
                      : 'bg-dark-700'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* 内容区 */}
          <div className="flex-1 min-w-0">
            {/* 标题 */}
            <h3 className="font-medium text-dark-100 leading-relaxed line-clamp-2 mb-2 group-hover:text-aurora-cyan transition-colors">
              {result.title}
            </h3>

            {/* 来源标签 */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {(result.sources || [result.engine]).slice(0, 3).map((source, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 bg-dark-750 rounded-lg text-xs text-dark-400"
                >
                  {source}
                </span>
              ))}
              {(result.sources?.length || 1) > 3 && (
                <span className="text-xs text-dark-500">
                  +{(result.sources?.length || 1) - 3}
                </span>
              )}
              
              {result.quality && (
                <span className="px-2 py-0.5 bg-aurora-purple/20 text-aurora-purple rounded-lg text-xs font-medium">
                  {result.quality}
                </span>
              )}
              
              {result.category && (
                <span className="px-2 py-0.5 bg-dark-750 rounded-lg text-xs text-dark-500">
                  {result.category}
                </span>
              )}
            </div>

            {/* 元信息 */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-dark-400">
                <HardDrive className="w-3.5 h-3.5" />
                {formatSize(result.size)}
              </span>
              
              <span className="flex items-center gap-1.5 text-dark-400">
                <Clock className="w-3.5 h-3.5" />
                {new Date(result.date).toLocaleDateString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              
              <span className={`
                flex items-center gap-1.5 px-2 py-1 rounded-lg
                ${result.seeders > 100 ? 'bg-emerald-500/10 text-emerald-400' : 
                  result.seeders > 20 ? 'bg-cyan-500/10 text-cyan-400' :
                  result.seeders > 5 ? 'bg-amber-500/10 text-amber-400' :
                  'bg-rose-500/10 text-rose-400'}
              `}>
                <Zap className="w-3.5 h-3.5" />
                ↑{result.seeders?.toLocaleString() || 0}
                {result.leechers > 0 && (
                  <span className="opacity-70 ml-1">↓{result.leechers}</span>
                )}
              </span>

              {/* 多源指示 */}
              {result.sources?.length > 1 && (
                <span className="flex items-center gap-1 text-aurora-cyan">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {result.sources.length}个来源
                </span>
              )}
            </div>
          </div>

          {/* 操作区 */}
          <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className={`
                p-2 rounded-xl transition-colors
                ${isFavorite 
                  ? 'bg-rose-500/20 text-rose-400' 
                  : 'bg-dark-750 text-dark-400 hover:text-rose-400'}
              `}
            >
              <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
            </motion.button>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
};

// ========== 底部操作面板组件 ==========
const ActionSheet = ({ 
  result, 
  onClose, 
  isFavorite, 
  onToggleFavorite, 
  onCopy,
  verifyResult,
  verifying,
  formatSize 
}) => {
  const [activeTab, setActiveTab] = useState('actions');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const menuItems = [
    {
      id: 'favorite',
      icon: Heart,
      label: isFavorite ? '取消收藏' : '加入收藏',
      description: isFavorite ? '从收藏夹移除' : '保存到个人收藏',
      color: isFavorite ? 'text-rose-400' : 'text-dark-200',
      bgColor: isFavorite ? 'bg-rose-500/10' : 'bg-dark-750',
      onClick: onToggleFavorite,
    },
    {
      id: 'copy',
      icon: copied ? CheckCircle2 : Copy,
      label: copied ? '已复制!' : '复制链接',
      description: '复制磁力链接到剪贴板',
      color: copied ? 'text-emerald-400' : 'text-dark-200',
      bgColor: copied ? 'bg-emerald-500/10' : 'bg-dark-750',
      onClick: handleCopy,
    },
    {
      id: 'download',
      icon: Download,
      label: '迅雷下载',
      description: '使用迅雷高速下载',
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
      onClick: () => {
        const thunderUrl = `thunder://${btoa(result.magnet)}`;
        window.location.href = thunderUrl;
      },
    },
    {
      id: 'preview',
      icon: Eye,
      label: '预览文件',
      description: '查看文件列表和详情',
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
      onClick: () => setActiveTab('files'),
    },
    {
      id: 'verify',
      icon: Shield,
      label: '链接检测',
      description: '验证链接可用性和健康度',
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      onClick: () => setActiveTab('verify'),
    },
    {
      id: 'share',
      icon: Share2,
      label: '分享',
      description: '生成分享链接或二维码',
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      onClick: () => {},
    },
    {
      id: 'external',
      icon: ExternalLink,
      label: '访问来源',
      description: '在原始网站查看',
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10',
      onClick: () => result.url && window.open(result.url, '_blank'),
    },
  ];

  return (
    <>
      {/* 背景遮罩 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
      />

      {/* 面板 */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed bottom-0 left-0 right-0 z-50 max-h-[85vh]"
      >
        <div className="bg-dark-900 rounded-t-[2rem] border-t border-dark-700 shadow-2xl overflow-hidden">
          
          {/* 拖动条 */}
          <div className="flex justify-center pt-3 pb-2" onClick={onClose}>
            <div className="w-12 h-1.5 bg-dark-700 rounded-full" />
          </div>

          {/* 头部信息 */}
          <div className="px-6 pb-4 border-b border-dark-800">
            <h3 className="text-lg font-semibold text-dark-100 line-clamp-2 mb-2">
              {result.title}
            </h3>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-aurora-cyan font-medium">
                {formatSize(result.size)}
              </span>
              <span className="text-dark-500">|</span>
              <span className="text-dark-400">
                {new Date(result.date).toLocaleString('zh-CN')}
              </span>
              <span className="text-dark-500">|</span>
              <span className={`
                ${result.seeders > 100 ? 'text-emerald-400' : 
                  result.seeders > 20 ? 'text-cyan-400' :
                  result.seeders > 5 ? 'text-amber-400' : 'text-rose-400'}
              `}>
                ↑{result.seeders?.toLocaleString()} 做种
              </span>
            </div>
          </div>

          {/* 标签切换 */}
          <div className="flex gap-1 p-2 bg-dark-950">
            {[
              { id: 'actions', label: '操作', icon: MoreVertical },
              { id: 'files', label: '文件', icon: HardDrive },
              { id: 'verify', label: '检测', icon: Shield },
              { id: 'sources', label: '来源', icon: Server },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all
                  ${activeTab === tab.id
                    ? 'bg-dark-800 text-aurora-cyan'
                    : 'text-dark-500 hover:text-dark-300 hover:bg-dark-800/50'
                  }
                `}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* 内容区 */}
          <div className="p-4 max-h-[50vh] overflow-y-auto">
            
            {/* 操作列表 */}
            {activeTab === 'actions' && (
              <div className="grid grid-cols-2 gap-3">
                {menuItems.map((item) => (
                  <motion.button
                    key={item.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={item.onClick}
                    className={`
                      flex items-start gap-3 p-4 rounded-2xl text-left transition-all
                      ${item.bgColor} hover:brightness-110
                    `}
                  >
                    <div className={`
                      p-2 rounded-xl bg-dark-900/50
                      ${item.color}
                    `}>
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className={`font-medium ${item.color}`}>{item.label}</div>
                      <div className="text-xs text-dark-500 mt-0.5">{item.description}</div>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}

            {/* 文件列表 */}
            {activeTab === 'files' && (
              <div className="space-y-2">
                <div className="p-4 bg-dark-850 rounded-2xl text-center text-dark-500">
                  <HardDrive className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>文件列表需要获取元数据</p>
                  <button className="mt-3 px-4 py-2 bg-aurora-cyan/20 text-aurora-cyan rounded-xl text-sm">
                    获取文件列表
                  </button>
                </div>
              </div>
            )}

            {/* 验证结果 */}
            {activeTab === 'verify' && (
              <div className="space-y-3">
                {verifying ? (
                  <div className="flex flex-col items-center py-8">
                    <Loader2 className="w-10 h-10 text-aurora-cyan animate-spin mb-4" />
                    <p className="text-dark-400">正在检测链接可用性...</p>
                  </div>
                ) : verifyResult ? (
                  <div className="space-y-3">
                    {/* 健康度卡片 */}
                    <div className={`
                      p-4 rounded-2xl
                      ${verifyResult.healthy ? 'bg-emerald-500/10' : 'bg-rose-500/10'}
                    `}>
                      <div className="flex items-center gap-3">
                        <div className={`
                          p-3 rounded-xl
                          ${verifyResult.healthy ? 'bg-emerald-500/20' : 'bg-rose-500/20'}
                        `}>
                          {verifyResult.healthy ? (
                            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                          ) : (
                            <AlertCircle className="w-6 h-6 text-rose-400" />
                          )}
                        </div>
                        <div>
                          <div className={`
                            font-semibold
                            ${verifyResult.healthy ? 'text-emerald-400' : 'text-rose-400'}
                          `}>
                            {verifyResult.healthy ? '链接可用' : '链接异常'}
                          </div>
                          <div className="text-sm text-dark-400">
                            {verifyResult.message || '检测完成'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 详细信息 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-dark-850 rounded-xl">
                        <div className="text-xs text-dark-500 mb-1">Tracker响应</div>
                        <div className="text-sm font-medium text-dark-200">
                          {verifyResult.trackers?.filter(t => t.working).length || 0} / {verifyResult.trackers?.length || 0}
                        </div>
                      </div>
                      <div className="p-3 bg-dark-850 rounded-xl">
                        <div className="text-xs text-dark-500 mb-1">DHT节点</div>
                        <div className="text-sm font-medium text-dark-200">
                          {verifyResult.dhtPeers || '未知'}
                        </div>
                      </div>
                      <div className="p-3 bg-dark-850 rounded-xl">
                        <div className="text-xs text-dark-500 mb-1">最后活动</div>
                        <div className="text-sm font-medium text-dark-200">
                          {verifyResult.lastActivity || '未知'}
                        </div>
                      </div>
                      <div className="p-3 bg-dark-850 rounded-xl">
                        <div className="text-xs text-dark-500 mb-1">可信度</div>
                        <div className="text-sm font-medium text-dark-200">
                          {verifyResult.confidence || '中等'}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-dark-500">
                    <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>点击"链接检测"开始验证</p>
                  </div>
                )}
              </div>
            )}

            {/* 来源列表 */}
            {activeTab === 'sources' && (
              <div className="space-y-2">
                {(result.sources || [result.engineName]).map((source, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 bg-dark-850 rounded-xl"
                  >
                    <div className="flex items-center gap-3">
                      <Server className="w-4 h-4 text-dark-500" />
                      <span className="text-dark-200">{source}</span>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </div>
                ))}
                
                {/* 磁力链接预览 */}
                <div className="mt-4 p-3 bg-dark-950 rounded-xl">
                  <div className="text-xs text-dark-500 mb-2">磁力链接</div>
                  <code className="block text-xs text-dark-400 break-all font-mono">
                    {result.magnet}
                  </code>
                </div>
              </div>
            )}
          </div>

          {/* 底部关闭 */}
          <div className="p-4 border-t border-dark-800">
            <button
              onClick={onClose}
              className="w-full py-3 bg-dark-800 hover:bg-dark-750 rounded-2xl font-medium text-dark-300 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
};

export default UltimateSearch;


