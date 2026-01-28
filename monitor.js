const { ScreepsAPI } = require('screeps-api');
const fs = require('fs');

async function run() {
  // Load config from screeps.json
  const config = JSON.parse(fs.readFileSync('screeps.json', 'utf8'));
  
  const api = new ScreepsAPI({
    token: config.main.token,
    protocol: config.main.protocol,
    hostname: config.main.hostname,
    port: config.main.port,
    path: config.main.path
  });

  console.log('Connecting to Screeps API...');
  
  await api.socket.connect();
  console.log('Socket connected!');

  // Subscribe to console events
  api.socket.subscribe('console', (event) => {
    const { data } = event;
    if (data.messages) {
      if (data.messages.log) data.messages.log.forEach(log => console.log(`[LOG] ${log}`));
      if (data.messages.error) data.messages.error.forEach(err => console.error(`[ERROR] ${err}`));
    }
  });

  console.log('Listening for console logs... (Press Ctrl+C to stop)');
}

run().catch(console.error);