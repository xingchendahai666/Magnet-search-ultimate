/**
 * 磁力链接/种子文件元数据解析
 * 使用 WebTorrent 和自定义 DHT 爬虫获取真实文件列表
 */

const WebTorrent = require('webtorrent');
const parseTorrent = require('parse-torrent');
const crypto = require('crypto');
const axios = require('axios');

// 内存缓存
const metadataCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30分钟

// WebTorrent 客户端池
const clientPool = [];

class TorrentMetadataService {
  constructor() {
    this.activeDownloads = new Map();
    this.maxConcurrent = 5;
  }

  /**
   * 获取磁力链接的完整元数据
   */
  async getMetadata(magnetUri, options = {}) {
    const { timeout = 30000, maxFiles = 1000 } = options;
    
    // 检查缓存
    const cacheKey = this.extractHash(magnetUri);
    const cached = metadataCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    // 并行尝试多种方式获取元数据
    const attempts = await Promise.allSettled([
      // 方式1: WebTorrent DHT 获取
      this.fetchViaWebTorrent(magnetUri, timeout),
      
      // 方式2: 种子缓存服务
      this.fetchFromCacheServices(cacheKey),
      
      // 方式3: 已知种子数据库
      this.fetchFromTorrentDatabases(cacheKey),
    ]);

    // 取第一个成功的结果
    for (const attempt of attempts) {
      if (attempt.status === 'fulfilled' && attempt.value) {
        const metadata = attempt.value;
        
        // 格式化并缓存
        const formatted = this.formatMetadata(metadata);
        metadataCache.set(cacheKey, {
          data: formatted,
          timestamp: Date.now(),
        });
        
        return formatted;
      }
    }

    // 全部失败，返回基础信息
    return this.getBasicInfo(magnetUri);
  }

  /**
   * 使用 WebTorrent 从 DHT 网络获取
   */
  fetchViaWebTorrent(magnetUri, timeout) {
    return new Promise((resolve, reject) => {
      const client = new WebTorrent({
        dht: true,
        tracker: false, // 禁用 tracker 减少连接
      });

      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error('WebTorrent timeout'));
      }, timeout);

