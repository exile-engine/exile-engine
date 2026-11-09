import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.EXILE_ENGINE_SMOKE_PORT || 4788);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const name =
      url.pathname === '/' ? 'examples/browser.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(root, name);
    if (
      !file.startsWith(path.resolve(root) + path.sep) ||
      name.split('/').some((part) => part === '..' || part === '.') ||
      !(name.startsWith('examples/') || /^packages\/[^/]+\/(?:dist|snapshot)\//.test(name)) ||
      !mime[path.extname(file)]
    ) {
      response.writeHead(404).end();
      return;
    }
    const bytes = await readFile(file);
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)],
      'Cache-Control': 'no-store',
    });
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Browser smoke test: http://127.0.0.1:${port}`));
