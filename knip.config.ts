import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'server/index.ts',
    'client/src/main.tsx',
    'shared/schema.ts',
    'shared/tierConfig.ts',
  ],
  project: [
    'server/**/*.ts',
    'client/src/**/*.{ts,tsx}',
    'shared/**/*.ts',
  ],
  ignore: [
    'server/services/__pycache__/**',
    'server/services/segment_service.py',
    '**/*.test.ts',
    '**/*.spec.ts',
  ],
  ignoreDependencies: [
    // Runtime-loaded deps that knip can't trace statically
    'bcryptjs',
    'connect-pg-simple',
    'passport',
    'passport-local',
    'express-session',
    'multer',
    'form-data',
  ],
};

export default config;
