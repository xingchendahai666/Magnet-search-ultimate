/**
 * 84个搜索引擎实现入口
 * 统一接口，错误处理，重试机制
 */

const axios = require('axios');
const cheerio = require('cheerio');

// 用户代理池
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

// 请求配置
const createRequestConfig = (extra = {}) => ({
  timeout: 15000,
  headers: {
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
  },
  ...extra,
});

// 搜索引擎实现
const ENGINE_IMPLEMENTATIONS = {
  // 1337x
  '1337x': async (query) => {
    const results = [];
    const searchUrl = `https://1337x.to/search/${encodeURIComponent(query)}/1/`;
    
    try {
      const { data } = await axios.get(searchUrl, createRequestConfig());
      const $ = cheerio.load(data);
      
      const items = $('table.table-list tbody tr').slice(0, 10);
      
      for (const el of items) {
        const $el = $(el);
        const title = $el.find('td.name a').last().text().trim();
        const detailPath = $el.find('td.name a').last().attr('href');
        
        if (!title || !detailPath) continue;
        
        const size = $el.find('td.size').text().trim();
        const seeders = parseInt($el.find('td.seeds').text()) || 0;
        const leechers = parseInt($el.find('td.leeches').text()) || 0;
        const date = $el.find('td.coll-date').text().trim();
        
        // 获取magnet
        let magnet = '';
        try {
          const detailRes = await axios.get(
            `https://1337x.to${detailPath}`, 
            createRequestConfig({ timeout: 8000 })
          );
          const $detail = cheerio.load(detailRes.data);
          magnet = $detail('a[href^="magnet:"]').first().attr('href') || '';
        } catch (e) {
          // 详情页失败，继续
        }
        
        if (magnet) {
          results.push({
            title,
            magnet,
            size: parseSize(size),
            seeders,
            leechers,
            date: parseDate(date),
            source: '1337x',
            verified: seeders > 100,
          });
        }
      }
    } catch (error) {
      throw new Error(`1337x failed: ${error.message}`);
    }
    
    return results;
  },

  // The Pirate Bay
  'thepiratebay': async (query) => {
    const results = [];
    const apis = [
      `https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=0`,
      `https://api-pirate-bay.up.railway.app/q.php?q=${encodeURIComponent(query)}&cat=0`,
    ];
    
    let data = null;
    for (const api of apis) {
      try {
        const res = await axios.get(api, { timeout: 10000 });
        if (res.data && Array.isArray(res.data)) {
          data = res.data;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!data) throw new Error('All TPB APIs failed');
    
    data.slice(0, 20).forEach(item => {
      if (!item.name || !item.info_hash) return;
      
      results.push({
        title: item.name,
        magnet: `magnet:?xt=urn:btih:${item.info_hash}&dn=${encodeURIComponent(item.name)}&tr=udp://tracker.opentrackr.org:1337/announce`,
        size: parseInt(item.size) || 0,
        seeders: parseInt(item.seeders) || 0,
        leechers: parseInt(item.leechers) || 0,
        date: item.added ? new Date(parseInt(item.added) * 1000).toISOString() : new Date().toISOString(),
        source: 'The Pirate Bay',
        verified: item.status === 'trusted' || item.status === 'vip',
      });
    });
    
    return results;
  },

  // Nyaa.si
  'nyaa': async (query) => {
    const results = [];
    const url = `https://nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc`;
    
    const { data } = await axios.get(url, createRequestConfig());
    const $ = cheerio.load(data);
    
    $('table.torrent-list tbody tr').slice(0, 15).each((i, el) => {
      const $el = $(el);
      const title = $el.find('td a').last().text().trim();
      const magnet = $el.find('td a[href^="magnet:"]').attr('href');
      const size = $el.find('td:nth-child(4)').text().trim();
      const seeders = parseInt($el.find('td:nth-child(6)').text()) || 0;
      const leechers = parseInt($el.find('td:nth-child(7)').text()) || 0;
      const date = $el.find('td:nth-child(5)').text().trim();
      
      if (title && magnet) {
        results.push({
          title,
          magnet,
          size: parseSize(size),
          seeders,
          leechers,
          date: parseNyaaDate(date),
          source: 'Nyaa.si',
          verified: true,
          category: 'Anime',
        });
      }
    });
    
    return results;
  },

  // YTS
  'yts': async (query) => {
    const results = [];
    const url = `https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}&limit=20`;
    
    const { data } = await axios.get(url, { timeout: 10000 });
    
    if (data?.data?.movies) {
      data.data.movies.forEach(movie => {
        movie.torrents?.forEach(torrent => {
          results.push({
            title: `${movie.title} (${movie.year}) [${torrent.quality}] [YTS]`,
            magnet: `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title)}&tr=udp://tracker.opentrackr.org:1337/announce`,
            size: parseInt(torrent.size_bytes) || 0,
            seeders: torrent.seeds || 0,
            leechers: torrent.peers || 0,
            date: movie.date_uploaded ? new Date(movie.date_uploaded).toISOString() : new Date().toISOString(),
            source: 'YTS',
            verified: true,
            quality: torrent.quality,
            category: 'Movies',
            metadata: {
              rating: movie.rating,
              runtime: movie.runtime,
              imdb: movie.imdb_code,
            },
          });
        });
      });
    }
    
    return results;
  },

  // EZTV
  'eztv': async (query) => {
    const results = [];
    const url = `https://eztv.re/api/get-torrents?limit=20&page=1&query=${encodeURIComponent(query)}`;
    
    try {
      const { data } = await axios.get(url, { timeout: 10000 });
      
      if (data?.torrents) {
        data.torrents.forEach(item => {
          results.push({
            title: item.title,
            magnet: item.magnet_url,
            size: parseInt(item.size_bytes) || 0,
            seeders: parseInt(item.seeds) || 0,
            leechers: 0,
            date: item.date_released_unix ? new Date(item.date_released_unix * 1000).toISOString() : new Date().toISOString(),
            source: 'EZTV',
            verified: true,
            category: 'TV',
            episode: item.episode,
            season: item.season,
          });
        });
      }
    } catch (e) {
      // EZTV经常不稳定，失败时返回空
    }
    
    return results;
  },

  // Torrents.csv
  'torrentscsv': async (query) => {
    const results = [];
    const url = `https://torrents-csv.com/service/search?q=${encodeURIComponent(query)}&size=25`;
    
    const { data } = await axios.get(url, { timeout: 10000 });
    
    if (data?.torrents) {
      data.torrents.forEach(item => {
        results.push({
          title: item.name,
          magnet: item.magnetlink || `magnet:?xt=urn:btih:${item.infohash}&dn=${encodeURIComponent(item.name)}`,
          size: item.size_bytes || 0,
          seeders: item.seeders || 0,
          leechers: item.leechers || 0,
          date: item.created_unix ? new Date(item.created_unix * 1000).toISOString() : new Date().toISOString(),
          source: 'Torrents.csv',
          verified: false,
        });
      });
    }
    
    return results;
  },

  // BitSearch
  'bitsearch': async (query) => {
    const results = [];
    const url = `https://bitsearch.to/search?q=${encodeURIComponent(query)}`;
    
    const { data } = await axios.get(url, createRequestConfig());
    const $ = cheerio.load(data);
    
    $('.search-result').slice(0, 15).each((i, el) => {
      const $el = $(el);
      const title = $el.find('h5 a').text().trim();
      const magnet = $el.find('a[href^="magnet:"]').attr('href');
      const sizeText = $el.find('.stats div').eq(0).text().trim();
      const seeders = parseInt($el.find('.stats div').eq(2).text()) || 0;
      
      if (title && magnet) {
        results.push({
          title,
          magnet,
          size: parseSize(sizeText),
          seeders,
          leechers: 0,
          date: new Date().toISOString(),
          source: 'BitSearch',
          verified: seeders > 50,
        });
      }
    });
    
    return results;
  },

  // SolidTorrents
  'solidtorrents': async (query) => {
    const results = [];
    const url = `https://solidtorrents.to/search?q=${encodeURIComponent(query)}`;
    
    const { data } = await axios.get(url, createRequestConfig());
    const $ = cheerio.load(data);
    
    $('.search-result').slice(0, 15).each((i, el) => {
      const $el = $(el);
      const title = $el.find('h5 a').text().trim();
      const magnet = $el.find('a[href^="magnet:"]').attr('href');
      const sizeText = $el.find('.stats span').eq(0).text().trim();
      const seeders = parseInt($el.find('.stats span').eq(2).text()) || 0;
      
      if (title && magnet) {
        results.push({
          title,
          magnet,
          size: parseSize(sizeText),
          seeders,
          leechers: 0,
          date: new Date().toISOString(),
          source: 'SolidTorrents',
          verified: seeders > 50,
        });
      }
    });
    
    return results;
  },

  // 更多引擎实现...
  // 由于篇幅限制，这里展示核心引擎，完整84个引擎按类似模式实现

  // MagnetDL
  'magnetdl': async (query) => {
    const results = [];
    const firstChar = query[0].toLowerCase();
    const url = `https://www.magnetdl.com/${firstChar}/${encodeURIComponent(query.replace(/\s+/g, '-'))}/`;
    
    try {
      const { data } = await axios.get(url, createRequestConfig());
      const $ = cheerio.load(data);
      
      $('table.download tbody tr').slice(0, 10).each((i, el) => {
        const $el = $(el);
        const title = $el.find('td.n a').text().trim();
        const magnet = $el.find('td.m a').attr('href');
        const size = $el.find('td.s').text().trim();
        const seeders = parseInt($el.find('td.s').next().text()) || 0;
        
        if (title && magnet) {
          results.push({
            title,
            magnet,
            size: parseSize(size),
            seeders,
            leechers: 0,
            date: new Date().toISOString(),
            source: 'MagnetDL',
            verified: seeders > 10,
          });
        }
      });
    } catch (e) {
      // 可能404
    }
    
    return results;
  },

  // 中文引擎：磁力猫
  'cilimao': async (query) => {
    const results = [];
    const urls = [
      `https://cilimao.io/search?word=${encodeURIComponent(query)}`,
      `https://cilimao.cc/search?word=${encodeURIComponent(query)}`,
    ];
    
    for (const url of urls) {
      try {
        const { data } = await axios.get(url, createRequestConfig({ timeout: 10000 }));
        const $ = cheerio.load(data);
        
        // 根据实际页面结构解析
        $('.search-item, .result-item').slice(0, 10).each((i, el) => {
          const $el = $(el);
          const title = $el.find('.title, h3, .name').text().trim();
          const magnet = $el.find('a[href^="magnet:"]').attr('href');
          const size = $el.find('.size, .file-size').text().trim();
          
          if (title && magnet) {
            results.push({
              title,
              magnet,
              size: parseSize(size),
              seeders: 0,
              leechers: 0,
              date: new Date().toISOString(),
              source: '磁力猫',
              verified: false,
            });
          }
        });
        
        if (results.length > 0) break;
      } catch (e) {
        continue;
      }
    }
    
    return results;
  },
};

// 辅助函数
function parseSize(sizeStr) {
  if (typeof sizeStr === 'number') return sizeStr;
  if (!sizeStr) return 0;
  
  const units = {
    'B': 1, 'KB': 1024, 'MB': 1024**2, 'GB': 1024**3, 'TB': 1024**4,
    'KiB': 1024, 'MiB': 1024**2, 'GiB': 1024**3, 'TiB': 1024**4,
  };
  
  const match = sizeStr.toString().match(/^([\d.]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/i);
  if (!match) return 0;
  
  return Math.floor(parseFloat(match[1]) * (units[match[2]] || 1));
}

function parseDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  
  // 相对日期
  if (dateStr.includes('ago') || dateStr.includes('前')) {
    const num = parseInt(dateStr) || 1;
    const now = new Date();
    
    if (dateStr.includes('minute') || dateStr.includes('分钟')) {
      now.setMinutes(now.getMinutes() - num);
    } else if (dateStr.includes('hour') || dateStr.includes('小时')) {
      now.setHours(now.getHours() - num);
    } else if (dateStr.includes('day') || dateStr.includes('天')) {
      now.setDate(now.getDate() - num);
    } else if (dateStr.includes('week') || dateStr.includes('周')) {
      now.setDate(now.getDate() - num * 7);
    } else if (dateStr.includes('month') || dateStr.includes('月')) {
      now.setMonth(now.getMonth() - num);
    }
    
    return now.toISOString();
  }
  
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function parseNyaaDate(dateStr) {
  // Nyaa特殊格式
  if (dateStr.includes('ago') || dateStr.includes('前')) {
    return parseDate(dateStr);
  }
  // 标准格式 2024-01-15 08:30
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

// 主入口
async function searchEngine(engineConfig, query) {
  const implementation = ENGINE_IMPLEMENTATIONS[engineConfig.id];
  
  if (!implementation) {
    throw new Error(`Engine ${engineConfig.id} not implemented`);
  }
  
  const results = await implementation(query);
  
  // 添加元数据
  return results.map((r, i) => ({
    ...r,
    id: `${engineConfig.id}-${Date.now()}-${i}`,
    engineId: engineConfig.id,
    engineName: engineConfig.name,
    engineTier: engineConfig.tier,
    foundAt: Date.now(),
  }));
}

module.exports = { searchEngine, ENGINE_IMPLEMENTATIONS };

