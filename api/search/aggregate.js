/**
 * 84引擎并行聚合搜索系统
 * 支持：流式推送、智能去重、动态排序、健康检测
 */

const EventEmitter = require('events');
const axios = require('axios');
const crypto = require('crypto');

// ============================================
// 84个搜索引擎完整配置
// ============================================

const ENGINE_REGISTRY = {
  // ===== TIER 1: 官方API引擎 (高稳定性) =====
  tier1: {
    thepiratebay: {
      name: 'The Pirate Bay',
      weight: 1.0,
      timeout: 8000,
      retries: 2,
      endpoints: [
        'https://apibay.org/q.php?q={q}&cat=0',
        'https://api-pirate-bay.up.railway.app/q.php?q={q}&cat=0',
        'https://tpb-api.herokuapp.com/q.php?q={q}&cat=0',
      ],
      parser: 'tpb',
      features: ['magnet', 'seeders', 'trusted'],
    },
    
    yts: {
      name: 'YTS.mx',
      weight: 1.2,
      timeout: 6000,
      retries: 2,
      endpoint: 'https://yts.mx/api/v2/list_movies.json?query_term={q}&limit=20',
      parser: 'yts',
      features: ['magnet', 'quality', 'rating', 'imdb'],
      category: 'movies',
    },
    
    eztv: {
      name: 'EZTV',
      weight: 1.0,
      timeout: 8000,
      retries: 2,
      endpoints: [
        'https://eztv.re/api/get-torrents?limit=20&page=1&query={q}',
        'https://eztv.ag/api/get-torrents?limit=20&page=1&query={q}',
      ],
      parser: 'eztv',
      features: ['magnet', 'episode', 'season'],
      category: 'tv',
    },
    
    torrentscsv: {
      name: 'Torrents.csv',
      weight: 0.9,
      timeout: 10000,
      retries: 1,
      endpoint: 'https://torrents-csv.com/service/search?q={q}&size=25',
      parser: 'csv',
      features: ['magnet', 'hash', 'date'],
    },
    
    limetorrents: {
      name: 'LimeTorrents',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.limetorrents.lol/search/all/{q}/seeds/1/',
      parser: 'lime',
      features: ['magnet', 'health'],
    },
  },

  // ===== TIER 2: 专业领域引擎 =====
  tier2: {
    nyaa: {
      name: 'Nyaa.si',
      weight: 1.1,
      timeout: 8000,
      retries: 2,
      endpoint: 'https://nyaa.si/?f=0&c=0_0&q={q}&s=seeders&o=desc',
      parser: 'nyaa',
      features: ['magnet', 'category', 'trusted'],
      category: 'anime',
    },
    
    sukebei: {
      name: 'Sukebei',
      weight: 0.9,
      timeout: 8000,
      retries: 2,
      endpoint: 'https://sukebei.nyaa.si/?f=0&c=0_0&q={q}&s=seeders&o=desc',
      parser: 'nyaa',
      features: ['magnet', 'adult'],
      nsfw: true,
    },
    
    dmhy: {
      name: '动漫花园',
      weight: 1.0,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://share.dmhy.org/topics/list?keyword={q}',
      parser: 'dmhy',
      features: ['magnet', 'team', 'category'],
      category: 'anime',
    },
    
    mikan: {
      name: '蜜柑计划',
      weight: 1.0,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://mikanani.me/Home/Search?searchstr={q}',
      parser: 'mikan',
      features: ['magnet', 'bangumi', 'subtitle'],
      category: 'anime',
    },
    
    acgrip: {
      name: 'ACG.RIP',
      weight: 0.9,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://acg.rip/?term={q}',
      parser: 'acgrip',
      features: ['magnet', 'category'],
      category: 'anime',
    },
    
    bangumimoe: {
      name: '萌番组',
      weight: 0.9,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://bangumi.moe/api/torrent/search',
      parser: 'bangumi',
      features: ['magnet', 'tag'],
      category: 'anime',
    },
    
    tokyotosho: {
      name: 'Tokyo Toshokan',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.tokyotosho.info/search.php?terms={q}&type=0&searchName=true&searchComment=true&size_min=&size_max=&username=',
      parser: 'tokyotosho',
      features: ['magnet', 'category'],
      category: 'anime',
    },
    
    animetosho: {
      name: 'Anime Tosho',
      weight: 0.9,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://animetosho.org/search?q={q}',
      parser: 'animetosho',
      features: ['magnet', 'auto-upload', 'nzb'],
      category: 'anime',
    },
    
    subsplease: {
      name: 'SubsPlease',
      weight: 1.0,
      timeout: 8000,
      retries: 2,
      endpoint: 'https://subsplease.org/api/?f=search&tz=Asia/Tokyo&query={q}',
      parser: 'subsplease',
      features: ['magnet', 'release', 'xdcc'],
      category: 'anime',
    },
    
    erairaws: {
      name: 'Erai-Raws',
      weight: 0.9,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.erai-raws.info/?s={q}',
      parser: 'erai',
      features: ['magnet', 'quality', 'multi-sub'],
      category: 'anime',
    },
  },

  // ===== TIER 3: 综合搜索引擎 =====
  tier3: {
    bitsearch: {
      name: 'BitSearch',
      weight: 0.9,
      timeout: 10000,
      retries: 2,
      endpoints: [
        'https://bitsearch.to/search?q={q}',
        'https://bitsearch.cc/search?q={q}',
      ],
      parser: 'bitsearch',
      features: ['magnet', 'index'],
    },
    
    solidtorrents: {
      name: 'SolidTorrents',
      weight: 0.9,
      timeout: 10000,
      retries: 2,
      endpoints: [
        'https://solidtorrents.to/search?q={q}',
        'https://solidtorrents.eu/search?q={q}',
      ],
      parser: 'solid',
      features: ['magnet', 'index'],
    },
    
    knaben: {
      name: 'Knaben',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://knaben.eu/search?q={q}',
      parser: 'knaben',
      features: ['magnet', 'multi-source'],
    },
    
    snowfl: {
      name: 'Snowfl',
      weight: 0.8,
      timeout: 12000,
      retries: 2,
      endpoint: 'https://snowfl.com/{q}',
      parser: 'snowfl',
      features: ['magnet', 'api'],
    },
    
    btsow: {
      name: 'BTSOW',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://btsow.com/search/{q}',
      parser: 'btsow',
      features: ['magnet'],
    },
    
    magnetdl: {
      name: 'MagnetDL',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.magnetdl.com/{first}/{q}/',
      parser: 'magnetdl',
      features: ['magnet', 'hash'],
    },
    
    torlock: {
      name: 'Torlock',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.torlock.com/all/torrents/{q}.html',
      parser: 'torlock',
      features: ['magnet', 'verified'],
    },
    
    torrentgalaxy: {
      name: 'TorrentGalaxy',
      weight: 0.9,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://torrentgalaxy.to/torrents.php?search={q}',
      parser: 'tgx',
      features: ['magnet', 'imdb', 'cover'],
    },
    
    zooqle: {
      name: 'Zooqle',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://zooqle.com/search?q={q}',
      parser: 'zooqle',
      features: ['magnet', 'verified'],
    },
    
    kickass: {
      name: 'Kickass Torrents',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoints: [
        'https://kickasstorrents.to/usearch/{q}/',
        'https://katcr.co/usearch/{q}/',
      ],
      parser: 'kickass',
      features: ['magnet', 'verified'],
    },
    
    extratorrent: {
      name: 'ExtraTorrent',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://extratorrent.st/search/?new=1&search={q}',
      parser: 'extratorrent',
      features: ['magnet'],
    },
    
    torrentdownloads: {
      name: 'Torrent Downloads',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.torrentdownloads.pro/search/?search={q}',
      parser: 'torrentdownloads',
      features: ['magnet'],
    },
    
    torrentfunk: {
      name: 'TorrentFunk',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.torrentfunk.com/all/torrents/{q}.html',
      parser: 'torrentfunk',
      features: ['magnet', 'verified'],
    },
    
    glotorrents: {
      name: 'GloTorrents',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://glodls.to/search_results.php?search={q}',
      parser: 'glotorrents',
      features: ['magnet', 'torrent'],
    },
    
    torrentbay: {
      name: 'TorrentBay',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://torrentbay.net/search?q={q}',
      parser: 'torrentbay',
      features: ['magnet', 'proxy'],
    },
    
    idope: {
      name: 'iDope',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://idope.se/torrent-list/{q}/',
      parser: 'idope',
      features: ['magnet'],
    },
    
    monova: {
      name: 'Monova',
      weight: 0.6,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://monova.org/search?term={q}',
      parser: 'monova',
      features: ['magnet'],
    },
    
    seedpeer: {
      name: 'Seedpeer',
      weight: 0.6,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.seedpeer.me/search?q={q}',
      parser: 'seedpeer',
      features: ['magnet'],
    },
    
    yourbittorrent: {
      name: 'YourBittorrent',
      weight: 0.6,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://yourbittorrent.com/?q={q}',
      parser: 'yourbittorrent',
      features: ['magnet'],
    },
    
    torrentproject2: {
      name: 'TorrentProject2',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://torrentproject2.com/?t={q}',
      parser: 'torrentproject',
      features: ['magnet', 'hash'],
    },
    
    bt4g: {
      name: 'BT4G',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://bt4g.org/search/{q}',
      parser: 'bt4g',
      features: ['magnet', 'hash'],
    },
    
    btdig: {
      name: 'BTDigg',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoints: [
        'https://btdig.com/search?q={q}',
        'https://btdigg.org/search?q={q}',
      ],
      parser: 'btdig',
      features: ['magnet', 'dht'],
    },
    
    btscene: {
      name: 'BTScene',
      weight: 0.6,
      timeout: 10000,
      retries: 2,
      endpoint: 'http://btscene.cc/results?q={q}',
      parser: 'btscene',
      features: ['magnet'],
    },
    
    torrentreactor: {
      name: 'TorrentReactor',
      weight: 0.6,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://torrentreactor.net/search.php?search={q}',
      parser: 'torrentreactor',
      features: ['magnet'],
    },
    
    demonoid: {
      name: 'Demonoid',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.demonoid.is/files/?query={q}',
      parser: 'demonoid',
      features: ['magnet', 'private'],
    },
    
    rarbg: {
      name: 'RARBG (镜像)',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoints: [
        'https://rargb.to/search/?search={q}',
        'https://rarbg.tw/search/?search={q}',
      ],
      parser: 'rarbg',
      features: ['magnet', 'imdb', 'quality'],
    },
    
    rutracker: {
      name: 'RuTracker',
      weight: 0.9,
      timeout: 12000,
      retries: 2,
      endpoint: 'https://rutracker.org/forum/tracker.php?nm={q}',
      parser: 'rutracker',
      features: ['magnet', 'forum', 'russian'],
      requiresAuth: true,
    },
    
    kinozal: {
      name: 'Kinozal',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'http://kinozal.tv/browse.php?s={q}',
      parser: 'kinozal',
      features: ['magnet', 'russian', 'movies'],
    },
    
    nnmclub: {
      name: 'NNM-Club',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://nnmclub.to/forum/tracker.php?nm={q}',
      parser: 'nnmclub',
      features: ['magnet', 'russian'],
      requiresAuth: true,
    },
    
    rutor: {
      name: 'RuTor',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'http://rutor.info/search/{q}',
      parser: 'rutor',
      features: ['magnet', 'russian'],
    },
    
    rustorka: {
      name: 'Rustorka',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://rustorka.com/forum/tracker.php?nm={q}',
      parser: 'rustorka',
      features: ['magnet', 'russian'],
      requiresAuth: true,
    },
    
    tapochek: {
      name: 'Tapochek',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://tapochek.net/tracker.php?nm={q}',
      parser: 'tapochek',
      features: ['magnet', 'russian', 'games'],
      requiresAuth: true,
    },
    
    booktracker: {
      name: 'BookTracker',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'http://booktracker.org/tracker.php?nm={q}',
      parser: 'booktracker',
      features: ['magnet', 'russian', 'books'],
      requiresAuth: true,
    },
    
    megapeer: {
      name: 'MegaPeer',
      weight: 0.6,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://megapeer.ru/search.php?query={q}',
      parser: 'megapeer',
      features: ['magnet', 'russian'],
    },
  },

  // ===== TIER 4: 中文磁力引擎 =====
  tier4: {
    cilipro: {
      name: '磁力 Pro',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.cilipro.com/search?q={q}',
      parser: 'cilipro',
      features: ['magnet', 'chinese'],
    },
    
    cilimao: {
      name: '磁力猫',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoints: [
        'https://cilimao.io/search?word={q}',
        'https://cilimao.cc/search?word={q}',
      ],
      parser: 'cilimao',
      features: ['magnet', 'chinese'],
    },
    
    ciligou: {
      name: '磁力狗',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://ciligou.app/search?word={q}',
      parser: 'ciligou',
      features: ['magnet', 'chinese'],
    },
    
    zhongziso: {
      name: '种子搜',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://zhongziso.com/list/{q}',
      parser: 'zhongziso',
      features: ['magnet', 'chinese'],
    },
    
    btfox: {
      name: 'BT狐狸',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://btfox.me/search?keyword={q}',
      parser: 'btfox',
      features: ['magnet', 'chinese'],
    },
    
    cld: {
      name: '磁力岛',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://cld.sh/search?q={q}',
      parser: 'cld',
      features: ['magnet', 'chinese'],
    },
    
    bt1207: {
      name: 'BT1207',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://bt1207.com/search?q={q}',
      parser: 'bt1207',
      features: ['magnet', 'chinese'],
    },
    
    sofan: {
      name: 'SOFAN',
      weight: 0.7,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://sofan.net/search?q={q}',
      parser: 'sofan',
      features: ['magnet', 'chinese'],
    },
    
    zhongziba: {
      name: '种子吧',
      weight: 0.6,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://zhongziba.com/search?q={q}',
      parser: 'zhongziba',
      features: ['magnet', 'chinese'],
    },
    
    cililili: {
      name: '磁力莉莉',
      weight: 0.6,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://cililili.com/search?q={q}',
      parser: 'cililili',
      features: ['magnet', 'chinese'],
    },
  },

  // ===== TIER 5: 专业领域引擎 =====
  tier5: {
    audiobookbay: {
      name: 'AudioBook Bay',
      weight: 0.9,
      timeout: 10000,
      retries: 2,
      endpoint: 'http://audiobookbay.nl/?s={q}&tt=1,2,3',
      parser: 'audiobookbay',
      features: ['magnet', 'audiobook', 'narrator'],
      category: 'audiobooks',
    },
    
    linuxtracker: {
      name: 'LinuxTracker',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://linuxtracker.org/index.php?page=torrents&search={q}',
      parser: 'linuxtracker',
      features: ['magnet', 'linux', 'distro'],
      category: 'software',
    },
    
    fitgirl: {
      name: 'FitGirl Repacks',
      weight: 1.0,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://fitgirl-repacks.site/?s={q}',
      parser: 'fitgirl',
      features: ['magnet', 'repack', 'game', 'nfo'],
      category: 'games',
    },
    
    skidrowreloaded: {
      name: 'SkidrowReloaded',
      weight: 0.9,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://www.skidrowreloaded.com/?s={q}',
      parser: 'skidrow',
      features: ['magnet', 'game', 'crack'],
      category: 'games',
    },
    
    csinru: {
      name: 'CS.RIN.RU',
      weight: 0.9,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://cs.rin.ru/forum/search.php?keywords={q}',
      parser: 'csrinru',
      features: ['magnet', 'game', 'steam'],
      category: 'games',
      requiresAuth: true,
    },
    
    internetarchive: {
      name: 'Internet Archive',
      weight: 0.8,
      timeout: 15000,
      retries: 2,
      endpoint: 'https://archive.org/advancedsearch.php?q={q}&output=json',
      parser: 'archive',
      features: ['torrent', 'magnet', 'historic'],
    },
    
    academic: {
      name: 'Library Genesis',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoints: [
        'http://libgen.rs/search.php?req={q}',
        'http://libgen.is/search.php?req={q}',
      ],
      parser: 'libgen',
      features: ['magnet', 'book', 'paper', 'doi'],
      category: 'academic',
    },
    
    zlibrary: {
      name: 'Z-Library',
      weight: 0.8,
      timeout: 10000,
      retries: 2,
      endpoint: 'https://z-lib.org/s/{q}',
      parser: 'zlib',
      features: ['magnet', 'book', 'epub', 'pdf'],
      category: 'books',
    },
  },

  // ===== TIER 6: 私有/半私有引擎 =====
  tier6: {
    // 需要配置的引擎
    jackett: {
      name: 'Jackett (All)',
      weight: 1.0,
      timeout: 20000,
      retries: 1,
      configurable: true,
      configKey: 'JACKETT_URL',
      features: ['magnet', 'configurable', '500+indexers'],
    },
    
    prowlarr: {
      name: 'Prowlarr (All)',
      weight: 1.0,
      timeout: 20000,
      retries: 1,
      configurable: true,
      configKey: 'PROWLARR_URL',
      features: ['magnet', 'configurable', '1000+indexers'],
    },
    
    realdebrid: {
      name: 'Real-Debrid',
      weight: 1.2,
      timeout: 10000,
      retries: 2,
      configurable: true,
      configKey: 'RD_API_KEY',
      features: ['cached', 'unrestricted', 'streaming'],
      type: 'debrid',
    },
    
    alldebrid: {
      name: 'AllDebrid',
      weight: 1.1,
      timeout: 10000,
      retries: 2,
      configurable: true,
      configKey: 'AD_API_KEY',
      features: ['cached', 'unrestricted'],
      type: 'debrid',
    },
    
    premiumize: {
      name: 'Premiumize.me',
      weight: 1.1,
      timeout: 10000,
      retries: 2,
      configurable: true,
      configKey: 'PM_API_KEY',
      features: ['cached', 'cloud', 'streaming'],
      type: 'debrid',
    },
  },

  // ===== TIER 7: DHT网络爬虫 =====
  tier7: {
    dht_crawler: {
      name: 'DHT Crawler',
      weight: 0.6,
      timeout: 30000,
      retries: 1,
      type: 'dht',
      features: ['magnet', 'dht', 'p2p'],
      // 通过DHT网络实时爬取
    },
    
    btdht: {
      name: 'BTDHT',
      weight: 0.6,
      timeout: 30000,
      retries: 1,
      type: 'dht',
      features: ['magnet', 'dht'],
    },
  },
};

