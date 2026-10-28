import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const storageSetting = (process.env.STORAGE ?? 'auto').toLowerCase();

export const config = {
  network: (process.env.NETWORK ?? 'mainnet') as 'testnet' | 'mainnet',
  endpoint: process.env.LIGHTWALLETD_URL ?? 'https://zec.rocks:443',
  // Persistent Node storage needs Linux + flock; memory storage works everywhere.
  storage:
    storageSetting === 'filesystem' || (storageSetting === 'auto' && process.platform === 'linux')
      ? ('filesystem' as const)
      : ('memory' as const),
  dataDir: process.env.DATA_DIR ?? './data',
  port: Number(process.env.PORT ?? 8787),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS ?? 15_000),
  // Built web app to serve from the same origin (hosted demo). Ignored if the folder is missing.
  webDist: process.env.WEB_DIST ?? '../web/dist',
  // Optional public demo wallet, auto-imported on boot. Use a throwaway wallet: its key becomes public.
  demo: process.env.DEMO_UFVK
    ? {
        ufvk: process.env.DEMO_UFVK.trim(),
        label: process.env.DEMO_LABEL ?? 'ZecScope demo wallet',
        birthdayHeight: process.env.DEMO_BIRTHDAY ? Number(process.env.DEMO_BIRTHDAY) : undefined,
      }
    : null,
};
