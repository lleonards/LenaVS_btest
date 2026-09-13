import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createAssSubtitleFile } from './src/utils/videoProcessor.js';
import { generateOptimizedFinalVideo } from './src/utils/optimizedRenderer.js';

const workDir = '/home/user/work/backend/LenaVS_Backend/.tmp-test';
fs.mkdirSync(workDir, { recursive: true });

const bgVideo = path.join(workDir, 'bg.mp4');
const audio = path.join(workDir, 'audio.wav');
const subtitles = path.join(workDir, 'subtitles.ass');
const output = path.join(workDir, 'output.mp4');

execSync(`ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=30 -t 4 -pix_fmt yuv420p "${bgVideo}"`, { stdio: 'inherit' });
execSync(`ffmpeg -y -f lavfi -i sine=frequency=880:sample_rate=44100 -t 6 "${audio}"`, { stdio: 'inherit' });

await createAssSubtitleFile([
  {
    id: 's1',
    text: 'Linha 1\nLinha 2',
    startTime: '00:01',
    endTime: '00:05',
    fontSize: 36,
    fontFamily: 'Montserrat',
    color: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    bold: false,
    italic: false,
    underline: false,
    transition: 'fade',
    transitionDuration: 1,
    alignment: 'center',
    leadIn: 0.5,
    lineStyles: {},
    scaleX: 1,
    scaleY: 1,
  }
], subtitles, '720p');

await generateOptimizedFinalVideo({
  backgroundType: 'video',
  backgroundPath: bgVideo,
  backgroundColor: '#000000',
  audioPath: audio,
  audioDuration: 6,
  outputPath: output,
  subtitlesPath: subtitles,
  format: 'mp4',
  resolution: '720p',
  mediaAnimation: {
    introTransition: 'fade',
    introDuration: 0.8,
    outroTransition: 'fade',
    outroDuration: 0.8,
    loopTransition: 'fade',
    loopTransitionDuration: 0.4,
  },
  backgroundMediaDuration: 4,
});

execSync(`ffprobe -v error -show_streams -show_format "${output}"`, { stdio: 'inherit' });
execSync(`ffmpeg -y -i "${output}" -vf "select='eq(n,0)+eq(n,60)+eq(n,120)',scale=320:-1" -vsync 0 "${workDir}/frame-%02d.png"`, { stdio: 'inherit' });
console.log(output);
