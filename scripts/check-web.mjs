// web/index.html 의 <script type="text/babel"> 블록을 추출해 JSX 문법을 검사한다.
// 사용: node scripts/check-web.mjs  (저장소 루트에서)
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const html = readFileSync('web/index.html', 'utf8');
const m = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: babel script block not found'); process.exit(1); }
writeFileSync('.tmp-app.jsx', m[1]);
let failed = false;
try {
  execSync('npx --yes esbuild .tmp-app.jsx --loader:.jsx=jsx --outfile=.tmp-app.out.js --log-level=error', { stdio: 'inherit' });
  console.log('OK: web/index.html JSX syntax valid');
} catch (e) {
  failed = true;
} finally {
  rmSync('.tmp-app.jsx', { force: true });
  rmSync('.tmp-app.out.js', { force: true });
}
if (failed) process.exit(1);
