const http = require('http');

// 安全拦截：在 Node 原始 HTTP 阶段阻断 TRACE 与 TRACK 方法，防止 undici 构造 Request 崩溃抛 500
const originalCreateServer = http.createServer;
http.createServer = function (options, requestListener) {
  const listener = typeof options === 'function' ? options : requestListener;
  const opt = typeof options === 'function' ? {} : options;
  const wrappedListener = (req, res) => {
    if (req.method === 'TRACE' || req.method === 'TRACK') {
      res.writeHead(405, {
        'Content-Type': 'text/plain',
        'Allow': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS',
      });
      res.end('Method Not Allowed');
      return;
    }

    // 前置请求体大小防御（413 Payload Too Large）：
    // 在 Node 原生 HTTP 阶段拦截超大请求体，防止进入 Node/Next.js 缓冲区导致内存暴涨 DoS
    const rawCl = req.headers['content-length'];
    const url = req.url || '';
    const isVerify = url.startsWith('/api/verify') || url.startsWith('/verify');
    const isDocUpload = url.startsWith('/api/documents');
    const maxAllowed = isVerify
      ? 155 * 1024 * 1024 // 查验 zip 上限 150MB (+ 5MB 头部缓冲)
      : isDocUpload
        ? 20 * 1024 * 1024 + 64 * 1024 // 档案上传上限 20MB (+ 64KB multipart 边界缓冲)
        : 25 * 1024 * 1024; // 常规接口 25MB 上限

    if (rawCl) {
      const contentLength = parseInt(rawCl, 10);
      if (contentLength > maxAllowed) {
        res.writeHead(413, {
          'Content-Type': 'application/json; charset=utf-8',
          'Connection': 'close',
        });
        res.end(JSON.stringify({ error: 'Payload Too Large: 请求体大小超出系统允许上限' }));
        req.destroy();
        return;
      }
    }

    // 对 chunked 传输编码流进行实时流量累加拦截
    if (!rawCl && req.headers['transfer-encoding'] === 'chunked') {
      let receivedBytes = 0;
      req.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxAllowed) {
          if (!res.headersSent) {
            res.writeHead(413, {
              'Content-Type': 'application/json; charset=utf-8',
              'Connection': 'close',
            });
            res.end(JSON.stringify({ error: 'Payload Too Large: 请求体大小超出系统允许上限' }));
          }
          req.destroy();
        }
      });
    }

    // 捕获不可伪造的底层 TCP 对端 IP，注入内部标头供审计与限流使用
    const rawIp = req.socket?.remoteAddress;
    const cleanSocketIp = rawIp ? (rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp) : '127.0.0.1';
    req.headers['x-socket-ip'] = cleanSocketIp;

    if (listener) listener(req, res);
  };
  return originalCreateServer.call(this, opt, wrappedListener);
};

const fs = require('fs');
const path = require('path');

// 自动载入根目录 .env 环境变量
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

// 载入 Next.js standalone 服务入口
require('../.next/standalone/server.js');
