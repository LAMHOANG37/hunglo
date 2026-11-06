// Chạy: node engine/merge.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { safeName, concatList, progressPct, parseDuration, musicFiles, addMusic } = require('./merge');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mss-merge-'));
assert.strictEqual(safeName(dir, 'Video Noel'), path.join(dir, 'Video Noel.mp4'));
assert.strictEqual(safeName(dir, '  a/b:c*?.mp4 '), path.join(dir, 'a-b-c--.mp4'));
assert.strictEqual(safeName(dir, '..'), path.join(dir, 'ghep.mp4'));
assert.ok(/^Muse_\d+_ghep\.mp4$/.test(path.basename(safeName(dir, ''))));
fs.writeFileSync(path.join(dir, 'x.mp4'), '');
fs.writeFileSync(path.join(dir, 'x-2.mp4'), '');
assert.strictEqual(safeName(dir, 'x'), path.join(dir, 'x-3.mp4'));

assert.strictEqual(concatList(["/a/it's.mp4", '/b/c.mp4']), "file '/a/it'\\''s.mp4'\nfile '/b/c.mp4'");
assert.strictEqual(parseDuration('12.500000\n'), 12.5);
assert.strictEqual(parseDuration('N/A'), 0);
assert.strictEqual(progressPct('frame=1\nout_time_us=5000000\nprogress=continue\n', 20), 25);
assert.strictEqual(progressPct('out_time_us=99000000\n', 20), 99);
assert.strictEqual(progressPct('out_time_us=1000000\n', 0), null);
assert.strictEqual(progressPct('progress=continue\n', 20), null);

// Nhạc nền: chỉ nhận file nhạc; ghép thật bằng ffmpeg (nếu máy có) → giữ đúng thời lượng video, có tiếng.
const mdir = path.join(dir, 'nhac');
fs.mkdirSync(mdir);
['a.mp3', 'b.M4A', 'ghi chu.txt', '.DS_Store'].forEach(f => fs.writeFileSync(path.join(mdir, f), ''));
assert.deepStrictEqual(musicFiles(mdir).map(f => path.basename(f)).sort(), ['a.mp3', 'b.M4A']);
assert.deepStrictEqual(musicFiles(path.join(dir, 'khong-co')), []);

const bin = n => ['/opt/homebrew/bin/', '/usr/local/bin/'].map(d => d + n).find(p => fs.existsSync(p));
(async () => {
  if (bin('ffmpeg')) {
    const ff = bin('ffmpeg'), probe = bin('ffprobe');
    const v = path.join(dir, 'v.mp4'), mute = path.join(dir, 'mute.mp4'), song = path.join(dir, 'song.m4a');
    execFileSync(ff, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-shortest', v]);
    execFileSync(ff, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=3', mute]);
    execFileSync(ff, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=660:d=1.2', song]); // bài ngắn hơn video → phải lặp
    for (const src of [v, mute]) {
      const out = src.replace('.mp4', '-nhac.mp4');
      const r = await addMusic({ ffmpeg: ff, ffprobe: probe, video: src, music: song, out });
      assert.ok(r.success, r.error);
      const secs = parseDuration(execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
      assert.ok(Math.abs(secs - 3) < 0.3, `thời lượng ${secs}`);
      assert.ok(execFileSync(probe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out]).toString().includes('aac'));
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('merge.test OK');
})().catch(e => { console.error(e); process.exit(1); });
