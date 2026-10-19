import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, copyFile, cp, mkdir, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'xiangqi-build-'));
  for (const file of await readdir(new URL('.', import.meta.url)))
    if (/\.(?:js|html|css)$/.test(file) || file === 'package.json')
      await copyFile(new URL(file, import.meta.url), path.join(directory, file));
  await cp(new URL('assets/', import.meta.url), path.join(directory, 'assets'), { recursive: true });
  return directory;
}
const build = (directory, ...args) => execFileSync(process.execPath, ['build.js', ...args], { cwd: directory, stdio: 'pipe' });

test('static rebuilds replace stale output and keep service selection explicit', async () => {
  const directory = await fixture();
  try {
    const originalHtml = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert(!originalHtml.includes('__XIANGQI_ROOM_SERVICE__'));
    build(directory, '--with-service');
    assert.match(await readFile(path.join(directory, 'dist/index.html'), 'utf8'), /__XIANGQI_ROOM_SERVICE__ = true/);
    await writeFile(path.join(directory, 'dist/competition.js'), 'old platform output');
    await writeFile(path.join(directory, 'dist/assets/retired.png'), 'old art');
    build(directory);
    const html = await readFile(path.join(directory, 'dist/index.html'), 'utf8');
    assert.match(html, /__XIANGQI_ROOM_SERVICE__ = false/);
    assert.equal((html.match(/__XIANGQI_ROOM_SERVICE__/g) || []).length, 1);
    assert(html.indexOf('__XIANGQI_ROOM_SERVICE__') < html.indexOf('src="./app.js"'));
    assert.equal(await readFile(path.join(directory, 'index.html'), 'utf8'), originalHtml);
    for (const file of ['competition.js', 'assets/retired.png', 'assets/hero-paper.webp'])
      await assert.rejects(lstat(path.join(directory, 'dist', file)), { code: 'ENOENT' });
    assert.deepEqual(await readFile(path.join(directory, 'dist/app.js')), await readFile(path.join(directory, 'app.js')));
    await writeFile(path.join(directory, 'dist/platform-config.js'), 'post-build platform configuration');
    assert.equal(await readFile(path.join(directory, 'dist/platform-config.js'), 'utf8'), 'post-build platform configuration');
    assert.throws(() => build(directory, '--with-service', '--without-service'), /Choose --with-service/);
    assert.equal(await readFile(path.join(directory, 'dist/platform-config.js'), 'utf8'), 'post-build platform configuration');
    build(directory, '--without-service');
    assert.match(await readFile(path.join(directory, 'dist/index.html'), 'utf8'), /__XIANGQI_ROOM_SERVICE__ = false/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('build refuses a redirected dist and never follows nested output symlinks', async () => {
  const directory = await fixture();
  const external = await mkdtemp(path.join(tmpdir(), 'xiangqi-external-'));
  try {
    await writeFile(path.join(external, 'keep.txt'), 'must survive');
    await symlink(external, path.join(directory, 'dist'), 'junction');
    assert.throws(() => build(directory), /dist must be a real directory/);
    assert.equal(await readFile(path.join(external, 'keep.txt'), 'utf8'), 'must survive');
    await rm(path.join(directory, 'dist'));
    await mkdir(path.join(directory, 'dist'));
    await symlink(external, path.join(directory, 'dist/redirect'), 'junction');
    build(directory);
    assert.equal(await readFile(path.join(external, 'keep.txt'), 'utf8'), 'must survive');
    await assert.rejects(lstat(path.join(directory, 'dist/redirect')), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
