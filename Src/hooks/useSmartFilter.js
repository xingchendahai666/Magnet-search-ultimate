import { useState, useMemo, useCallback } from 'react';

export const useSmartFilter = (results) => {
  const [filters, setFilters] = useState({
    time: 'any',      // 收录时间
    size: 'any',      // 文件大小
    files: 'any',     // 文件数量
    sort: 'seeders',  // 排序方式
    order: 'desc',    // 升序/降序
  });

  // 时间筛选配置
  const timeConfig = {
    '24h': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '1y': 365,
  };

  // 大小筛选配置
  const sizeConfig = {
    'tiny': { max: 100 * 1024 * 1024 },
    'small': { min: 100 * 1024 * 1024, max: 1024 ** 3 },
    'medium': { min: 1024 ** 3, max: 4 * 1024 ** 3 },
    'large': { min: 4 * 1024 ** 3, max: 20 * 1024 ** 3 },
    'huge': { min: 20 * 1024 ** 3 },
  };

  // 文件数筛选配置
  const filesConfig = {
    'single': { min: 1, max: 1 },
    'few': { min: 2, max: 10 },
    'many': { min: 11, max: 50 },
    'lots': { min: 50 },
  };

  // 应用筛选
  const filteredResults = useMemo(() => {
    let filtered = [...results];

    // 时间筛选
    if (filters.time !== 'any') {
      const days = timeConfig[filters.time];
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      
      filtered = filtered.filter(r => {
        const date = new Date(r.firstSeen || r.date);
        return date >= cutoff;
      });
    }

    // 大小筛选
    if (filters.size !== 'any') {
      const config = sizeConfig[filters.size];
      filtered = filtered.filter(r => {
        const size = r.totalSize || r.size || 0;
        if (config.min && size < config.min) return false;
        if (config.max && size > config.max) return false;
        return true;
      });
    }

    // 文件数筛选
    if (filters.files !== 'any') {
      const config = filesConfig[filters.files];
      filtered = filtered.filter(r => {
        const count = r.fileCount;
        if (!count) return false; // 未知数量的排除
        if (config.min && count < config.min) return false;
        if (config.max && count > config.max) return false;
        return true;
      });
    }

    // 排序
    filtered.sort((a, b) => {
      let aVal, bVal;
      
      switch (filters.sort) {
        case 'seeders':
          aVal = a.seeders || 0;
          bVal = b.seeders || 0;
          break;
        case 'leechers':
          aVal = a.leechers || 0;
          bVal = b.leechers || 0;
          break;
        case 'size':
          aVal = a.totalSize || a.size || 0;
          bVal = b.totalSize || b.size || 0;
          break;
        case 'date':
          aVal = new Date(a.date).getTime();
          bVal = new Date(b.date).getTime();
          break;
        case 'firstSeen':
          aVal = new Date(a.firstSeen || a.date).getTime();
          bVal = new Date(b.firstSeen || b.date).getTime();
          break;
        case 'files':
          aVal = a.fileCount || 0;
          bVal = b.fileCount || 0;
          break;
        case 'name':
          return filters.order === 'asc'
            ? (a.title || '').localeCompare(b.title || '')
            : (b.title || '').localeCompare(a.title || '');
        default:
          // 综合热度
          aVal = (a.seeders || 0) * 2 + (a.fileCount || 0) * 0.1;
          bVal = (b.seeders || 0) * 2 + (b.fileCount || 0) * 0.1;
      }

      return filters.order === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return filtered;
  }, [results, filters]);

  // 切换排序
  const toggleSort = useCallback((field) => {
    setFilters(prev => {
      if (prev.sort === field) {
        // 切换顺序
        return { ...prev, order: prev.order === 'asc' ? 'desc' : 'asc' };
      }
      return { ...prev, sort: field, order: 'desc' };
    });
  }, []);

  return {
    filters,
    setFilters,
    filteredResults,
    toggleSort,
    resultCount: filteredResults.length,
    originalCount: results.length,
  };
};

