// src/logger.js
// Global logging toggle. Call initLogger() once at app startup (main.js).
// Tests never call initLogger(), so console.log is unaffected in test runs.

const _origLog = console.log;
let _enabled = false;

/**
 * Install the logging gate. Must be called once at app startup.
 * Logging is disabled by default; call setLoggingEnabled(true) to turn it on.
 */
export function initLogger() {
  console.log = (...args) => {
    if (_enabled) _origLog(...args);
  };
}

export function setLoggingEnabled(enabled) {
  _enabled = Boolean(enabled);
  _origLog(`[logger] logging ${_enabled ? "enabled" : "disabled"}`);
}
