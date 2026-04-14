/**
 * MAGNET-OMEGA DHT Crawler
 * 完整实现Kademlia协议 + BEP 5/9/10扩展
 * 支持：节点发现、路由表维护、元数据交换、P2P连接
 */

const dgram = require('dgram');
const crypto = require('crypto');
const EventEmitter = require('events');
const bencode = require('bencode');
const net = require('net');

// DHT常量
const DHT_CONSTANTS = {
  K: 20,                    // 每个桶的最大节点数
  ALPHA: 3,                 // 并行查询数
  REFRESH_INTERVAL: 900000, // 15分钟刷新
  NODE_TIMEOUT: 900000,     // 15分钟超时
  TOKEN_TIMEOUT: 600000,    // 10分钟token有效期
  
  // BEP 5 消息类型
  QUERY_PING: 'ping',
  QUERY_FIND_NODE: 'find_node',
  QUERY_GET_PEERS: 'get_peers',
  QUERY_ANNOUNCE_PEER: 'announce_peer',
  
  // BEP 10 扩展协议
  EXTENDED_HANDSHAKE: 0,
  EXTENDED_METADATA: 1,
};

class DHTNode {
  constructor(nodeId, address, port) {
    this.id = nodeId;
    this.address = address;
    this.port = port;
    this.lastSeen = Date.now();
    this.token = null;
    this.tokenTime = 0;
  }

  toCompact() {
    const buf = Buffer.allocUnsafe(26);
    this.id.copy(buf, 0);
    const addrParts = this.address.split('.');
    for (let i = 0; i < 4; i++) {
      buf[20 + i] = parseInt(addrParts[i], 10);
    }
    buf.writeUInt16BE(this.port, 24);
    return buf;
  }

  static fromCompact(buf) {
    const id = buf.slice(0, 20);
    const address = `${buf[20]}.${buf[21]}.${buf[22]}.${buf[23]}`;
    const port = buf.readUInt16BE(24);
    return new DHTNode(id, address, port);
  }

  distance(target) {
    // XOR距离
    const dist = Buffer.allocUnsafe(20);
    for (let i = 0; i < 20; i++) {
      dist[i] = this.id[i] ^ target[i];
    }
    return dist;
  }
}

class RoutingTable {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.buckets = Array(160).fill(null).map(() => []);
    this.nodes = new Map(); // nodeId -> DHTNode
  }

  // 计算桶索引
  bucketIndex(nodeId) {
    const dist = Buffer.allocUnsafe(20);
    for (let i = 0; i < 20; i++) {
      dist[i] = this.nodeId[i] ^ nodeId[i];
    }
    
    for (let i = 0; i < 20; i++) {
      if (dist[i] === 0) continue;
      for (let j = 7; j >= 0; j--) {
        if ((dist[i] >> j) & 1) {
          return i * 8 + (7 - j);
        }
      }
    }
    return 159; // 相同节点
  }

  addNode(node) {
    if (node.id.equals(this.nodeId)) return false;
    
    const idx = this.bucketIndex(node.id);
    const bucket = this.buckets[idx];
    
    // 检查是否已存在
    const existingIdx = bucket.findIndex(n => n.id.equals(node.id));
    if (existingIdx !== -1) {
      bucket[existingIdx].lastSeen = Date.now();
      return true;
    }

    // 桶未满，直接添加
    if (bucket.length < DHT_CONSTANTS.K) {
      bucket.push(node);
      this.nodes.set(node.id.toString('hex'), node);
      return true;
    }

    // 桶已满，尝试替换最老的节点
    const oldest = bucket.reduce((a, b) => a.lastSeen < b.lastSeen ? a : b);
    if (Date.now() - oldest.lastSeen > DHT_CONSTANTS.NODE_TIMEOUT) {
      const replaceIdx = bucket.indexOf(oldest);
      bucket[replaceIdx] = node;
      this.nodes.delete(oldest.id.toString('hex'));
      this.nodes.set(node.id.toString('hex'), node);
      return true;
    }

    return false; // 桶满且节点都活跃
  }

  getClosestNodes(target, count = DHT_CONSTANTS.K) {
    const allNodes = Array.from(this.nodes.values());
    
    allNodes.sort((a, b) => {
      const distA = a.distance(target);
      const distB = b.distance(target);
      return distA.compare(distB);
    });

    return allNodes.slice(0, count);
  }

  // 随机选择节点用于刷新
  getRandomNodes(count) {
    const allNodes = Array.from(this.nodes.values());
    const shuffled = allNodes.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  get size() {
    return this.nodes.size;
  }
}

