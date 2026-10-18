import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('./', import.meta.url)));
function run(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}
const ffmpeg = args => run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-threads', '2', ...args]);
const probe = path => JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]));
ffmpeg(['-i', 'source/key-art-wide.png', '-vf', 'scale=1920:1080:flags=lanczos,setsar=1', '-frames:v', '1', 'promo-landscape-1920x1080.png']);
ffmpeg(['-i', 'source/key-art-square.png', '-vf', 'scale=1440:1440:flags=lanczos,setsar=1', '-frames:v', '1', 'promo-square-1440x1440.png']);
ffmpeg(['-i', 'source/key-art-icon.png', '-vf', 'scale=1024:1024:flags=lanczos,format=rgb24,setsar=1', '-frames:v', '1', 'game-icon-1024x1024.png']);
ffmpeg(['-i', 'source/key-art-icon.png', '-vf', 'scale=512:512:flags=lanczos,format=rgb24,setsar=1', '-frames:v', '1', 'game-icon-512x512.png']);

// Original, quiet pentatonic plucked tones: no external music recording or license.
const rate = 44100, duration = 31.32;
const pcm = new Float32Array(Math.ceil(rate * duration));
const tune = [0, 2, 4, 3, 2, 1, 0, 2, 3, 5, 4, 2, 1, 2, 4, 3];
const frequencies = [293.6648, 329.6276, 369.9944, 440, 493.8833, 587.3295];
for (let note = 0; note < 44; note++) {
  const start = Math.floor((0.4 + note * 0.68) * rate);
  const frequency = frequencies[tune[note % tune.length]];
  for (let index = 0; index < rate * 2.5 && start + index < pcm.length; index++) {
    const t = index / rate;
    const attack = Math.min(1, t / 0.012);
    pcm[start + index] += 0.12 * attack * Math.exp(-2.7 * t) *
      (Math.sin(2 * Math.PI * frequency * t) + 0.3 * Math.sin(4 * Math.PI * frequency * t));
  }
}
const wav = Buffer.alloc(44 + pcm.length * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(pcm.length * 2, 40);
let peak = 0;
for (let index = 0; index < pcm.length; index++) {
  const envelope = Math.min(1, index / rate, Math.max(0, duration - index / rate));
  const sample = pcm[index] * envelope;
  peak = Math.max(peak, Math.abs(sample));
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2);
}
assert.ok(peak > 0.05 && peak < 0.9, `Music peak ${peak}`);
writeFileSync('source/original-pentatonic.wav', wav);

