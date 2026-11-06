/**
 * GHÉP VIDEO — ffmpeg concat (-c copy) + % tiến độ (ffprobe lấy tổng thời lượng, ffmpeg -progress).
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

// Tên file ra: bỏ ký tự cấm, thêm .mp4, trùng thì -2, -3...
function safeName(dir, name) {
  let base = String(name || '').trim().replace(/\.mp4$/i, '');
  if (!base) base = `Muse_${Date.now()}_ghep`;
  base = base.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '-').replace(/^\.+/, '').slice(0, 100) || 'ghep';
  let out = path.join(dir, base + '.mp4');
  for (let k = 2; fs.existsSync(out); k++) out = path.join(dir, `${base}-${k}.mp4`);
  return out;
}

const concatList = files => files.map(p => `file '${p.replace(/'/g, `'\\''`)}'`).join('\n');

const parseDuration = s => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : 0; };

// Đoạn stdout của -progress → % (tối đa 99 tới khi xong); không biết tổng → null
function progressPct(chunk, total) {
  const all = [...String(chunk).matchAll(/out_time_us=(\d+)/g)];
  if (!total || !all.length) return null;
  return Math.min(99, Math.round(Number(all.at(-1)[1]) / 1e6 / total * 100));
}

const duration = (ffprobe, file) => new Promise(r => {
  if (!ffprobe) return r(0);
  execFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], (err, out) => r(err ? 0 : parseDuration(out)));
});

// ponytail: -c copy cần các cảnh cùng codec/độ phân giải (cùng tỉ lệ khung trên Muse là đủ); khác thì phải re-encode.
async function merge({ ffmpeg, ffprobe, files, out, tmpDir, onProgress = () => {} }) {
  let total = 0;
  for (const f of files) total += await duration(ffprobe, f);
  const listFile = path.join(tmpDir, `muse_concat_${Date.now()}.txt`);
  fs.writeFileSync(listFile, concatList(files));
  return new Promise(resolve => {
    const p = spawn(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-progress', 'pipe:1', '-nostats', out]);
    let err = '';
    p.stdout.on('data', d => { const pct = progressPct(d, total); if (pct !== null) onProgress(pct); });
    p.stderr.on('data', d => { err = (err + d).slice(-2000); });
    p.on('error', e => { err = e.message; });
    p.on('close', code => {
      fs.unlink(listFile, () => {});
      if (code !== 0) return resolve({ success: false, error: err.trim().split('\n').slice(-2).join(' ') || `ffmpeg lỗi ${code}` });
      onProgress(100);
      resolve({ success: true, path: out });
    });
  });
}

// NHẠC NỀN — lấy ngẫu nhiên 1 bài trong thư mục, lặp/cắt cho vừa video, lót nhỏ dưới giọng đọc, mờ dần cuối video.
const MUSIC_EXT = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;
const musicFiles = dir => { try { return fs.readdirSync(dir).filter(f => MUSIC_EXT.test(f) && !f.startsWith('.')).map(f => path.join(dir, f)); } catch (e) { return []; } };

// Núm chỉnh: mức nhạc dưới giọng đọc (người dùng chọn 15%, 12/10). Video câm → 80%.
const MUSIC_UNDER_VOICE = 0.15, MUSIC_ALONE = 0.8;
function musicArgs({ video, music, out, secs, hasAudio }) {
  const fade = Math.max(0, secs - 2).toFixed(2);
  const m = `[1:a]volume=${hasAudio ? MUSIC_UNDER_VOICE : MUSIC_ALONE},afade=t=in:d=1,afade=t=out:st=${fade}:d=2`;
  const filter = hasAudio ? `${m}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]` : `${m}[a]`;
  return ['-y', '-i', video, '-stream_loop', '-1', '-i', music, '-filter_complex', filter,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(secs), out];
}

const hasAudioStream = (ffprobe, file) => new Promise(r =>
  execFile(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], (err, out) => r(!err && out.trim() !== '')));

async function addMusic({ ffmpeg, ffprobe, video, music, out }) {
  const secs = await duration(ffprobe, video);
  if (!secs) return { success: false, error: 'Không đọc được thời lượng video' };
  const args = musicArgs({ video, music, out, secs, hasAudio: await hasAudioStream(ffprobe, video) });
  return new Promise(resolve => execFile(ffmpeg, args, { maxBuffer: 1 << 24 }, err =>
    resolve(err ? { success: false, error: String(err.message).trim().split('\n').slice(-2).join(' ') } : { success: true, path: out, music })));
}

module.exports = { safeName, concatList, parseDuration, progressPct, merge, musicFiles, musicArgs, addMusic };