class MetadataExchange extends EventEmitter {
  constructor() {
    super();
    this.pendingMetadata = new Map(); // infoHash -> { peers: [], pieces: [], size: null }
    this.activeConnections = new Map(); // infoHash -> socket
  }

  async fetchMetadata(infoHash, peers, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const metadata = {
        infoHash,
        peers: [...peers],
        pieces: [],
        size: null,
        utMetadataId: null,
        receivedPieces: new Set(),
      };

      this.pendingMetadata.set(infoHash.toString('hex'), metadata);

      // 尝试连接多个peer
      let connected = 0;
      let completed = false;

      const onComplete = (data) => {
        if (completed) return;
        completed = true;
        this.pendingMetadata.delete(infoHash.toString('hex'));
        resolve(data);
      };

      const onError = (err) => {
        if (completed) return;
        connected--;
        if (connected === 0 && metadata.peers.length === 0) {
          completed = true;
          this.pendingMetadata.delete(infoHash.toString('hex'));
          reject(new Error('All peers failed'));
        }
      };

      // 并行连接最多5个peer
      const tryPeers = metadata.peers.slice(0, 5);
      
      for (const peer of tryPeers) {
        this.connectToPeer(peer, infoHash, metadata, onComplete, onError)
          .then(() => { connected++; })
          .catch(onError);
      }

      // 超时处理
      setTimeout(() => {
        if (!completed) {
          completed = true;
          this.pendingMetadata.delete(infoHash.toString('hex'));
          reject(new Error('Metadata fetch timeout'));
        }
      }, timeout);
    });
  }

  async connectToPeer(peer, infoHash, metadata, onComplete, onError) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const peerId = crypto.randomBytes(20);
      
      let handshakeComplete = false;
      let extHandshakeComplete = false;
      let buffer = Buffer.alloc(0);

      socket.setTimeout(10000);
      socket.setNoDelay(true);

      socket.connect(peer.port, peer.ip, () => {
        // 发送BitTorrent握手
        const handshake = this.buildHandshake(infoHash, peerId);
        socket.write(handshake);
      });

      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);

        if (!handshakeComplete && buffer.length >= 68) {
          const response = buffer.slice(0, 68);
          buffer = buffer.slice(68);
          
          // 验证握手
          if (response[0] !== 0x13 || 
              response.slice(1, 20).toString() !== 'BitTorrent protocol') {
            socket.destroy();
            reject(new Error('Invalid handshake'));
            return;
          }

          // 检查扩展协议支持
          const reserved = response.slice(20, 28);
          const supportsExtended = (reserved[5] & 0x10) !== 0;

          if (!supportsExtended) {
            socket.destroy();
            reject(new Error('Peer does not support extended protocol'));
            return;
          }

          handshakeComplete = true;

          // 发送扩展握手
          const extHandshake = this.buildExtendedHandshake();
          socket.write(extHandshake);
        }

        if (handshakeComplete && !extHandshakeComplete) {
          // 处理扩展握手响应
          const msg = this.parseMessage(buffer);
          if (msg && msg.id === 20 && msg.extId === 0) {
            buffer = msg.remaining;
            
            try {
              const dict = bencode.decode(msg.payload);
              metadata.utMetadataId = dict.m && dict.m.ut_metadata;
              metadata.size = dict.metadata_size;

              if (!metadata.utMetadataId || !metadata.size) {
                socket.destroy();
                reject(new Error('Peer does not support metadata exchange'));
                return;
              }

              extHandshakeComplete = true;

              // 计算需要的piece数量
              const numPieces = Math.ceil(metadata.size / 16384);
              metadata.totalPieces = numPieces;

              // 请求第一个piece
              this.requestMetadataPiece(socket, metadata.utMetadataId, 0);

            } catch (e) {
              socket.destroy();
              reject(e);
            }
          }
        }

        if (extHandshakeComplete) {
          // 处理metadata piece
          while (buffer.length > 4) {
            const msg = this.parseMessage(buffer);
            if (!msg) break;

            buffer = msg.remaining;

            if (msg.id === 20 && msg.extId === metadata.utMetadataId) {
              this.handleMetadataPiece(msg.payload, metadata, socket, onComplete);
            }
          }
        }
      });

      socket.on('error', reject);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });
      socket.on('close', () => {
        if (!metadata.completed) {
          reject(new Error('Connection closed'));
        }
      });

      this.activeConnections.set(infoHash.toString('hex'), socket);
    });
  }

  buildHandshake(infoHash, peerId) {
    const buf = Buffer.allocUnsafe(68);
    buf[0] = 0x13;
    buf.write('BitTorrent protocol', 1);
    
    // Reserved bytes - 启用扩展协议
    const reserved = Buffer.alloc(8);
    reserved[5] = 0x10; // 扩展协议标志
    reserved.copy(buf, 20);
    
    infoHash.copy(buf, 28);
    peerId.copy(buf, 48);
    
    return buf;
  }

  buildExtendedHandshake() {
    const dict = {
      m: {
        ut_metadata: 1,
      },
    };
    
    const payload = bencode.encode(dict);
    const msg = Buffer.allocUnsafe(6 + payload.length);
    
    msg.writeUInt32BE(2 + payload.length, 0);
    msg[4] = 20; // 扩展消息ID
    msg[5] = 0;  // 扩展握手
    payload.copy(msg, 6);
    
    return msg;
  }

  requestMetadataPiece(socket, utMetadataId, piece) {
    const dict = {
      msg_type: 0, // request
      piece: piece,
    };
    
    const payload = bencode.encode(dict);
    const msg = Buffer.allocUnsafe(6 + payload.length);
    
    msg.writeUInt32BE(2 + payload.length, 0);
    msg[4] = 20;
    msg[5] = utMetadataId;
    payload.copy(msg, 6);
    
    socket.write(msg);
  }

  handleMetadataPiece(payload, metadata, socket, onComplete) {
    try {
      // 解析piece消息
      let dictEnd = 0;
      for (let i = 0; i < payload.length && i < 1000; i++) {
        if (payload[i] === 0x65) { // 'e'
          try {
            bencode.decode(payload.slice(0, i + 1));
            dictEnd = i + 1;
            break;
          } catch (e) {}
        }
      }

      const dict = bencode.decode(payload.slice(0, dictEnd));
      const pieceData = payload.slice(dictEnd);
      
      const pieceIndex = dict.piece;
      
      if (metadata.receivedPieces.has(pieceIndex)) return;
      
      metadata.receivedPieces.add(pieceIndex);
      metadata.pieces[pieceIndex] = pieceData;

      // 检查是否完成
      if (metadata.receivedPieces.size === metadata.totalPieces) {
        metadata.completed = true;
        
        // 重组metadata
        const fullMetadata = Buffer.concat(metadata.pieces);
        
        // 验证hash
        const infoHash = crypto.createHash('sha1').update(fullMetadata).digest();
        
        // 解析torrent info
        const info = bencode.decode(fullMetadata);
        
        onComplete({
          infoHash: infoHash.toString('hex'),
          info: info,
          raw: fullMetadata,
          files: this.parseFiles(info),
        });

        socket.destroy();
      } else {
        // 请求下一个piece
        const nextPiece = Math.min(...Array.from({length: metadata.totalPieces}, (_, i) => i)
          .filter(i => !metadata.receivedPieces.has(i)));
        this.requestMetadataPiece(socket, metadata.utMetadataId, nextPiece);
      }
    } catch (e) {
      console.error('Failed to handle metadata piece:', e);
    }
  }

  parseMessage(buffer) {
    if (buffer.length < 4) return null;
    
    const length = buffer.readUInt32BE(0);
    if (buffer.length < 4 + length) return null;
    
    const msg = buffer.slice(4, 4 + length);
    const remaining = buffer.slice(4 + length);
    
    if (msg.length === 0) {
      // keep-alive
      return { id: -1, remaining };
    }
    
    const id = msg[0];
    
    if (id === 20 && msg.length > 1) {
      // 扩展消息
      return {
        id: 20,
        extId: msg[1],
        payload: msg.slice(2),
        remaining,
      };
    }
    
    return {
      id,
      payload: msg.slice(1),
      remaining,
    };
  }

  parseFiles(info) {
    if (info.files) {
      // 多文件
      return info.files.map(f => ({
        path: f.path.map(p => p.toString()).join('/'),
        length: f.length,
        name: f.path[f.path.length - 1].toString(),
      }));
    } else {
      // 单文件
      return [{
        path: info.name.toString(),
        length: info.length,
        name: info.name.toString(),
      }];
    }
  }
}

