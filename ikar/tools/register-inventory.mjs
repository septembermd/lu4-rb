#!/usr/bin/env node
// Explicit one-shot inventory registration. Never sends credentials to the server.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [configFile, inventoryFile, ...flags] = process.argv.slice(2);
if (!configFile || !inventoryFile || flags.some(x => x !== '--check')) {
  console.error('Usage: node ikar/tools/register-inventory.mjs ikar/scout.local.json ikar/inventory.local.json [--check]');
  process.exitCode = 2;
} else {
  try {
    const config = JSON.parse(await readFile(resolve(configFile), 'utf8'));
    const inventory = JSON.parse(await readFile(resolve(inventoryFile), 'utf8'));
    if (!/^https:\/\//i.test(config.apiUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(config.apiUrl))
      throw Error('apiUrl must be HTTPS (or localhost HTTP)');
    const api = new URL(config.apiUrl);
    if (api.username || api.password || api.search || api.hash) throw Error('Invalid API URL');
    if (typeof config.agentToken !== 'string' || !config.agentToken.trim() || config.agentToken === 'REPLACE_LOCALLY')
      throw Error('Configure agentToken first');
    if (!Array.isArray(inventory.accounts) || inventory.accounts.length === 0 || inventory.accounts.length > 100)
      throw Error('Expected 1-100 accounts');
    const keys = new Set();
    for (const a of inventory.accounts) {
      if (typeof a.key !== 'string' || !a.key.trim() || a.key.length > 128 || keys.has(a.key)) throw Error('Invalid/duplicate account key');
      keys.add(a.key);
      if (typeof a.label !== 'string' || !a.label.trim() || a.label.length > 128) throw Error('Invalid account label');
      if (!Array.isArray(a.characters) || a.characters.length > 64) throw Error('Invalid characters');
      const slots = new Set();
      for (const c of a.characters) {
        if (!Number.isInteger(c.slot) || c.slot < 0 || c.slot > 63 || slots.has(c.slot)
          || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 128)
          throw Error('Invalid or duplicate character slot');
        slots.add(c.slot);
        if (Object.keys(c).some(k => !['slot','name'].includes(k))) throw Error('Character entry must contain only slot and name');
      }
      if (Object.keys(a).some(k => !['key','label','characters'].includes(k))) throw Error('Account entry must contain only key, label and characters');
    }
    if (Object.keys(inventory).some(k => k !== 'accounts')) throw Error('Inventory root must only contain accounts');
    const count = inventory.accounts.reduce((sum,a)=>sum+a.characters.length,0);
    console.log(`Validated ${inventory.accounts.length} accounts / ${count} characters.`);
    if (flags.includes('--check')) {
      console.log('Dry run: no data sent. WARNING: inventory endpoint disables omitted accounts and characters.');
    } else {
      const endpoint = new URL('/api/agent/v1/scouts/inventory',api);
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(),15000);
      try {
        const response = await fetch(endpoint,{
          method:'POST',
          headers:{authorization:`Bearer ${config.agentToken}`,'content-type':'application/json'},
          body:JSON.stringify(inventory),
          signal:controller.signal,
          redirect:'error'
        });
        if (!response.ok) throw Error(`API returned HTTP ${response.status}: inventory not confirmed`);
        const payload = await response.json();
        if (payload.ok !== true) throw Error('Unexpected inventory confirmation');
        console.log('Inventory accepted by API.');
      } finally { clearTimeout(timer); }
    }
  } catch (error) {
    console.error('Inventory registration failed:',error.message);
    process.exitCode = 1;
  }
}
