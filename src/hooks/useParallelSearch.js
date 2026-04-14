import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const API_BASE = process.env.REACT_APP_API_URL || '';

/**
 * 终极并行搜索Hook
 * 特性：SSE流式、智能聚合、实时排序、引擎状态监控
 */
export const useParallelSearch = () => {
  const [streamResults, setStreamResults] = useState([]);
  const [engineProgress, setEngineProgress] = useState({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [sortConfig, setSortConfig] = useState({ by: 'seeders', order: 'desc' });
  const eventSourceRef = useRef(null);
  const queryClient = useQueryClient();

  // 清理函数
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  /**
   * 执行流式搜索
   */
  const streamSearch = useCallback((query, options = {}) => {
    const {
      engines = 'all',
      onEngineStart,
      onEngineComplete,
      onEngineError,
      onProgress,
    } = options;

    return new Promise((resolve, reject) => {
      // 关闭之前的连接
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // 重置状态
      setStreamResults([]);
      setEngineProgress({});
      setIsStreaming(true);

      // 构建SSE URL
      const params = new URLSearchParams({
        q: query,
        engines,
        format: 'stream',
      });
      const url = `${API_BASE}/api/search/aggregate?${params.toString()}`;

      const es = new EventSource(url);
      eventSourceRef.current = es;

      const accumulatedResults = [];

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'init':
              // 初始化信息
              onProgress?.({
                phase: 'init',
                totalEngines: data.engines,
              });
              break;

            case 'engine_start':
              // 引擎开始
              setEngineProgress(prev => ({
                ...prev,
                [data.engine]: { status: 'searching', results: 0 },
              }));
              onEngineStart?.(data.engine);
              break;

            case 'results':
              // 实时结果批次
              accumulatedResults.push(...data.batch);
              
              // 智能合并（客户端去重）
              const merged = mergeClientResults(accumulatedResults);
              
              // 实时排序
              const sorted = sortClientResults(merged, sortConfig.by, sortConfig.order);
              
              setStreamResults(sorted);
              
              setEngineProgress(prev => ({
                ...prev,
                [data.engine]: {
                  status: 'complete',
                  results: data.batch.length,
                  totalSoFar: data.totalSoFar,
                },
              }));

              onProgress?.({
                phase: 'streaming',
                engine: data.engine,
                batchSize: data.batch.length,
                totalSoFar: data.totalSoFar,
                progress: data.progress,
              });
              break;

            case 'engine_complete':
              // 引擎完成
              setEngineProgress(prev => ({
                ...prev,
                [data.engine]: {
                  ...prev[data.engine],
                  status: 'complete',
                },
              }));
              onEngineComplete?.(data.engine, data.results);
              break;

            case 'engine_error':
              // 引擎错误
              setEngineProgress(prev => ({
                ...prev,
                [data.engine]: { status: 'error', error: data.error },
              }));
              onEngineError?.(data.engine, data.error);
              break;

            case 'complete':
              // 全部完成
              setIsStreaming(false);
              es.close();
              
              const finalMerged = mergeClientResults(accumulatedResults);
              const finalSorted = sortClientResults(finalMerged, sortConfig.by, sortConfig.order);
              
              resolve({
                results: finalSorted,
                stats: data.stats,
                total: data.total,
              });
              break;

            default:
              console.log('Unknown message type:', data.type);
          }
        } catch (err) {
          console.error('SSE parse error:', err);
        }
      };

      es.onerror = (error) => {
        setIsStreaming(false);
        es.close();
        reject(new Error('SSE connection failed'));
      };

      es.onopen = () => {
        console.log('SSE connection opened');
      };
    });
  }, [sortConfig]);

  /**
   * 更改排序（实时重新排序已有结果）
   */
  const changeSort = useCallback((by, order) => {
    setSortConfig({ by, order });
    
    // 立即对已有结果重新排序
    setStreamResults(prev => sortClientResults([...prev], by, order));
  }, []);

  /**
   * 取消搜索
   */
  const cancelSearch = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // 客户端结果合并
  const mergeClientResults = (results) => {
    const seen = new Map();
    
    for (const r of results) {
      const hash = extractHash(r.magnet);
      if (!hash) continue;

      if (seen.has(hash)) {
        // 合并来源
        const existing = seen.get(hash);
        existing.sources = [...new Set([...(existing.sources || [existing.source]), r.source])];
        existing.seeders = Math.max(existing.seeders || 0, r.seeders || 0);
        existing.leechers = Math.max(existing.leechers || 0, r.leechers || 0);
      } else {
        seen.set(hash, {
          ...r,
          hash,
          sources: [r.source],
        });
      }
    }

    return Array.from(seen.values());
  };

  // 客户端排序
  const sortClientResults = (results, by, order) => {
    const multiplier = order === 'asc' ? 1 : -1;

    return [...results].sort((a, b) => {
      switch (by) {
        case 'seeders':
          return multiplier * ((a.seeders || 0) - (b.seeders || 0));
        case 'leechers':
          return multiplier * ((a.leechers || 0) - (b.leechers || 0));
        case 'size':
          return multiplier * ((a.size || 0) - (b.size || 0));
        case 'date':
          return multiplier * (new Date(a.date || 0) - new Date(b.date || 0));
        case 'name':
          return multiplier * (a.title || '').localeCompare(b.title || '');
        default:
          // 综合热度
          const scoreA = (a.seeders || 0) * (a.verified ? 1.5 : 1);
          const scoreB = (b.seeders || 0) * (b.verified ? 1.5 : 1);
          return multiplier * (scoreA - scoreB);
      }
    });
  };

  const extractHash = (magnet) => {
    const match = magnet?.match(/btih:([a-f0-9]{40})/i);
    return match ? match[1].toLowerCase() : null;
  };

  return {
    results: streamResults,
    isLoading: isStreaming,
    progress: engineProgress,
    sortConfig,
    streamSearch,
    changeSort,
    cancelSearch,
    hasResults: streamResults.length > 0,
    totalEngines: Object.keys(engineProgress).length,
    completedEngines: Object.values(engineProgress).filter(p => p.status === 'complete').length,
  };
};

