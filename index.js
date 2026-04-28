#!/usr/bin/env node

import('./discord-bot/*.js').catch((error) => {
  console.error('[launcher] Failed to start discord-bot/*.js');
  console.error(error);
  process.exit(1);
});
