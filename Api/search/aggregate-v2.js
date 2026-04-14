/**
 * 终极聚合搜索 v2.0
 * 新增：文件数量检测、收录时间追踪、历史数据库查询
 */

const { searchEngine } = require('../engines');
const { MongoClient } = require('mongodb'); // 可选，用于历史数据

// 历史数据库（模拟，实际可接 MongoDB）
const historyDB = new Map();

class EnhancedSearchEngine {
  constructor() {
    this.metadataQueue = [];
    this.processing = false;
  }

  async searchWithMetadata(query, engines, options = {}) {
    const { fetchMetadata = true, metadataTimeout = 5000 } = options;

    // 第一步：快速搜索获取基础结果
    const baseResults = await this.parallelSearch(query, engines);

    // 第二步：批量获取元数据（异步，不阻塞）
    if (fetchMetadata) {
      this.batchFetchMetadata(baseResults, metadataTimeout);
    }

    // 第三步：查询历史收录时间
    await this.enrichWithHistory(baseResults);

    // 第四步：计算文件数量（从文件名推断）
    this.inferFileCounts(baseResults);

    return baseResults;
  }

  async parallelSearch(query, engines) {
    // 原有并行搜索逻辑，增强返回字段
    const results = [];
    
    await Promise.all(engines.map(async (engine) => {
      try {
        const engineResults = await searchEngine(engine, query);
        
        for (const r of engineResults) {
          results.push({
            ...r,
            // 新增字段
            firstSeen: null,      // 首次收录时间
            lastSeen: new Date().toISOString(), // 最后看到时间
            fileCount: null,      // 文件数量
            hasMetadata: false,   // 是否有完整元数据
            metadataStatus: 'pending', // 元数据获取状态
            contentPreview: null, // 内容预览
          });
        }
      } catch (e) {
        // 记录失败
      }
    }));

    return results;
  }

  /**
   * 批量异步获取元数据
   */
  async batchFetchMetadata(results, timeout) {
    // 只取前20个热门结果获取详细元数据
    const topResults = results
      .sort((a, b) => (b.seeders || 0) - (a.seeders || 0))
      .slice(0, 20);

    for (const result of topResults) {
      // 异步获取，不等待
      this.fetchMetadataAsync(result, timeout);
    }
  }

  async fetchMetadataAsync(result, timeout) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${process.env.API_URL}/api/torrent-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet: result.magnet, timeout }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const { metadata } = await response.json();
        
        // 更新结果
        result.hasMetadata = true;
        result.metadataStatus = 'complete';
        result.fileCount = metadata.stats?.totalFiles;
        result.totalSize = metadata.stats?.totalSize;
        result.files = metadata.files?.slice(0, 100); // 最多100个文件
        result.fileTree = metadata.fileTree;
        result.fileTypes = metadata.stats?.fileTypes;
        result.contentPreview = this.generatePreview(metadata);
      }
    } catch (e) {
      result.metadataStatus = 'failed';
    }
  }

  /**
   * 从文件名推断文件数量
   */
  inferFileCounts(results) {
    for (const r of results) {
      if (r.fileCount) continue;

      // 从标题推断
      const patterns = [
        /(\d+)\s*files?/i,
        /(\d+)\s*集/i,
        /(\d+)\s*话/i,
        /(\d+)\s*卷/i,
        /(\d+)\s*本/i,
        /(\d+)\s*个/i,
        /
 $$(\d+)V$$ /i,
        /
 $$(\d+)\s*Files?$$ /i,
      ];

      for (const pattern of patterns) {
        const match = r.title.match(pattern);
        if (match) {
          r.fileCount = parseInt(match[1]);
          r.fileCountInferred = true;
          break;
        }
      }

      // 根据大小和类型推断
      if (!r.fileCount && r.size) {
        const sizeGB = r.size / (1024 ** 3);
        if (sizeGB > 10 && r.category === 'movies') {
          // 大文件可能是合集
          r.possibleCollection = true;
        }
      }
    }
  }

  /**
   * 查询历史数据库
   */
  async enrichWithHistory(results) {
    for (const r of results) {
      const hash = this.extractHash(r.magnet);
      const history = historyDB.get(hash);
      
      if (history) {
        r.firstSeen = history.firstSeen;
        r.appearanceCount = history.count;
        r.popularityTrend = history.trend;
      } else {
        // 新记录
        historyDB.set(hash, {
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          count: 1,
          trend: 'new',
        });
      }
    }
  }

  /**
   * 生成内容预览
   */
  generatePreview(metadata) {
    const { files, stats } = metadata;
    
    // 取代表性文件
    const samples = files.slice(0, 5).map(f => ({
      name: f.name.length > 50 ? f.name.slice(0, 50) + '...' : f.name,
      size: f.sizeFormatted,
      type: f.type,
    }));

    // 生成描述
    let description = '';
    if (stats.totalFiles === 1) {
      description = `单文件: ${files[0]?.name}`;
    } else {
      const mainType = Object.entries(stats.fileTypes)
        .sort((a, b) => b[1] - a[1])[0];
      description = `${stats.totalFiles}个文件，主要为${mainType?.[0] || '未知类型'}`;
    }

    return {
      samples,
      description,
      structure: stats.directories > 0 ? '有目录结构' : '扁平结构',
    };
  }

  extractHash(magnet) {
    const match = magnet.match(/btih:([a-f0-9]{40})/i);
    return match ? match[1].toLowerCase() : null;
  }
}

// 导出增强版搜索
module.exports = new EnhancedSearchEngine();