      client.add(magnetUri, { store: false }, (torrent) => {
        clearTimeout(timer);
        
        const metadata = {
          infoHash: torrent.infoHash,
          name: torrent.name,
          length: torrent.length,
          files: torrent.files.map(f => ({
            name: f.name,
            path: f.path,
            length: f.length,
            offset: f.offset,
          })),
          created: torrent.created,
          createdBy: torrent.createdBy,
          comment: torrent.comment,
          announce: torrent.announce,
          pieceLength: torrent.pieceLength,
          pieces: torrent.pieces?.length,
        };

        client.destroy();
        resolve(metadata);
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        client.destroy();
        reject(err);
      });
    });
  }

  /**
   * 从种子缓存服务获取
   */
  async fetchFromCacheServices(infoHash) {
    const services = [
      `https://itorrents.org/torrent/${infoHash.toUpperCase()}.torrent`,
      `https://torrage.info/torrent/${infoHash.toUpperCase()}.torrent`,
      `https://btcache.me/torrent/${infoHash}`,
      `https://torrentapi.org/torrent/${infoHash}`,
    ];

    for (const url of services) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 10000,
          maxRedirects: 3,
        });

        const torrent = parseTorrent(Buffer.from(response.data));
        return {
          infoHash: torrent.infoHash,
          name: torrent.name,
          length: torrent.length,
          files: torrent.files?.map(f => ({
            name: f.name,
            path: f.path,
            length: f.length,
            offset: f.offset,
          })) || [{ name: torrent.name, path: torrent.name, length: torrent.length }],
          created: torrent.created,
          createdBy: torrent.createdBy,
          comment: torrent.comment,
          announce: torrent.announceList?.flat() || torrent.announce,
          pieceLength: torrent.pieceLength,
          pieces: torrent.pieces?.length,
        };
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  /**
   * 从已知数据库查询
   */
  async fetchFromTorrentDatabases(infoHash) {
    // 查询外部API数据库
    const apis = [
      `https://apibay.org/torrent.php?id=${infoHash}`,
      `https://torrents-csv.com/service/get?hash=${infoHash}`,
    ];

    for (const api of apis) {
      try {
        const { data } = await axios.get(api, { timeout: 8000 });
        if (data && (data.name || data.title)) {
          return {
            infoHash,
            name: data.name || data.title,
            length: data.size || data.size_bytes,
            files: data.files || [{ 
              name: data.name || data.title, 
              path: data.name || data.title, 
              length: data.size || data.size_bytes 
            }],
            source: 'database',
          };
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  /**
   * 获取基础信息（从磁力链接解析）
   */
  getBasicInfo(magnetUri) {
    try {
      const parsed = parseTorrent(magnetUri);
      return {
        infoHash: parsed.infoHash,
        name: parsed.name || 'Unknown',
        length: 0,
        files: parsed.name ? [{ name: parsed.name, path: parsed.name, length: 0 }] : [],
        announce: parsed.announceList?.flat() || [parsed.announce].filter(Boolean),
        source: 'magnet-only',
        partial: true,
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 格式化元数据
   */
  formatMetadata(raw) {
    const files = raw.files || [];
    
    // 计算目录结构
    const fileTree = this.buildFileTree(files);
    
    // 统计信息
    const stats = {
      totalFiles: files.length,
      totalSize: files.reduce((sum, f) => sum + (f.length || 0), 0),
      largestFile: files.reduce((max, f) => f.length > max.length ? f : max, files[0] || {}),
      averageSize: files.length > 0 
        ? files.reduce((sum, f) => sum + (f.length || 0), 0) / files.length 
        : 0,
      fileTypes: this.categorizeFiles(files),
      directories: this.countDirectories(fileTree),
    };

    // 文件类型分布
    const extensions = {};
    files.forEach(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      extensions[ext] = (extensions[ext] || 0) + 1;
    });

    return {
      infoHash: raw.infoHash,
      name: raw.name,
      created: raw.created,
      createdBy: raw.createdBy,
      comment: raw.comment,
      pieceLength: raw.pieceLength,
      pieces: raw.pieces,
      
      // 文件信息
      files: files.map(f => ({
        name: f.name,
        path: f.path,
        size: f.length,
        sizeFormatted: this.formatBytes(f.length),
        extension: f.name.split('.').pop().toLowerCase(),
        type: this.getFileType(f.name),
      })),
      
      // 目录树
      fileTree,
      
      // 统计
      stats: {
        ...stats,
        totalSizeFormatted: this.formatBytes(stats.totalSize),
        largestFileFormatted: this.formatBytes(stats.largestFile?.length || 0),
        averageSizeFormatted: this.formatBytes(stats.averageSize),
        extensions: Object.entries(extensions)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      },
      
      // 来源标记
      source: raw.source || 'dht',
      partial: raw.partial || false,
      
      // 时间戳
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * 构建文件树
   */
  buildFileTree(files) {
    const root = { name: '', children: [], files: [] };
    
    for (const file of files) {
      const parts = file.path.split('/');
      let current = root;
      
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        let dir = current.children.find(c => c.name === part);
        if (!dir) {
          dir = { name: part, children: [], files: [] };
          current.children.push(dir);
        }
        current = dir;
      }
      
      current.files.push({
        name: parts[parts.length - 1],
        size: file.length,
        sizeFormatted: this.formatBytes(file.length),
      });
    }
    
    return root;
  }

  /**
   * 统计目录数
   */
  countDirectories(node) {
    let count = node.children?.length || 0;
    for (const child of (node.children || [])) {
      count += this.countDirectories(child);
    }
    return count;
  }

  /**
   * 文件分类
   */
  categorizeFiles(files) {
    const categories = {
      video: 0,
      audio: 0,
      image: 0,
      document: 0,
      archive: 0,
      executable: 0,
      other: 0,
    };

    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp'];
    const audioExts = ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma', 'opus'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'];
    const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'epub', 'mobi'];
    const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'];
    const exeExts = ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'appimage'];

    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (videoExts.includes(ext)) categories.video++;
      else if (audioExts.includes(ext)) categories.audio++;
      else if (imageExts.includes(ext)) categories.image++;
      else if (docExts.includes(ext)) categories.document++;
      else if (archiveExts.includes(ext)) categories.archive++;
      else if (exeExts.includes(ext)) categories.executable++;
      else categories.other++;
    }

    return categories;
  }

  getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const types = {
      mp4: 'video', mkv: 'video', avi: 'video', mov: 'video',
      mp3: 'audio', flac: 'audio', wav: 'audio',
      jpg: 'image', png: 'image', gif: 'image',
      pdf: 'document', doc: 'document', docx: 'document',
      zip: 'archive', rar: 'archive', '7z': 'archive',
    };
    return types[ext] || 'unknown';
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  extractHash(magnet) {
    const match = magnet.match(/btih:([a-f0-9]{40})/i);
    return match ? match[1].toLowerCase() : crypto.createHash('md5').update(magnet).digest('hex');
  }
}

// 单例
const service = new TorrentMetadataService();

// API 处理函数
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { magnet, timeout = 30000 } = req.body;

  if (!magnet || !magnet.startsWith('magnet:')) {
    return res.status(400).json({
      error: 'INVALID_MAGNET',
      message: '请提供有效的磁力链接',
    });
  }

  try {
    const metadata = await service.getMetadata(magnet, { timeout });
    
    if (!metadata) {
      return res.status(404).json({
        error: 'METADATA_NOT_FOUND',
        message: '无法获取种子元数据，可能暂无做种者',
      });
    }

    res.status(200).json({
      success: true,
      metadata,
    });

  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: error.message,
    });
  }
};

