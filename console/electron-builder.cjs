module.exports = {
  appId: "dev.implementation-harness.desktop",
  productName: "Implementation Harness",
  icon: ".desktop/icon.png",
  afterSign: "scripts/notarize.cjs",
  directories: { output: "release" },
  // Next and the PTY helper use real filesystem paths and executable resources.
  asar: false,
  npmRebuild: false, // node-pty 1.1 uses Node-API; its prebuild works in Node and Electron.
  files: [
    "electron/**/*", ".desktop/**/*", ".next/**/*", "public/**/*", "!.next/cache/**/*", "!.next/dev/**/*",
    "next.config.ts", "tsconfig.json", "package.json",
  ],
  extraResources: [{
    from: "..", to: "plugin",
    filter: [".claude-plugin/**/*", "agents/**/*", "commands/**/*", "hooks/**/*", "skills/**/*", "README.md", "LICENSE"],
  }],
  mac: {
    category: "public.app-category.developer-tools", target: ["dmg", "zip"],
    hardenedRuntime: true,
    entitlements: "electron/entitlements.mac.plist",
    entitlementsInherit: "electron/entitlements.mac.plist",
    notarize: false, // The hook below uses credentials already stored in Keychain.
  },
  linux: { category: "Development", target: ["AppImage"] },
  win: { target: ["nsis"] },
};
