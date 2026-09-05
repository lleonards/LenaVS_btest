import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';

const DEMUCS_PYTHON_BIN = process.env.DEMUCS_PYTHON_BIN || 'python3';
const DEMUCS_CLI_BIN = process.env.DEMUCS_CLI_BIN || 'demucs';
const DEMUCS_MODEL = process.env.DEMUCS_MODEL || 'htdemucs';
const DEMUCS_DEVICE = process.env.DEMUCS_DEVICE || 'cpu';
const DEMUCS_TIMEOUT_MS = Number(process.env.DEMUCS_TIMEOUT_MS || 20 * 60 * 1000);
const DEMUCS_MP3_BITRATE = String(process.env.DEMUCS_MP3_BITRATE || '320');
const DEMUCS_THREADS = String(process.env.DEMUCS_THREADS || '1');
const DEMUCS_LAUNCH_MODE = String(process.env.DEMUCS_LAUNCH_MODE || 'auto').trim().toLowerCase();
const DEMUCS_TMP_ROOT = path.join(os.tmpdir(), 'lenavs-demucs');

let demucsAvailabilityPromise = null;

const roundDuration = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(3)) : null;
};

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
  return dirPath;
};

const isLikelyMissingDemucsError = (error) => {
  const stderr = String(error?.stderr || '').toLowerCase();
  const stdout = String(error?.stdout || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  return (
    error?.code === 'ENOENT'
    || stderr.includes('no module named demucs')
    || stderr.includes('no module named demucs.separate')
    || stderr.includes("can't open file")
    || stderr.includes('command not found')
    || stdout.includes('command not found')
    || message.includes('enoent')
    || message.includes('command not found')
    || message.includes('is not recognized as an internal or external command')
  );
};

const buildDemucsEnv = (baseEnv = process.env) => {
  const env = { ...baseEnv };

  if (String(DEMUCS_DEVICE).toLowerCase() === 'cpu') {
    env.OMP_NUM_THREADS = env.OMP_NUM_THREADS || DEMUCS_THREADS;
    env.MKL_NUM_THREADS = env.MKL_NUM_THREADS || DEMUCS_THREADS;
    env.NUMEXPR_NUM_THREADS = env.NUMEXPR_NUM_THREADS || DEMUCS_THREADS;
    env.OPENBLAS_NUM_THREADS = env.OPENBLAS_NUM_THREADS || DEMUCS_THREADS;
  }

  return env;
};

const runCommand = (command, args, { cwd, timeoutMs = DEMUCS_TIMEOUT_MS, env = process.env } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');

    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 5000).unref();
  }, timeoutMs);

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });

  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });

  child.on('close', (code) => {
    clearTimeout(timer);

    if (timedOut) {
      const timeoutError = new Error(`Demucs excedeu o tempo limite de ${Math.round(timeoutMs / 1000)} segundos.`);
      timeoutError.code = 'DEMUCS_TIMEOUT';
      timeoutError.stdout = stdout;
      timeoutError.stderr = stderr;
      reject(timeoutError);
      return;
    }

    if (code !== 0) {
      const commandError = new Error(`Demucs finalizou com código ${code}.`);
      commandError.code = 'DEMUCS_PROCESS_FAILED';
      commandError.exitCode = code;
      commandError.stdout = stdout;
      commandError.stderr = stderr;
      reject(commandError);
      return;
    }

    resolve({ stdout, stderr });
  });
});

