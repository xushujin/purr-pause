const fs = require('fs');
const path = require('path');

let logDir = '';
let logStream = null;
const MAX_LOG_SIZE = 128 * 1024;
const MAX_LOG_FILES = 5;

function init(userDataPath) {
  logDir = path.join(userDataPath, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  rotateIfNeeded();
  const logFile = path.join(logDir, 'purr-pause.log');
  logStream = fs.createWriteStream(logFile, { flags: 'a' });
}

function rotateIfNeeded() {
  const logFile = path.join(logDir, 'purr-pause.log');
  try {
    if (!fs.existsSync(logFile)) return;
    const stat = fs.statSync(logFile);
    if (stat.size < MAX_LOG_SIZE) return;

    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const older = path.join(logDir, `purr-pause.${i}.log`);
      const newer = path.join(logDir, `purr-pause.${i - 1}.log`);
      if (i === 1) {
        if (fs.existsSync(logFile)) fs.renameSync(logFile, older);
      } else {
        if (fs.existsSync(newer)) fs.renameSync(newer, older);
      }
    }
  } catch (e) {}
}

function formatTime() {
  const now = new Date();
  const offset = 8 * 60;
  const local = new Date(now.getTime() + offset * 60 * 1000);
  return local.toISOString().replace('T', ' ').substring(0, 19);
}

function log(level, msg) {
  const line = `[${formatTime()}] [${level}] ${msg}\n`;
  if (logStream) logStream.write(line);
}

function info(msg) { log('INFO', msg); }
function warn(msg) { log('WARN', msg); }
function error(msg) { log('ERROR', msg); }

function getLogPath() {
  return path.join(logDir, 'purr-pause.log');
}

module.exports = { init, info, warn, error, getLogPath };
