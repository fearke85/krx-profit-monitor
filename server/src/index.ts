import { config } from './config.js';
import { createServer } from './server.js';
import { startSync } from './sync.js';
import { getActiveAddress } from './address.js';

const app = createServer();

app.listen(config.port, () => {
  console.log(`KRX Profit Monitor — backend em http://localhost:${config.port}`);
  const addr = getActiveAddress();
  console.log(
    addr
      ? `Wallet monitorada: ${addr}`
      : 'Nenhuma wallet configurada — defina pelo dashboard.',
  );
  console.log(`Fuso do report: ${config.timezone}`);
  startSync();
});