const listFilesRecursively = async (rootDir) => {
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(fullPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
};

const stemScore = (filePath) => {
  const baseName = path.basename(filePath).toLowerCase();

  if (/^no_vocals\./.test(baseName)) return 100;
  if (/^accompaniment\./.test(baseName)) return 90;
  if (/^instrumental\./.test(baseName)) return 80;
  if (/^other\./.test(baseName)) return 70;
  if (baseName.includes('no_vocals')) return 60;
  if (baseName.includes('accompaniment')) return 50;
  if (baseName.includes('instrumental')) return 40;
  if (baseName.includes('other')) return 30;
  return 0;
};

const findBestInstrumentalStem = async (outputRoot) => {
  const files = await listFilesRecursively(outputRoot);
  const supportedFiles = files.filter((filePath) => /\.(mp3|wav|flac|ogg|m4a)$/i.test(filePath));

  const ranked = supportedFiles
    .map((filePath) => ({ filePath, score: stemScore(filePath) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.filePath || null;
};

const getAudioDurationInSeconds = (filePath) => new Promise((resolve, reject) => {
  ffmpeg.ffprobe(filePath, (error, metadata) => {
    if (error) {
      reject(error);
      return;
    }

    const duration = Number(
      metadata?.streams?.find((stream) => stream.codec_type === 'audio')?.duration
      || metadata?.format?.duration
      || 0
    );

    resolve(duration);
  });
});

const transcodeToMp3 = (inputPath, outputPath) => new Promise((resolve, reject) => {
  ffmpeg(inputPath)
    .audioCodec('libmp3lame')
    .audioBitrate(`${DEMUCS_MP3_BITRATE}k`)
    .format('mp3')
    .on('end', () => resolve(outputPath))
    .on('error', reject)
    .save(outputPath);
});

const buildRunnerCandidates = () => {
  const candidates = [
    {
      id: 'module-separate',
      command: DEMUCS_PYTHON_BIN,
      baseArgs: ['-m', 'demucs.separate'],
      probeArgs: ['-m', 'demucs.separate', '--help'],
    },
    {
      id: 'module',
      command: DEMUCS_PYTHON_BIN,
      baseArgs: ['-m', 'demucs'],
      probeArgs: ['-m', 'demucs', '--help'],
    },
    {
      id: 'cli',
      command: DEMUCS_CLI_BIN,
      baseArgs: [],
      probeArgs: ['--help'],
    },
  ];

  const only = (id) => candidates.filter((candidate) => candidate.id === id);

  switch (DEMUCS_LAUNCH_MODE) {
    case 'module-separate':
      return only('module-separate');
    case 'module':
      return only('module');
    case 'cli':
      return only('cli');
    default:
      return candidates;
  }
};

const formatDemucsProbeError = (lastError) => {
  const details = [
    String(lastError?.stderr || '').trim(),
    String(lastError?.stdout || '').trim(),
    String(lastError?.message || '').trim(),
  ].filter(Boolean).join(' | ');

  const message = [
    'Demucs não está disponível no servidor.',
    'Use o backend em Docker com Python 3.11, FFmpeg e as dependências do requirements-demucs.txt instaladas.',
    details ? `Detalhe técnico: ${details}` : '',
  ].filter(Boolean).join(' ');

  const availabilityError = new Error(message);
  availabilityError.code = 'DEMUCS_UNAVAILABLE';
  availabilityError.stderr = lastError?.stderr;
  availabilityError.stdout = lastError?.stdout;
  return availabilityError;
};

export const ensureDemucsAvailable = async () => {
  if (!demucsAvailabilityPromise) {
    demucsAvailabilityPromise = (async () => {
      const candidates = buildRunnerCandidates();
      let lastMissingError = null;

      for (const candidate of candidates) {
        try {
          await runCommand(candidate.command, candidate.probeArgs, {
            timeoutMs: 30000,
            env: buildDemucsEnv(process.env),
          });
          return candidate;
        } catch (error) {
          if (isLikelyMissingDemucsError(error)) {
            lastMissingError = error;
            continue;
          }

          throw error;
        }
      }

      throw formatDemucsProbeError(lastMissingError);
    })().catch((error) => {
      demucsAvailabilityPromise = null;

      if (error?.code === 'DEMUCS_UNAVAILABLE') {
        throw error;
      }

      if (isLikelyMissingDemucsError(error)) {
        throw formatDemucsProbeError(error);
      }

      throw error;
    });
  }

  return demucsAvailabilityPromise;
};

export const createInstrumentalWithDemucsFromLocalFile = async (inputPath) => {
  if (!inputPath) {
    throw new Error('Arquivo de áudio local ausente para rodar o Demucs.');
  }

  const runner = await ensureDemucsAvailable();
  await ensureDir(DEMUCS_TMP_ROOT);

  const jobRoot = await fs.promises.mkdtemp(path.join(DEMUCS_TMP_ROOT, 'job-'));
  const outputRoot = path.join(jobRoot, 'output');
  await ensureDir(outputRoot);

  const args = [
    ...runner.baseArgs,
    '-n',
    DEMUCS_MODEL,
    '-d',
    DEMUCS_DEVICE,
    '--two-stems=vocals',
    '--mp3',
    '--mp3-bitrate',
    DEMUCS_MP3_BITRATE,
    '--out',
    outputRoot,
    inputPath,
  ];

  const execution = await runCommand(runner.command, args, {
    cwd: jobRoot,
    timeoutMs: DEMUCS_TIMEOUT_MS,
    env: buildDemucsEnv(process.env),
  });

  const detectedStemPath = await findBestInstrumentalStem(outputRoot);

  if (!detectedStemPath) {
    const error = new Error('Demucs concluiu o processamento, mas não foi possível localizar a faixa instrumental gerada.');
    error.code = 'DEMUCS_OUTPUT_NOT_FOUND';
    error.stdout = execution.stdout;
    error.stderr = execution.stderr;
    throw error;
  }

  let instrumentalPath = detectedStemPath;

  if (path.extname(detectedStemPath).toLowerCase() !== '.mp3') {
    instrumentalPath = path.join(jobRoot, 'instrumental.mp3');
    await transcodeToMp3(detectedStemPath, instrumentalPath);
  }

  let duration = null;

  try {
    duration = roundDuration(await getAudioDurationInSeconds(instrumentalPath));
  } catch (error) {
    console.warn('[demucsService] Não foi possível medir a duração do instrumental:', error.message);
  }

  return {
    instrumentalPath,
    duration,
    jobRoot,
    logs: execution,
    runner: runner.id,
  };
};

export const removeDirectorySilently = async (dirPath) => {
  if (!dirPath) return;

  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.warn('[demucsService] Não foi possível remover diretório temporário:', error.message);
  }
};
