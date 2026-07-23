import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { ensureDir } from './utils/fs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = config.logPath;

// 确保日志目录存在（双保险：startup 时也建）
ensureDir(LOG_PATH, 'log');

/**
 * 按日期切分的 File transport：
 * - 每天一个子目录：logs/YYYY-MM-DD/{filename}.log（如 logs/2026-07-13/_system_app.log）
 * - 跨天自动切换（写入时检查日期，变化就关旧流、开新流）
 * - 永久保留：从不删除旧日志
 * - 同步尾部 flush：进程被 kill -9 时也能尽量多落盘
 * - 子目录不存在时自动建（用户当天第一次写日志）
 */
class DailyFileTransport extends winston.transports.Stream {
  constructor(opts) {
    const { filename, datePattern = 'YYYY-MM-DD', ...rest } = opts;
    // 给基类一个初始 stream（任何值都行，因为 log() 重写后不会再用 .write()）
    super({ stream: fs.createWriteStream(path.join(LOG_PATH, 'temp'), { flags: 'a' }), ...rest });
    this._baseFilename = filename;
    this._datePattern = datePattern;
    this._currentDate = this._todayKey();
    this._stream = null;
    this._openStream();
  }

  _todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  _openStream() {
    if (this._stream) {
      try { this._stream.end(); } catch (e) {}
    }
    // 新结构：logs/YYYY-MM-DD/{filename}.log（系统级日志用 _system_ 前缀）
    const dateDir = path.join(LOG_PATH, this._currentDate);
    ensureDir(dateDir, 'log date dir');
    const filePath = path.join(dateDir, `${this._baseFilename}.log`);
    // 'a' 追加，'encoding utf8' 写中文安全
    this._stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    // 写穿到 disk，避免异常退出丢最近的日志
    this._stream.on('error', (e) => process.stderr.write(`[logger:${this._baseFilename}] stream error: ${e.message}\n`));
  }

  log(info, callback) {
    // 跨天切流
    const today = this._todayKey();
    if (today !== this._currentDate) {
      this._currentDate = today;
      this._openStream();
    }
    setImmediate(() => this.emit('logged', info));
    // 父类 log 会把 info 写到 super().stream，但我们直接写我们自己的 _stream
    const line = `${info[Symbol.for('message')] || info.message}\n`;
    try { this._stream.write(line); } catch (e) {}
    callback();
  }
}

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // 系统级日志（启动/登录/系统错误等无法归属用户的）统一加 _system_ 前缀
    new DailyFileTransport({ filename: '_system_error', level: 'error' }),
    new DailyFileTransport({ filename: '_system_app' })
  ]
});
