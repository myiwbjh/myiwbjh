import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./e2e', timeout:30000, use:{baseURL:'http://127.0.0.1:4173',headless:true}, webServer:{command:'npm run build && python3 -m http.server 4173 --directory dist',url:'http://127.0.0.1:4173',reuseExistingServer:false} });