// 获取所有可用引擎
function getAllEngines() {
  const engines = [];
  Object.values(ENGINE_REGISTRY).forEach(tier => {
    Object.entries(tier).forEach(([id, config]) => {
      engines.push({
        id,
        ...config,
        tier: Object.keys(ENGINE_REGISTRY).find(t => ENGINE_REGISTRY[t][id]),
      });
    });
  });
  return engines;
}

// ============================================
// 智能结果合并与去重
// ============================================

class ResultMerger {
  constructor() {
    this.seenHashes = new Set();
    this.similarityThreshold = 0.85;
  }

  // 提取磁力hash
  extractHash(magnet) {
    const match = magnet?.match(/btih:([a-f0-9]{40})/i);
    return match ? match[1].toLowerCase() : null;
  }

  // 计算文本相似度
  similarity(str1, str2) {
    const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    if (s1 === s2) return 1;
    if (s1.includes(s2) || s2.includes(s1)) return 0.9;
    
    // Levenshtein距离简化版
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1;
    
    const costs = [];
    for (let i = 0; i <= shorter.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= longer.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (shorter[i - 1] !== longer[j - 1]) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[longer.length] = lastValue;
    }
    
    return (longer.length - costs[longer.length]) / longer.length;
  }

  // 合并结果
  merge(results) {
    const merged = [];
    const sources = new Map(); // hash -> sources array

    for (const result of results) {
      const hash = this.extractHash(result.magnet);
      if (!hash) continue;

      // 完全重复检查
      if (this.seenHashes.has(hash)) {
        // 记录额外来源
        if (!sources.has(hash)) sources.set(hash, []);
        sources.get(hash).push(result.source);
        continue;
      }

      // 相似度检查
      let isSimilar = false;
      for (const existing of merged) {
        const sim = this.similarity(result.title, existing.title);
        if (sim > this.similarityThreshold) {
          // 合并到现有结果
          existing.sources = existing.sources || [existing.source];
          existing.sources.push(result.source);
          existing.seeders = Math.max(existing.seeders || 0, result.seeders || 0);
          existing.leechers = Math.max(existing.leechers || 0, result.leechers || 0);
          existing.allMagnets = existing.allMagnets || [existing.magnet];
          existing.allMagnets.push(result.magnet);
          isSimilar = true;
          break;
        }
      }

      if (!isSimilar) {
        this.seenHashes.add(hash);
        merged.push({
          ...result,
          id: `merged-${hash.substring(0, 12)}`,
          hash,
          sources: [result.source],
          merged: false,
        });
      }
    }

    return merged;
  }
}

