const http = require('http');

function dockerRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: '/var/run/docker.sock', ...options }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function reloadNginx() {
  try {
    const { data } = await dockerRequest({
      method: 'GET',
      path: '/containers/json?filters=' + encodeURIComponent(JSON.stringify({
        name: ['nginx'],
        status: ['running']
      }))
    });

    const containers = JSON.parse(data);
    if (!containers.length) {
      console.warn('[docker-reload] nginx container not found, skipping reload');
      return false;
    }

    const id = containers[0].Id;
    const result = await dockerRequest({
      method: 'POST',
      path: `/containers/${id}/kill?signal=SIGHUP`
    });

    console.log(`[docker-reload] SIGHUP sent to nginx container ${id.substring(0, 12)}, HTTP ${result.status}`);
    return result.status === 204;
  } catch (e) {
    console.error('[docker-reload] error:', e.message);
    return false;
  }
}

module.exports = { reloadNginx };
