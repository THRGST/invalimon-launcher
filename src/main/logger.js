// Log a archivo (con rotacion) + bus de eventos hacia la UI.
const fs = require('fs');
const path = require('path');

class Logger {
  constructor(logsDir, onEvent) {
    this.logsDir = logsDir;
    this.onEvent = onEvent || (() => {});
    this.file = path.join(logsDir, 'launcher.log');
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      this.rotateIfNeeded();
    } catch (e) {
      // sin logs a archivo no pasa nada grave
    }
  }

  rotateIfNeeded() {
    try {
      const st = fs.statSync(this.file);
      if (st.size > 5 * 1024 * 1024) {
        fs.renameSync(this.file, path.join(this.logsDir, 'launcher.old.log'));
      }
    } catch (e) { /* no existe todavia */ }
  }

  write(type, text) {
    const line = `[${new Date().toISOString()}] [${type}] ${text}`;
    try { fs.appendFileSync(this.file, line + '\n'); } catch (e) {}
    this.onEvent({ type, text });
  }

  info(text) { this.write('INFO', text); }
  warn(text) { this.write('WARN', text); }
  error(text) { this.write('ERROR', text); }
  // electron-updater es muy verboso y pide .debug(): va solo al archivo, no a la UI
  debug(text) {
    try { fs.appendFileSync(this.file, `[${new Date().toISOString()}] [DEBUG] ${text}\n`); } catch (e) {}
  }
}

module.exports = { Logger };
