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

  // Try standard profiling again
  await api.console('Game.profiler.profile(10)');
  console.log('Command sent: Game.profiler.profile(10)');

  api.socket.subscribe('console', (event) => {
    const { data } = event;
    if (data.messages && data.messages.log) {
      data.messages.log.forEach(log => {
        console.log(`[LOG] ${log}`);
        // If we see the table, we win
        if (log.includes('calls') && log.includes('time')) {
             console.log("!!! PROFILER REPORT FOUND !!!");
        }
      });
    }
  });
}

run().catch(console.error);