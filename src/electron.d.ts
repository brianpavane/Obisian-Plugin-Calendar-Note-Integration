/**
 * Minimal type declarations for the Electron APIs used by this plugin.
 *
 * Electron is provided at runtime by Obsidian's desktop environment and is
 * listed as an external module in esbuild.config.mjs (not bundled). These
 * declarations exist only to satisfy the TypeScript compiler during the
 * `tsc -noEmit` type-check step — no Electron package is installed.
 */
declare module "electron" {
  /**
   * Electron safeStorage — delegates encryption to the OS credential store
   * (macOS Keychain, Windows DPAPI, Linux Secret Service / kwallet).
   */
  const safeStorage: {
    /** Returns true when OS-level encryption is available. */
    isEncryptionAvailable(): boolean;
    /** Encrypt a plaintext string and return the ciphertext as a Buffer. */
    encryptString(plaintext: string): Buffer;
    /** Decrypt a Buffer produced by encryptString and return the plaintext. */
    decryptString(encrypted: Buffer): string;
  };

  /**
   * Electron shell — exposes OS-level actions such as opening URLs in the
   * default browser.
   */
  const shell: {
    /** Open a URL in the user's default browser. */
    openExternal(url: string, options?: Record<string, unknown>): Promise<void>;
  };
}
