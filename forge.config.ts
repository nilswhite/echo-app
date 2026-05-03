import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';

const config: ForgeConfig = {
  rebuildConfig: {
    onlyModules: [],
  },
  packagerConfig: {
    name: 'Echo',
    executableName: 'Echo',
    appBundleId: 'com.christopherwhite.echo',
    asar: {
      unpack: '{**/*.node,**/*.dylib,**/ffmpeg-static/**}',
    },
    icon: 'electron/assets/icon',
    // We ship tsx as a runtime dep and load TS directly via electron/entry.cjs,
    // so do NOT strip the .ts sources from electron/ or server/. Only exclude
    // dev-only files that have no business in the DMG.
    ignore: [
      /^\/\.claude/,
      /^\/\.git/,
      /^\/_docs$/,
      /^\/forge\.config\.ts$/,
      /^\/out\//,
      /^\/tsconfig\.json$/,
    ],
  },
  makers: [
    new MakerDMG({
      format: 'ULFO',
      name: 'Echo',
    }),
  ],
  plugins: [],
};

export default config;
