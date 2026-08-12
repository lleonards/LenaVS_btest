import path from 'path';
import fs from 'fs/promises';
import { generateOptimizedFinalVideo } from './src/utils/optimizedRenderer.js';

const workDir = path.resolve('./tmp-render-test');
await fs.mkdir(workDir, { recursive: true });

const audioPath = path.join(workDir, 'tone.wav');
const imagePath = path.join(workDir, 'bg.png');
const videoPath = path.join(workDir, 'bg.mp4');
const subtitlesPath = path.join(workDir, 'subs.ass');
const outImagePath = path.join(workDir, 'out-image.mp4');
const outVideoPath = path.join(workDir, 'out-video.mp4');

const subtitles = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,40,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.50,Default,,0,0,0,,Teste LenaVS
`;

await fs.writeFile(subtitlesPath, subtitles, 'utf8');

const run = async (command) => {
  const { execFile } = await import('child_process');
  return new Promise((resolve, reject) => {
    execFile('bash', ['-lc', command], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command}\n${stderr || stdout || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
};

await run(`ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2.5" -c:a pcm_s16le "${audioPath}"`);
await run(`ffmpeg -y -f lavfi -i "color=c=blue:s=1280x720" -frames:v 1 "${imagePath}"`);
await run(`ffmpeg -y -f lavfi -i "testsrc=size=1280x720:rate=30:duration=1.1" -pix_fmt yuv420p "${videoPath}"`);

const animation = {
  introTransition: 'fade',
  introDuration: 0.8,
  outroTransition: 'slide',
  outroDuration: 0.8,
  loopTransition: 'zoom-in',
  loopTransitionDuration: 0.4,
};

await generateOptimizedFinalVideo({
  backgroundType: 'image',
  backgroundPath: imagePath,
  backgroundColor: '#000000',
  audioPath,
  audioDuration: 2.5,
  outputPath: outImagePath,
  subtitlesPath,
  format: 'mp4',
  resolution: '720p',
  mediaAnimation: animation,
  backgroundMediaDuration: 0,
});

await generateOptimizedFinalVideo({
  backgroundType: 'video',
  backgroundPath: videoPath,
  backgroundColor: '#000000',
  audioPath,
  audioDuration: 2.5,
  outputPath: outVideoPath,
  subtitlesPath,
  format: 'mp4',
  resolution: '720p',
  mediaAnimation: animation,
  backgroundMediaDuration: 1.1,
});

console.log(JSON.stringify({
  ok: true,
  files: [outImagePath, outVideoPath],
}, null, 2));
