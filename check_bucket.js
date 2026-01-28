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
  console.log('Checking CPU Bucket...');

  // Use memory path access to get cpu bucket directly if stats are stored
  // But reliable way is to console.log it from code. 
  // Let's try memory reading first. Overmind stores stats in Memory.stats.persistent usually.
  
  // Actually, easiest way is to eval a command that returns the bucket
  const ret = await api.console('Game.cpu.bucket');
  console.log(`Current Bucket: ${JSON.stringify(ret)}`);
  
  // Also check memory stats if available
  const mem = await api.memory.get('stats.cpu');
  console.log('Memory Stats (CPU):', mem.data);

  process.exit(0);
}

run().catch(console.error);