const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Microsoft YaHei,78,&H00F0F8FA,&H00F0F8FA,&H00304B31,&H00000000,-1,0,0,0,100,100,3,0,1,0,0,7,0,0,0,1
Style: Heading,Microsoft YaHei,38,&H00C3DEEF,&H00C3DEEF,&H00304B31,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Body,Microsoft YaHei,25,&H00E5ECE9,&H00E5ECE9,&H00304B31,&H00000000,0,0,0,0,100,100,1,0,1,0,0,7,0,0,0,1
Style: Small,Microsoft YaHei,18,&H00C1D1BF,&H00C1D1BF,&H00304B31,&H00000000,0,0,0,0,100,100,2,0,1,0,0,7,0,0,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:25.32,Small,,0,0,0,,{\\pos(72,72)}山间棋亭 · 象棋 × 五子棋
Dialogue: 0,0:00:00.00,0:00:25.32,Title,,0,0,0,,{\\pos(68,123)}象五子棋
Dialogue: 0,0:00:00.00,0:00:25.32,Body,,0,0,0,,{\\pos(76,236)}象棋走法，同色连五
Dialogue: 0,0:00:00.00,0:00:07.00,Heading,,0,0,0,,{\\pos(72,343)\\fad(250,200)}一车架桥，一手成五
Dialogue: 0,0:00:00.00,0:00:07.00,Body,,0,0,0,,{\\pos(76,408)\\fad(250,200)}走好这一步，接上同色五子。
Dialogue: 0,0:00:07.00,0:00:14.00,Heading,,0,0,0,,{\\pos(72,343)\\fad(250,200)}借子为架，落子成线
Dialogue: 0,0:00:07.00,0:00:14.00,Body,,0,0,0,,{\\pos(76,408)\\fad(250,200)}炮隔一子吃子，连五才算赢。
Dialogue: 0,0:00:14.00,0:00:25.32,Heading,,0,0,0,,{\\pos(72,343)\\fad(250,200)}两手连招，步步有巧思
Dialogue: 0,0:00:14.00,0:00:25.32,Body,,0,0,0,,{\\pos(76,408)\\fad(250,200)}先造双线威胁，再找制胜一手。
Dialogue: 0,0:00:00.00,0:00:25.32,Small,,0,0,0,,{\\pos(76,563)}真实游戏画面 · 触屏操作演示
Dialogue: 0,0:00:00.00,0:00:25.32,Body,,0,0,0,,{\\pos(76,611)}闲来一局，见招拆招。
`;
writeFileSync('source/promo.ass', ass, 'utf8');
const recording = process.argv[2] || 'source/78757486085f736a583810115165f13f.webm';
const graph = [
  '[0:v]scale=1280:720:flags=lanczos,setsar=1,split=3[i][b][o]',
  "[i]trim=duration=3,setpts=PTS-STARTPTS,zoompan=z='min(zoom+0.00025,1.03)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=30,fade=t=in:st=0:d=0.3,fade=t=out:st=2.75:d=0.25[intro]",
  '[b]trim=duration=25.32,setpts=PTS-STARTPTS,boxblur=12:1,drawbox=x=0:y=0:w=iw:h=ih:color=0x13392c@0.88:t=fill,drawbox=x=76:y=309:w=72:h=3:color=0xd9ba7e:t=fill[bg]',
  // Playwright stores a smaller viewport at the top left of a larger video frame.
  '[1:v]trim=start=3:end=28.32,setpts=PTS-STARTPTS,crop=432:768:0:0,scale=378:672:flags=lanczos,setsar=1,fps=30[game]',
  '[bg][game]overlay=820:24:shortest=1,drawbox=x=817:y=21:w=384:h=678:color=0xd9ba7e:t=3,ass=source/promo.ass,fade=t=in:st=0:d=0.25,fade=t=out:st=24.97:d=0.35[main]',
  '[o]trim=duration=3,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.25,fade=t=out:st=2.65:d=0.35[outro]',
  '[intro][main][outro]concat=n=3:v=1:a=0,format=yuv420p[v]',
  '[2:a]afade=t=in:st=0:d=0.5,afade=t=out:st=29.8:d=1.52[a]',
].join(';');
writeFileSync('source/video-filter.txt', graph);
ffmpeg(['-filter_complex_threads', '1', '-loop', '1', '-framerate', '30', '-i', 'promo-landscape-1920x1080.png',
  '-i', recording, '-i', 'source/original-pentatonic.wav', '-filter_complex', graph,
  '-map', '[v]', '-map', '[a]', '-t', String(duration), '-r', '30', '-c:v', 'libx264', '-threads', '2',
  '-preset', 'medium', '-crf', '19', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
  'promo-video-1280x720.mp4']);

const targets = [
  ['promo-landscape-1920x1080.png', 1920, 1080],
  ['promo-square-1440x1440.png', 1440, 1440],
  ['game-icon-1024x1024.png', 1024, 1024],
  ['game-icon-512x512.png', 512, 512],
  ['screenshot-01-home-1080x1920.png', 1080, 1920],
  ['screenshot-02-gameplay-1080x1920.png', 1080, 1920],
  ['screenshot-03-five-in-row-1080x1920.png', 1080, 1920],
  ['promo-video-1280x720.mp4', 1280, 720],
];
const files = targets.map(([file, width, height]) => {
  const media = probe(file), stream = media.streams.find(item => item.codec_type === 'video');
  assert.equal(stream.width, width); assert.equal(stream.height, height);
  if (file.endsWith('.mp4')) {
    assert.equal(stream.codec_name, 'h264'); assert.equal(stream.pix_fmt, 'yuv420p');
    assert.equal(stream.r_frame_rate, '30/1');
    assert.ok(Number(media.format.duration) > 30);
    assert.ok(media.streams.some(item => item.codec_type === 'audio' && item.codec_name === 'aac'));
  }
  return { file, width, height, bytes: readFileSync(file).length,
    ...(file.endsWith('.mp4') ? { seconds: Number(media.format.duration), fps: 30, video: 'H.264', audio: 'AAC, original synthesized music' } : {}) };
});
const evidence = JSON.parse(readFileSync('source/capture-evidence.json', 'utf8'));
assert.deepEqual(evidence.errors, []);
writeFileSync('manifest.json', JSON.stringify({ files, checks: 'All exact dimensions, frame rate, codecs, duration, and capture assertions passed.' }, null, 2));
console.log(JSON.stringify(files, null, 2));
