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
                        animate={{ width:

