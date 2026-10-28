// Step 1 smoke test: `npm run probe`. Proves the SDK installs and reaches the light server.
import { createLightClient } from '@zcashlabs/zcash.js';
import { config } from './config.js';

const light = await createLightClient(config.endpoint, { network: config.network });
const [tip, server] = await Promise.all([light.getTip(), light.getServerInfo()]);
console.log(JSON.stringify({ network: config.network, endpoint: config.endpoint, tip: tip.height, server }, null, 2));
