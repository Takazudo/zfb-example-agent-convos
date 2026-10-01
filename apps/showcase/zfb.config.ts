import { defineConfig } from '@takazudo/zfb/config';
// Static mock-only build. No SSR adapter, live API, secret, or private client is imported.
export default defineConfig({ wind: false });
