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
  console.log('Socket connected, sending profiler command...');

  // Send the command to start profiling for 50 ticks (shorter for faster feedback)
  await api.console('Game.profiler.profile(50)');
  console.log('Command sent: Game.profiler.profile(50)');

  // Listen for the report
  console.log('Waiting for profiler report (approx 2-3 mins)...');
  
  api.socket.subscribe('console', (event) => {
    const { data } = event;
    if (data.messages) {
      if (data.messages.log) {
        data.messages.log.forEach(log => {
          // Check if this looks like a profiler report
          if (log.includes('Avg')) { 
             console.log(`[REPORT]\n${log}`);
             process.exit(0); // Exit after getting the report
          } else {
             console.log(`[LOG] ${log}`);
          }
        });
      }
    }
  });
}

run().catch(console.error);