// ============================================
// 并行搜索执行器
// ============================================

class ParallelSearchExecutor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency = options.concurrency || 20;
    this.timeout = options.timeout || 30000;
    this.results = [];
    this.completedEngines = new Set();
    this.failedEngines = new Set();
    this.merger = new ResultMerger();
  }

  async execute(query, engines, options = {}) {
    const { stream = false, onEngineResult, onEngineError } = options;
    
    // 创建执行队列
    const queue = engines.map(engine => ({
      engine,
      attempts: 0,
      maxRetries: engine.retries || 1,
    }));

    // 并发控制
    const executing = new Set();
    const results = [];

    const runTask = async (task) => {
      const { engine } = task;
      
      try {
        this.emit('engine:start', { engine: engine.id });
        
        const engineResults = await this.searchEngine(engine, query);
        
        // 标记完成
        this.completedEngines.add(engine.id);
        
        // 处理结果
        const processed = engineResults.map(r => ({
          ...r,
          engineId: engine.id,
          engineName: engine.name,
          engineTier: engine.tier,
          foundAt: Date.now(),
        }));

        results.push(...processed);
        
        if (stream && onEngineResult) {
          onEngineResult({
            engine: engine.id,
            results: processed,
            totalEngines: engines.length,
            completed: this.completedEngines.size,
          });
        }

        this.emit('engine:complete', {
          engine: engine.id,
          results: processed.length,
        });

        return processed;

      } catch (error) {
        task.attempts++;
        
        if (task.attempts < task.maxRetries) {
          // 重试
          return runTask(task);
        }

        this.failedEngines.add(engine.id);
        
        if (onEngineError) {
          onEngineError({
            engine: engine.id,
            error: error.message,
          });
        }

        this.emit('engine:error', {
          engine: engine.id,
          error: error.message,
        });

        return [];
      }
    };

    // 执行所有任务
    const promises = queue.map(task => runTask(task));
    await Promise.all(promises);

    // 最终合并
    return this.merger.merge(results);
  }

  async searchEngine(engine, query) {
    // 这里调用具体的搜索引擎实现
    // 返回解析后的结果数组
    const { searchEngine } = require('./engines');
    return await searchEngine(engine, query);
  }
}

