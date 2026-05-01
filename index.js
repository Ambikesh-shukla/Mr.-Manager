#!/usr/bin/env node

import('./bot/index.js').catch((error) => {
  console.error('[launcher] Failed to start bot/*.js');
  console.error(error);
  process.exit(1);
});
