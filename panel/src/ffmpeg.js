const { spawn } = require('child_process');
const http = require('http');

const processes = new Map();
const NGINX_LIVE = 'rtmp://nginx/live/stream';

let obsActive = false;
let obsStartedAt = null;
let obsHlsReady = false;
let _hlsPollTimer = null;

function buildFallbackArgs(filePath, type) {
  if (type === 'mp4') {
    return [
      '-re', '-stream_loop', '-1', '-i', filePath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '3000k',
      '-c:a', 'aac', '-b:a', '128k',
      '-f', 'flv', NGINX_LIVE
    ];
  }
  return [
    '-re', '-loop', '1', '-i', filePath,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
    '-b:v', '1000k', '-r', '24',
    '-c:a', 'aac', '-b:a', '64k',
    '-f', 'flv', NGINX_LIVE
  ];
}

function _pollHlsForObs() {
  if (!obsActive || obsHlsReady) return;

  const req = http.get({
    host: 'nginx',
    port: 80,
    path: `/hls/stream.m3u8?t=${Date.now()}`,
    agent: false
  }, (res) => {
    res.resume();
    if (res.statusCode >= 200 && res.statusCode < 400) {
      process.stdout.write(`[obs] HLS manifest is ready (HTTP ${res.statusCode})\n`);
      obsHlsReady = true;
      try { require('./routes/status').broadcast(); } catch (e) { process.stdout.write(`[obs] broadcast failed: ${e.message}\n`); }
    } else {
      _hlsPollTimer = setTimeout(_pollHlsForObs, 1000);
    }
  });

  req.on('error', (e) => {
    process.stdout.write(`[obs] HLS poll error: ${e.message}\n`);
    _hlsPollTimer = setTimeout(_pollHlsForObs, 1000);
  });
}

function setObsActive(active) {
  obsActive = active;
  if (active) {
    obsStartedAt = new Date();
    obsHlsReady = false;
    _hlsPollTimer = setTimeout(_pollHlsForObs, 1000);
  } else {
    obsStartedAt = null;
    obsHlsReady = false;
    if (_hlsPollTimer) { clearTimeout(_hlsPollTimer); _hlsPollTimer = null; }
  }
}

function checkHlsReady(name) {
  const entry = processes.get(name);
  if (!entry || entry.hlsReady) return;

  const req = http.get({
    host: 'nginx',
    port: 80,
    path: `/hls/stream.m3u8?t=${Date.now()}`,
    agent: false
  }, (res) => {
    res.resume();
    if (res.statusCode >= 200 && res.statusCode < 400) {
      process.stdout.write(`[ffmpeg:${name}] HLS manifest is ready (HTTP ${res.statusCode})\n`);
      entry.hlsReady = true;
      try { require('./routes/status').broadcast(); } catch (e) { process.stdout.write(`[ffmpeg:${name}] broadcast failed: ${e.message}\n`); }
    } else {
      setTimeout(() => checkHlsReady(name), 1000);
    }
  });

  req.on('error', (e) => {
    process.stdout.write(`[ffmpeg:${name}] HLS poll error: ${e.message}\n`);
    setTimeout(() => checkHlsReady(name), 1000);
  });
}

function start(name, args, { onExit } = {}) {
  stop(name);
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  processes.set(name, { proc, startedAt: new Date(), hlsReady: false });
  checkHlsReady(name);

  proc.stderr.on('data', data => {
    const line = data.toString().trim();
    if (line && !line.startsWith('frame=') && !line.startsWith('size=')) {
      process.stdout.write(`[ffmpeg:${name}] ${line}\n`);
    }
  });

  proc.on('exit', (code, signal) => {
    if (processes.get(name)?.proc === proc) processes.delete(name);
    if (onExit) onExit(code, signal);
  });

  return proc;
}

function stop(name) {
  const entry = processes.get(name);
  if (!entry) return;
  processes.delete(name);
  try {
    entry.proc.kill('SIGTERM');
    setTimeout(() => { try { entry.proc.kill('SIGKILL'); } catch (_) {} }, 5000);
  } catch (_) {}
}

function status() {
  const result = {};
  for (const [name, entry] of processes.entries()) {
    result[name] = { running: true, hlsReady: entry.hlsReady, pid: entry.proc.pid, startedAt: entry.startedAt.toISOString() };
  }
  return result;
}

function obsStatus() {
  return {
    active: obsActive,
    hlsReady: obsHlsReady,
    startedAt: obsStartedAt ? obsStartedAt.toISOString() : null
  };
}

function isRunning(name) { return processes.has(name); }

module.exports = { start, stop, status, isRunning, buildFallbackArgs, setObsActive, obsStatus };