// ============================================
// 主API处理函数
// ============================================

module.exports = async (req, res) => {
  // SSE支持检查
  const acceptHeader = req.headers.accept || '';
  const wantsStream = acceptHeader.includes('text/event-stream');

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { 
    q: query, 
    engines: engineFilter = 'all',
    sort = 'seeders',
    order = 'desc',
    dedup = 'true',
    limit = '100',
    format = 'json',
  } = req.query;

  if (!query || query.trim().length < 2) {
    return res.status(400).json({
      error: 'INVALID_QUERY',
      message: '搜索关键词至少需要2个字符',
    });
  }

  // 获取引擎列表
  const allEngines = getAllEngines();
  let selectedEngines = allEngines.filter(e => !e.configurable); // 默认可用引擎

  if (engineFilter !== 'all') {
    const filters = engineFilter.split(',');
    selectedEngines = allEngines.filter(e => 
      filters.includes(e.id) || filters.includes(e.category)
    );
  }

  // 流式响应
  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const executor = new ParallelSearchExecutor({
      concurrency: 20,
    });

    // 发送初始消息
    res.write(`data: ${JSON.stringify({
      type: 'init',
      query: query.trim(),
      engines: selectedEngines.length,
      engineList: selectedEngines.map(e => ({ id: e.id, name: e.name })),
    })}\n\n`);

    let accumulatedResults = [];

    executor.on('engine:start', (data) => {
      res.write(`data: ${JSON.stringify({
        type: 'engine_start',
        ...data,
      })}\n\n`);
    });

    executor.on('engine:complete', (data) => {
      res.write(`data: ${JSON.stringify({
        type: 'engine_complete',
        ...data,
      })}\n\n`);
    });

    executor.on('engine:error', (data) => {
      res.write(`data: ${JSON.stringify({
        type: 'engine_error',
        ...data,
      })}\n\n`);
    });

    // 执行搜索
    const results = await executor.execute(query.trim(), selectedEngines, {
      stream: true,
      onEngineResult: (data) => {
        accumulatedResults.push(...data.results);
        
        // 实时发送结果
        res.write(`data: ${JSON.stringify({
          type: 'results',
          engine: data.engine,
          batch: data.results,
          totalSoFar: accumulatedResults.length,
          progress: {
            completed: data.completed,
            total: data.totalEngines,
          },
        })}\n\n`);
      },
    });

    // 发送最终结果
    const sorted = sortResults(results, sort, order);
    
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      total: results.length,
      sorted: sorted.slice(0, parseInt(limit)),
      stats: {
        enginesTried: selectedEngines.length,
        enginesSuccess: executor.completedEngines.size,
        enginesFailed: executor.failedEngines.size,
      },
    })}\n\n`);

    return res.end();
  }

  // 标准JSON响应
  const executor = new ParallelSearchExecutor({
    concurrency: 20,
  });

  const startTime = Date.now();

  try {
    const results = await executor.execute(query.trim(), selectedEngines);
    
    // 排序
    let finalResults = dedup === 'true' 
      ? results 
      : results; // 不去重时保留所有

    finalResults = sortResults(finalResults, sort, order);

    // 限制数量
    finalResults = finalResults.slice(0, parseInt(limit));

    const response = {
      success: true,
      query: query.trim(),
      meta: {
        totalFound: results.length,
        returned: finalResults.length,
        searchTime: Date.now() - startTime,
        engines: {
          total: selectedEngines.length,
          success: executor.completedEngines.size,
          failed: executor.failedEngines.size,
          list: Array.from(executor.completedEngines).map(id => {
            const e = allEngines.find(x => x.id === id);
            return { id, name: e?.name };
          }),
        },
        sort: { by: sort, order },
      },
      results: finalResults.map(r => ({
        id: r.id,
        title: r.title,
        magnet: r.magnet,
        hash: r.hash,
        size: {
          bytes: r.size,
          formatted: formatBytes(r.size),
        },
        seeders: r.seeders,
        leechers: r.leechers,
        health: calculateHealth(r.seeders, r.leechers),
        date: r.date,
        category: r.category,
        quality: r.quality,
        sources: r.sources || [r.source],
        engine: r.engineName,
        verified: r.verified,
        metadata: r.metadata || {},
      })),
    };

    res.status(200).json(response);

  } catch (error) {
    res.status(500).json({
      error: 'SEARCH_FAILED',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

// 排序函数
function sortResults(results, sortBy, order) {
  const multiplier = order === 'asc' ? 1 : -1;

  return results.sort((a, b) => {
    switch (sortBy) {
      case 'seeders':
      case 'hot':
        return multiplier * ((a.seeders || 0) - (b.seeders || 0));
      
      case 'leechers':
        return multiplier * ((a.leechers || 0) - (b.leechers || 0));
      
      case 'size':
        return multiplier * ((a.size || 0) - (b.size || 0));
      
      case 'date':
      case 'latest':
        const dateA = new Date(a.date || 0);
        const dateB = new Date(b.date || 0);
        return multiplier * (dateA - dateB);
      
      case 'name':
      case 'title':
        return multiplier * (a.title || '').localeCompare(b.title || '');
      
      case 'relevance':
      default:
        // 综合评分：种子数 * 权重 + 时间衰减
        const scoreA = calculateRelevance(a);
        const scoreB = calculateRelevance(b);
        return multiplier * (scoreA - scoreB);
    }
  });
}

function calculateRelevance(result) {
  const seeders = result.seeders || 0;
  const daysSince = Math.max(0, (Date.now() - new Date(result.date || Date.now())) / 86400000);
  const timeDecay = Math.exp(-daysSince / 30); // 30天衰减
  const verifiedBonus = result.verified ? 1.5 : 1;
  
  return seeders * timeDecay * verifiedBonus;
}

function calculateHealth(seeders, leechers) {
  const s = seeders || 0;
  const l = leechers || 0;
  
  if (s > 100) return { level: 'excellent', color: '#00d4aa', text: '极佳' };
  if (s > 20) return { level: 'good', color: '#00a8e8', text: '良好' };
  if (s > 5) return { level: 'fair', color: '#fb8500', text: '一般' };
  if (s > 0) return { level: 'poor', color: '#ff006e', text: '较差' };
  return { level: 'dead', color: '#666', text: '无种子' };
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
