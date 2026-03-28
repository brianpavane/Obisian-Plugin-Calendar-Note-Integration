/**
 * @file secureStorage.ts
 * @description Transparent at-rest encryption for sensitive plugin credentials
 * using Electron's `safeStorage` API.
 *
 * ## How it works
 *
 * `safeStorage` delegates to the OS credential store for encryption:
 *   - **macOS** — Keychain
 *   - **Windows** — DPAPI (Data Protection API, user-scoped)
 *   - **Linux** — Secret Service / kwallet; falls back to a basic AES cipher
 *     when no daemon is running (still better than plaintext)
 *
 * Encrypted values are stored as `"enc:<base64>"` so that legacy plaintext
 * values written by older versions of the plugin can be detected and migrated
 * automatically on the next save — no user action required.
 *
 * ## Migration
 *
 * On load, if a stored value does not start with `"enc:"` it is treated as a
 * legacy plaintext value and returned unchanged. On the next call to
 * `saveSettings()`, it will be encrypted and re-saved.
 *
 * ## Important limitations
 *
 * Encrypted values are **bound to the current OS user account**. Tokens
 * encrypted on one machine cannot be decrypted on another. If a user moves
 * their Obsidian vault to a new machine they will need to re-authenticate the
 * plugin. `decrypt()` returns an empty string (rather than throwing) in this
 * case, which causes the plugin to behave as if it has not been authenticated.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { safeStorage } = require("electron") as typeof import("electron");

/** Prefix added to every value encrypted by this module. */
const ENC_PREFIX = "enc:";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the OS credential store is available and encryption can
 * be performed. When `false`, values are stored as plaintext and a console
 * warning is emitted.
 *
 * On Linux, this returns `false` when no Secret Service daemon (e.g.
 * `gnome-keyring`, `kwallet`) is running.
 */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Encrypt `plaintext` for safe storage on disk.
 *
 * Returns an `"enc:<base64>"` string when OS encryption is available, or the
 * original `plaintext` string with a console warning when it is not.
 *
 * Empty strings are passed through unchanged so that uninitialised settings
 * fields are not written as padded ciphertext.
 *
 * @param plaintext Sensitive value to protect (e.g. OAuth token).
 * @returns         An opaque `"enc:<base64>"` string, or `plaintext` unchanged.
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return "";

  if (!isEncryptionAvailable()) {
    console.warn(
      "[gcal-notes] OS encryption is unavailable — sensitive credential is " +
        "being stored as plaintext. Consider running a keyring daemon."
    );
    return plaintext;
  }

  const buf = safeStorage.encryptString(plaintext);
  return ENC_PREFIX + buf.toString("base64");
}

/**
 * Decrypt a value previously produced by {@link encrypt}.
 *
 * Handles both encrypted `"enc:<base64>"` values and legacy plaintext values
 * transparently — the caller does not need to know which format is stored.
 *
 * Returns an empty string on decryption failure (e.g. after moving the vault
 * to a different machine) rather than throwing, so the caller can treat the
 * result as "not authenticated" and prompt the user to re-authenticate.
 *
 * @param stored Encrypted or legacy-plaintext value from plugin storage.
 * @returns      Decrypted plaintext, empty string on failure.
 */
export function decrypt(stored: string): string {
  if (!stored) return "";

  // Legacy plaintext value — return as-is; will be encrypted on next save.
  if (!stored.startsWith(ENC_PREFIX)) return stored;

  try {
    const buf = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
    return safeStorage.decryptString(buf);
  } catch {
    console.error(
      "[gcal-notes] Failed to decrypt a stored credential. This can happen " +
        "when the vault is opened on a different machine or OS user account. " +
        "Please re-authenticate the plugin."
    );
    return "";
  }
}