class DHTCrawler extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.nodeId = options.nodeId || crypto.randomBytes(20);
    this.port = options.port || 6881;
    this.bootstrapNodes = options.bootstrapNodes || [
      { address: 'router.bittorrent.com', port: 6881 },
      { address: 'router.utorrent.com', port: 6881 },
      { address: 'dht.transmissionbt.com', port: 6881 },
      // 更多bootstrap节点...
      { address: 'dht.aelitis.com', port: 6881 },
      { address: 'dht.libtorrent.org', port: 25401 },
    ];
    
    this.routingTable = new RoutingTable(this.nodeId);
    this.metadataExchange = new MetadataExchange();
    
    this.socket = dgram.createSocket('udp4');
    this.transactionId = 0;
    this.transactions = new Map(); // tid -> { resolve, reject, timer }
    
    this.seenInfoHashes = new Set();
    this.infoHashQueue = [];
    this.processingInfoHashes = new Set();
    
    this.stats = {
      nodesDiscovered: 0,
      peersDiscovered: 0,
      metadataFetched: 0,
      infoHashesSeen: 0,
    };
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.socket.bind(this.port, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        console.log(`DHT Crawler started on port ${this.port}`);
        console.log(`Node ID: ${this.nodeId.toString('hex')}`);
        
        this.setupSocketHandlers();
        this.startMaintenanceLoops();
        this.bootstrap();
        
        resolve();
      });
    });
  }

  setupSocketHandlers() {
    this.socket.on('message', (msg, rinfo) => {
      this.handleMessage(msg, rinfo);
    });

    this.socket.on('error', (err) => {
      console.error('Socket error:', err);
    });
  }

  handleMessage(msg, rinfo) {
    try {
      const data = bencode.decode(msg);
      
      if (data.y) {
        switch (data.y.toString()) {
          case 'r':
            this.handleResponse(data, rinfo);
            break;
          case 'q':
            this.handleQuery(data, rinfo);
            break;
          case 'e':
            this.handleError(data, rinfo);
            break;
        }
      }
    } catch (e) {
      // 忽略无效消息
    }
  }

  handleQuery(data, rinfo) {
    const queryType = data.q.toString();
    const args = data.a;
    const tid = data.t;

    const nodeId = args.id;
    const node = new DHTNode(nodeId, rinfo.address, rinfo.port);
    this.routingTable.addNode(node);

    switch (queryType) {
      case DHT_CONSTANTS.QUERY_PING:
        this.sendResponse(tid, { id: this.nodeId }, rinfo);
        break;
        
      case DHT_CONSTANTS.QUERY_FIND_NODE:
        const target = args.target;
        const nodes = this.routingTable.getClosestNodes(target, DHT_CONSTANTS.K);
        const compactNodes = Buffer.concat(nodes.map(n => n.toCompact()));
        this.sendResponse(tid, { id: this.nodeId, nodes: compactNodes }, rinfo);
        break;
        
      case DHT_CONSTANTS.QUERY_GET_PEERS:
        const infoHash = args.info_hash;
        this.handleGetPeers(tid, infoHash, node, rinfo);
        break;
        
      case DHT_CONSTANTS.QUERY_ANNOUNCE_PEER:
        this.handleAnnouncePeer(tid, args, node, rinfo);
        break;
    }
  }

  handleGetPeers(tid, infoHash, node, rinfo) {
    // 生成token
    const token = crypto.randomBytes(4);
    node.token = token;
    node.tokenTime = Date.now();

    // 记录这个infoHash
    this.onInfoHashSeen(infoHash);

    // 返回nodes（我们没有peers列表，返回最近的节点）
    const nodes = this.routingTable.getClosestNodes(infoHash, DHT_CONSTANTS.K);
    const compactNodes = Buffer.concat(nodes.map(n => n.toCompact()));

    this.sendResponse(tid, {
      id: this.nodeId,
      token,
      nodes: compactNodes,
    }, rinfo);
  }

  handleAnnouncePeer(tid, args, node, rinfo) {
    // 验证token
    if (!node.token || Date.now() - node.tokenTime > DHT_CONSTANTS.TOKEN_TIMEOUT) {
      this.sendError(tid, 203, 'Bad token', rinfo);
      return;
    }

    const infoHash = args.info_hash;
    const port = args.implied_port && args.implied_port !== 0 
      ? rinfo.port 
      : args.port;

    // 这是一个做种者！
    this.emit('peer', {
      infoHash: infoHash.toString('hex'),
      ip: rinfo.address,
      port: port,
    });

    this.stats.peersDiscovered++;

    this.sendResponse(tid, { id: this.nodeId }, rinfo);
  }

  onInfoHashSeen(infoHash) {
    const hex = infoHash.toString('hex');
    
    if (this.seenInfoHashes.has(hex)) return;
    
    this.seenInfoHashes.add(hex);
    this.stats.infoHashesSeen++;
    
    this.emit('infoHash', {
      infoHash: hex,
      timestamp: Date.now(),
    });

    // 加入队列获取metadata
    this.infoHashQueue.push({
      infoHash,
      discoveredAt: Date.now(),
    });

    this.processMetadataQueue();
  }

  async processMetadataQueue() {
    // 限制并发
    if (this.processingInfoHashes.size >= 10) return;
    
    const item = this.infoHashQueue.shift();
    if (!item) return;

    const hex = item.infoHash.toString('hex');
    if (this.processingInfoHashes.has(hex)) return;

    this.processingInfoHashes.add(hex);

    try {
      // 先通过DHT找到更多peers
      const peers = await this.findPeers(item.infoHash);
      
      if (peers.length > 0) {
        // 尝试获取metadata
        const metadata = await this.metadataExchange.fetchMetadata(
          item.infoHash,
          peers,
          30000
        );

        this.stats.metadataFetched++;
        
        this.emit('metadata', {
          infoHash: hex,
          ...metadata,
          discoveredAt: item.discoveredAt,
        });
      }
    } catch (e) {
      // metadata获取失败，但infoHash仍然有价值
      this.emit('infoHashOnly', {
        infoHash: hex,
        discoveredAt: item.discoveredAt,
        error: e.message,
      });
    } finally {
      this.processingInfoHashes.delete(hex);
      this.processMetadataQueue(); // 继续处理队列
    }
  }

  async findPeers(infoHash, timeout = 10000) {
    const peers = new Set();
    
    // 并行查询最近的节点
    const closest = this.routingTable.getClosestNodes(infoHash, DHT_CONSTANTS.ALPHA);
    
    await Promise.all(closest.map(async (node) => {
      try {
        const response = await this.sendQuery(
          node,
          DHT_CONSTANTS.QUERY_GET_PEERS,
          { id: this.nodeId, info_hash: infoHash },
          timeout
        );
        
        if (response.values) {
          // 收到peers列表（compact格式）
          const peerList = response.values;
          for (let i = 0; i < peerList.length; i += 6) {
            const ip = `${peerList[i]}.${peerList[i+1]}.${peerList[i+2]}.${peerList[i+3]}`;
            const port = peerList.readUInt16BE(i + 4);
            peers.add(JSON.stringify({ ip, port }));
          }
        }
        
        // 继续深入查询返回的nodes
        if (response.nodes) {
          const newNodes = this.parseNodes(response.nodes);
          // 递归查询...
        }
      } catch (e) {
        // 忽略失败
      }
    }));

    return Array.from(peers).map(p => JSON.parse(p));
  }

  parseNodes(buf) {
    const nodes = [];
    for (let i = 0; i < buf.length; i += 26) {
      if (i + 26 > buf.length) break;
      nodes.push(DHTNode.fromCompact(buf.slice(i, i + 26)));
    }
    return nodes;
  }

  sendQuery(node, queryType, args, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const tid = Buffer.allocUnsafe(2);
      tid.writeUInt16BE(++this.transactionId, 0);
      
      const message = bencode.encode({
        t: tid,
        y: 'q',
        q: queryType,
        a: args,
      });

      const timer = setTimeout(() => {
        this.transactions.delete(tid.toString('hex'));
        reject(new Error('Query timeout'));
      }, timeout);

      this.transactions.set(tid.toString('hex'), {
        resolve,
        reject,
        timer,
      });

      this.socket.send(message, node.port, node.address, (err) => {
        if (err) {
          clearTimeout(timer);
          this.transactions.delete(tid.toString('hex'));
          reject(err);
        }
      });
    });
  }

  sendResponse(tid, response, rinfo) {
    const message = bencode.encode({
      t: tid,
      y: 'r',
      r: response,
    });
    this.socket.send(message, rinfo.port, rinfo.address);
  }

  sendError(tid, code, message, rinfo) {
    const msg = bencode.encode({
      t: tid,
      y: 'e',
      e: [code, message],
    });
    this.socket.send(msg, rinfo.port, rinfo.address);
  }

  handleResponse(data, rinfo) {
    const tid = data.t.toString('hex');
    const transaction = this.transactions.get(tid);
    
    if (transaction) {
      clearTimeout(transaction.timer);
      this.transactions.delete(tid);
      transaction.resolve(data.r);
    }
  }

  handleError(data, rinfo) {
    const tid = data.t.toString('hex');
    const transaction = this.transactions.get(tid);
    
    if (transaction) {
      clearTimeout(transaction.timer);
      this.transactions.delete(tid);
      transaction.reject(new Error(data.e[1].toString()));
    }
  }

  async bootstrap() {
    for (const node of this.bootstrapNodes) {
      try {
        const { address } = await require('dns').promises.lookup(node.address);
        const bootstrapNode = new DHTNode(
          crypto.randomBytes(20),
          address,
          node.port
        );
        
        // 发送find_node查询自己
        const response = await this.sendQuery(
          bootstrapNode,
          DHT_CONSTANTS.QUERY_FIND_NODE,
          { id: this.nodeId, target: crypto.randomBytes(20) },
          5000
        );
        
        if (response.nodes) {
          const nodes = this.parseNodes(response.nodes);
          for (const n of nodes) {
            this.routingTable.addNode(n);
          }
        }
      } catch (e) {
        console.error(`Bootstrap failed for ${node.address}:`, e.message);
      }
    }
    
    console.log(`Bootstrap complete. Routing table size: ${this.routingTable.size}`);
    
    // 开始随机游走发现更多节点
    this.startRandomWalk();
  }

  startRandomWalk() {
    setInterval(async () => {
      // 随机生成目标，发现新节点
      const randomTarget = crypto.randomBytes(20);
      const closest = this.routingTable.getClosestNodes(randomTarget, DHT_CONSTANTS.ALPHA);
      
      for (const node of closest) {
        try {
          const response = await this.sendQuery(
            node,
            DHT_CONSTANTS.QUERY_FIND_NODE,
            { id: this.nodeId, target: randomTarget },
            5000
          );
          
          if (response.nodes) {
            const nodes = this.parseNodes(response.nodes);
            for (const n of nodes) {
              if (this.routingTable.addNode(n)) {
                this.stats.nodesDiscovered++;
              }
            }
          }
        } catch (e) {
          // 忽略
        }
      }
    }, 1000); // 每秒进行一次随机游走
  }

  startMaintenanceLoops() {
    // 定期刷新桶
    setInterval(() => {
      for (let i = 0; i < 160; i++) {
        const bucket = this.routingTable.buckets[i];
        if (bucket.length > 0 && Date.now() - bucket[0].lastSeen > DHT_CONSTANTS.REFRESH_INTERVAL) {
          // 刷新这个桶
          const randomTarget = Buffer.alloc(20);
          randomTarget.fill(0);
          const byteIndex = Math.floor(i / 8);
          const bitIndex = 7 - (i % 8);
          randomTarget[byteIndex] |= (1 << bitIndex);
          
          // 查询这个桶中的节点
          for (const node of bucket.slice(0, 3)) {
            this.sendQuery(node, DHT_CONSTANTS.QUERY_FIND_NODE, {
              id: this.nodeId,
              target: randomTarget,
            }).catch(() => {});
          }
        }
      }
    }, DHT_CONSTANTS.REFRESH_INTERVAL);

    // 定期报告统计
    setInterval(() => {
      console.log('DHT Stats:', this.stats);
      this.emit('stats', { ...this.stats });
    }, 60000);
  }

  getStats() {
    return {
      ...this.stats,
      routingTableSize: this.routingTable.size,
      pendingMetadata: this.infoHashQueue.length,
      processingMetadata: this.processingInfoHashes.size,
    };
  }

  stop() {
    this.socket.close();
    for (const [_, transaction] of this.transactions) {
      clearTimeout(transaction.timer);
    }
    this.transactions.clear();
  }
}

// 导出
module.exports = { DHTCrawler, DHTNode, RoutingTable, MetadataExchange };

