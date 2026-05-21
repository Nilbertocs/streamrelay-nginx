const http = require('http');
const dns = require('dns');
const db = require('./db');

let lastStatus = [];
let pollInterval = null;
let resolvedHosts = new Map();

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
    const time = block.match(/<time>(\d+)<\/time>/)?.[1] || '0';
    const bytesOut = block.match(/<bytes_out>(\d+)<\/bytes_out>/)?.[1] || '0';
    const bwOut = block.match(/<bw_out>(\d+)<\/bw_out>/)?.[1] || '0';
    const active = block.includes('<active/>') || block.includes('<active>');

    if (address === '127.0.0.1') continue;

    clients.push({
      address,
      uptime_ms: parseInt(time, 10),
      bytes_out: parseInt(bytesOut, 10),
      bw_out: parseInt(bwOut, 10),
      active
    });
  }

  return clients;
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

function resolveHost(hostname) {
  return new Promise((resolve) => {
    if (!hostname) return resolve([]);
    const cached = resolvedHosts.get(hostname);
    if (cached && cached.ts > Date.now() - 60000) return resolve(cached.ips);

    dns.resolve4(hostname, (err, addresses) => {
      const ips = err ? [] : addresses;
      resolvedHosts.set(hostname, { ips, ts: Date.now() });
      resolve(ips);
    });
  });
}

async function matchDestinations(clients) {
  const streams = db.prepare('SELECT id, name, platform, rtmp_url, stream_key, enabled FROM streams ORDER BY name').all();

  const results = [];

  for (const stream of streams) {
    const base = {
      id: stream.id,
      name: stream.name,
      platform: stream.platform,
      enabled: !!stream.enabled
    };

    if (!stream.enabled) {
      results.push({ ...base, connected: false, uptime_sec: 0, bytes_out: 0, bw_out: 0, error: null });
      continue;
    }

    const hostname = extractHost(stream.rtmp_url);
    const ips = await resolveHost(hostname);

    const matched = clients.find(c => c.address === hostname || ips.includes(c.address));

    if (matched) {
      results.push({
        ...base,
        connected: true,
        uptime_sec: Math.floor(matched.uptime_ms / 1000),
        bytes_out: matched.bytes_out,
        bw_out: matched.bw_out,
        error: null
      });
    } else {
      results.push({ ...base, connected: false, uptime_sec: 0, bytes_out: 0, bw_out: 0, error: null });
    }
  }

  return results;
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
    res.on('end', async () => {
      if (res.statusCode !== 200) return;
      try {
        const clients = parseXml(data);
        const newStatus = await matchDestinations(clients);
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
      bw_out: 0,
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