/**
 * 链接验证Hook
 */
export const useLinkVerifier = () => {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState(null);

  const verify = useCallback(async (magnet) => {
    setVerifying(true);
    setResult(null);

    try {
      // 调用验证API
      const response = await fetch(`${API_BASE}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet }),
      });

      const data = await response.json();
      setResult(data);
      return data;
    } catch (error) {
      setResult({ error: error.message });
      return null;
    } finally {
      setVerifying(false);
    }
  }, []);

  return { verify, verifying, result };
};

/**
 * 收藏管理Hook
 */
export const useFavorites = () => {
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('magnet_favorites');
    return saved ? JSON.parse(saved) : [];
  });

  const addFavorite = useCallback((item) => {
    setFavorites(prev => {
      const exists = prev.some(f => f.hash === item.hash);
      if (exists) return prev;
      
      const updated = [{
        ...item,
        addedAt: Date.now(),
        tags: [],
      }, ...prev];
      
      localStorage.setItem('magnet_favorites', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeFavorite = useCallback((hash) => {
    setFavorites(prev => {
      const updated = prev.filter(f => f.hash !== hash);
      localStorage.setItem('magnet_favorites', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateTags = useCallback((hash, tags) => {
    setFavorites(prev => {
      const updated = prev.map(f => 
        f.hash === hash ? { ...f, tags } : f
      );
      localStorage.setItem('magnet_favorites', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const isFavorite = useCallback((hash) => {
    return favorites.some(f => f.hash === hash);
  }, [favorites]);

  return {
    favorites,
    addFavorite,
    removeFavorite,
    updateTags,
    isFavorite,
    count: favorites.length,
  };
};

