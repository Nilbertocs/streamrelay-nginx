const http = require('http');
const db = require('./db');

let lastStatus = [];
let pollInterval = null;

function parseXml(xml) {
  const clients = [];
  const appMatch = xml.match(/<application>[\s\S]*?<name>live<\/name>([\s\S]*?)<\/application>/);
  if (!appMatch) return clients;

  const streamMatch = appMatch[1].match(/<stream>[\s\S]*?<name>stream<\/name>([\s\S]*?)<\/stream>/);
  if (!streamMatch) return clients;

  const clientBlocks = streamMatch[1].match(/<client>([\s\S]*?)<\/client>/g) || [];

  for (const block of clientBlocks) {
    if (block.includes('<publishing/>') || block.includes('<publishing>')) continue;

    const address = block.match(/<address>(.*?)<\/address>/)?.[1] || '';
    const port = block.match(/<port>(.*?)<\/port>/)?.[1] || '';
    const connected = block.match(/<time>(.*?)<<\/time>/)?.[1] || block.match(/<time>(\d+)<\/time>/)?.[1] || '0';
    const bytesOut = block.match(/<bytes_out>(\d+)<\/bytes_out>/)?.[1] || '0';
    const active = block.includes('<active/>') || block.includes('<active>');
    const flashver = block.match(/<flashver>(.*?)<\/flashver>/)?.[1] || '';

    clients.push({
      address,
      port,
      uptime_ms: parseInt(connected, 10),
      bytes_out: parseInt(bytesOut, 10),
      active,
      flashver
    });
  }

  return clients;
}

function matchDestinations(clients) {
  const streams = db.prepare('SELECT id, name, platform, rtmp_url, stream_key, enabled FROM streams ORDER BY name').all();

  return streams.map(stream => {
    const base = {
      id: stream.id,
      name: stream.name,
      platform: stream.platform,
      enabled: !!stream.enabled
    };

    if (!stream.enabled) {
      return { ...base, connected: false, uptime_sec: 0, bytes_out: 0, error: null };
    }

    const urlHost = extractHost(stream.rtmp_url);
    const matched = clients.find(c => c.address === urlHost);

    if (matched) {
      return {
        ...base,
        connected: true,
        uptime_sec: Math.floor(matched.uptime_ms / 1000),
        bytes_out: matched.bytes_out,
        error: null
      };
    }

    return { ...base, connected: false, uptime_sec: 0, bytes_out: 0, error: null };
  });
}

function extractHost(rtmpUrl) {
  try {
    const cleaned = rtmpUrl.replace(/^rtmps?:\/\//, 'http://');
    const u = new URL(cleaned);
    return u.hostname;
  } catch (_) {
    const m = rtmpUrl.match(/rtmps?:\/\/([^:/]+)/);
    return m ? m[1] : '';
  }
}

function poll() {
  const req = http.get({
    host: 'nginx',
    port: 80,
    path: '/stat',
    agent: false,
    timeout: 4000
  }, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode !== 200) return;
      try {
        const clients = parseXml(data);
        const newStatus = matchDestinations(clients);
        const changed = JSON.stringify(newStatus) !== JSON.stringify(lastStatus);
        lastStatus = newStatus;
        if (changed) {
          try { require('./routes/status').broadcast(); } catch (_) {}
        }
      } catch (e) {
        process.stdout.write(`[dest-monitor] parse error: ${e.message}\n`);
      }
    });
  });

  req.on('error', () => {});
  req.on('timeout', () => { req.destroy(); });
}

function getDestinationStatus() {
  if (lastStatus.length === 0) {
    const streams = db.prepare('SELECT id, name, platform, enabled FROM streams ORDER BY name').all();
    return streams.map(s => ({
      id: s.id,
      name: s.name,
      platform: s.platform,
      enabled: !!s.enabled,
      connected: false,
      uptime_sec: 0,
      bytes_out: 0,
      error: null
    }));
  }
  return lastStatus;
}

function start() {
  if (pollInterval) return;
  poll();
  pollInterval = setInterval(poll, 5000);
}

function stop() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

module.exports = { start, stop, getDestinationStatus };
