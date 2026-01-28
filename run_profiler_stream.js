const { ScreepsAPI } = require('screeps-api');
const fs = require('fs');

async function run() {
  const config = JSON.parse(fs.readFileSync('screeps.json', 'utf8'));
  const api = new ScreepsAPI({
    token: config.main.token,
    protocol: config.main.protocol,
    hostname: config.main.hostname,
    port: config.main.port,
    path: config.main.path
  });

  await api.socket.connect();
  console.log('Socket connected.');

  // Try streaming mode for 20 ticks
  await api.console('Game.profiler.stream(20)');
  console.log('Command sent: Game.profiler.stream(20)');

  api.socket.subscribe('console', (event) => {
    const { data } = event;
    if (data.messages && data.messages.log) {
      data.messages.log.forEach(log => {
        // Just print everything so we don't miss it
        console.log(`[LOG] ${log}`);
      });
    }
  });
}

run().catch(console.error);