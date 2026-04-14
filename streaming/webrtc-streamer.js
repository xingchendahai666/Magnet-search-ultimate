/**
 * MAGNET-OMEGA 实时流媒体引擎
 * WebRTC DataChannel + WebTorrent 实现边下边播
 */

import WebTorrent from 'webtorrent';
import { EventEmitter } from 'events';

class P2PStreamer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.client = new WebTorrent({
      tracker: {
        wrtc: true, // 启用WebRTC
      },
      dht: true,
      webSeeds: true,
    });

    this.activeStreams = new Map();
    this.preloadCache = new Map();
    this.maxCacheSize = 1024 * 1024 * 1024; // 1GB缓存

    this.setupClientEvents();
  }

  setupClientEvents() {
    this.client.on('error', (err) => {
      console.error('WebTorrent error:', err);
      this.emit('error', err);
    });
  }

  /**
   * 开始流媒体播放
   */
  async startStream(magnetUri, options = {}) {
    const { 
      fileIndex = 0,        // 默认播放第一个视频文件
      preloadSeconds = 30,   // 预加载秒数
      quality = 'auto',      // 质量选择
    } = options;

    const streamId = this.generateStreamId();
    
    return new Promise((resolve, reject) => {
      const torrent = this.client.add(magnetUri, {
        announce: this.getTrackers(),
        store: this.createCustomStore(streamId),
      });

      const streamData = {
        id: streamId,
        torrent,
        file: null,
        mediaSource: null,
        buffer: [],
        stats: {
          downloadSpeed: 0,
          uploadSpeed: 0,
          progress: 0,
          peers: 0,
          ratio: 0,
        },
      };

      torrent.on('error', reject);
      
      torrent.on('metadata', () => {
        console.log('Metadata received:', torrent.name);
        this.emit('metadata', {
          streamId,
          name: torrent.name,
          files: torrent.files.map((f, i) => ({
            index: i,
            name: f.name,
            size: f.length,
            type: this.getFileType(f.name),
          })),
          infoHash: torrent.infoHash,
        });
      });

      torrent.on('ready', () => {
        // 选择要播放的文件
        const videoFiles = torrent.files.filter(f => this.isVideoFile(f.name));
        const targetFile = videoFiles[fileIndex] || torrent.files[0];
        
        streamData.file = targetFile;
        
        // 创建MediaSource
        const mediaSource = this.createMediaSource(targetFile, streamData);
        streamData.mediaSource = mediaSource;

        // 开始选择性下载（优先下载开头）
        this.startSelectiveDownload(targetFile, torrent, preloadSeconds);

        this.activeStreams.set(streamId, streamData);
        
        resolve({
          streamId,
          streamUrl: URL.createObjectURL(mediaSource),
          fileInfo: {
            name: targetFile.name,
            size: targetFile.length,
          },
        });
      });

      torrent.on('download', (bytes) => {
        this.updateStats(streamId);
      });

      torrent.on('upload', (bytes) => {
        this.updateStats(streamId);
      });
    });
  }

  /**
   * 创建MediaSource进行流式播放
   */
  createMediaSource(file, streamData) {
    const mediaSource = new MediaSource();
    
    mediaSource.addEventListener('sourceopen', () => {
      const mimeType = this.getMimeType(file.name);
      const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      
      sourceBuffer.addEventListener('updateend', () => {
        this.emit('bufferUpdate', {
          streamId: streamData.id,
          buffered: sourceBuffer.buffered,
        });
      });

      // 从WebTorrent流读取数据
      const stream = file.createReadStream();
      
      stream.on('data', (chunk) => {
        if (sourceBuffer.updating) {
          streamData.buffer.push(chunk);
        } else {
          try {
            sourceBuffer.appendBuffer(chunk);
          } catch (e) {
            // 缓冲区满，等待
            streamData.buffer.push(chunk);
          }
        }
      });

      stream.on('end', () => {
        if (mediaSource.readyState === 'open') {
          mediaSource.endOfStream();
        }
      });
    });

    return mediaSource;
  }

  /**
   * 选择性下载：优先下载视频开头，支持seek
   */
  startSelectiveDownload(file, torrent, preloadSeconds) {
    // 获取视频元数据（moov atom位置）
    const pieceLength = torrent.pieceLength;
    const fileOffset = file.offset;
    
    // 优先下载文件前10%（通常包含moov）
    const priorityEnd = Math.min(
      file.length * 0.1,
      10 * 1024 * 1024 // 最大10MB
    );
    
    const startPiece = Math.floor(fileOffset / pieceLength);
    const priorityPiece = Math.floor((fileOffset + priorityEnd) / pieceLength);
    
    // 设置优先级
    for (let i = startPiece; i <= priorityPiece; i++) {
      torrent.select(i, i, 10); // 最高优先级
    }

    // 预加载后续内容
    const bitrate = 5 * 1024 * 1024; // 假设5Mbps
    const preloadBytes = bitrate * preloadSeconds;
    const preloadPiece = Math.floor((fileOffset + preloadBytes) / pieceLength);
    
    for (let i = priorityPiece + 1; i <= preloadPiece; i++) {
      torrent.select(i, i, 5); // 中等优先级
    }

    // 其余低优先级
    const endPiece = Math.floor((fileOffset + file.length) / pieceLength);
    for (let i = preloadPiece + 1; i <= endPiece; i++) {
      torrent.select(i, i, 1); // 低优先级
    }
  }

  /**
   * 处理seek操作
   */
  async seek(streamId, timeSeconds) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) throw new Error('Stream not found');

    const { file, torrent } = stream;
    
    // 估算字节位置（需要知道视频码率）
    const bitrate = await this.detectBitrate(file);
    const bytePosition = Math.floor(timeSeconds * bitrate / 8);
    
    // 计算piece位置
    const pieceLength = torrent.pieceLength;
    const fileOffset = file.offset;
    const targetPiece = Math.floor((fileOffset + bytePosition) / pieceLength);
    
    // 取消之前的优先级
    torrent.deselect(0, torrent.pieces.length - 1, 0);
    
    // 设置新的优先级：目标位置前后30秒
    const windowBytes = bitrate * 30 / 8;
    const windowPieces = Math.ceil(windowBytes / pieceLength);
    
    for (let i = targetPiece - windowPieces; i <= targetPiece + windowPieces; i++) {
      if (i >= 0 && i < torrent.pieces.length) {
        torrent.select(i, i, i >= targetPiece ? 10 : 5);
      }
    }

    // 通知播放器可以seek了
    this.emit('seekReady', { streamId, time: timeSeconds });
  }

  /**
   * 码率检测
   */
  async detectBitrate(file) {
    // 读取文件开头获取moov box
    const headerStream = file.createReadStream({ start: 0, end: 1024 * 1024 });
    
    return new Promise((resolve) => {
      let data = Buffer.alloc(0);
      
      headerStream.on('data', (chunk) => {
        data = Buffer.concat([data, chunk]);
      });
      
      headerStream.on('end', () => {
        // 解析mp4/mkv头部获取码率信息
        const bitrate = this.parseBitrateFromHeader(data);
        resolve(bitrate || 5 * 1024 * 1024); // 默认5Mbps
      });
      
      headerStream.on('error', () => {
        resolve(5 * 1024 * 1024);
      });
    });
  }

  parseBitrateFromHeader(data) {
    // 简化的MP4解析，查找moov/mvhd中的timescale和duration
    // 实际实现需要完整的MP4解析库
    return null;
  }

  /**
   * 获取播放统计
   */
  getStats(streamId) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return null;

    const { torrent } = stream;
    
    return {
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      progress: torrent.progress,
      peers: torrent.numPeers,
      ratio: torrent.ratio,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
    };
  }

  /**
   * 停止播放并清理
   */
  stopStream(streamId) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return;

    const { torrent } = stream;
    
    // 销毁torrent（但保留做种）
    torrent.destroy({ destroyStore: false });
    
    this.activeStreams.delete(streamId);
    
    this.emit('streamEnded', { streamId });
  }

  /**
   * 创建自定义存储，支持LRU缓存
   */
  createCustomStore(streamId) {
    // 使用idb-chunk-store或自定义实现
    // 支持跨会话缓存
    return {
      // 自定义存储实现
    };
  }

  generateStreamId() {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getTrackers() {
    return [
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.btorrent.xyz',
      'wss://tracker.fastcast.nz',
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://tracker.openbittorrent.com:6969/announce',
    ];
  }

  isVideoFile(filename) {
    return /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|3gp|ts|m2ts)$/i.test(filename);
  }

  getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const types = {
      mp4: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      webm: 'video/webm; codecs="vp9, opus"',
      mkv: 'video/webm; codecs="avc1.42E01E, mp4a.40.2"',
    };
    return types[ext] || 'video/mp4';
  }

  getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const types = {
      mp4: 'video', mkv: 'video', avi: 'video',
      mp3: 'audio', flac: 'audio',
      srt: 'subtitle', ass: 'subtitle',
      nfo: 'info',
    };
    return types[ext] || 'unknown';
  }

  destroy() {
    for (const [id] of this.activeStreams) {
      this.stopStream(id);
    }
    this.client.destroy();
  }
}

export default P2PStreamer;

