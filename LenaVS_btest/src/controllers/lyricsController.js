import { separateIntoStanzas, processLyricsFile } from '../utils/lyricsProcessor.js';
import { removeLocalFileSilently } from '../services/storageService.js';

export const processManualLyrics = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Texto da letra não fornecido' });
    }

    const result = separateIntoStanzas(text);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Erro ao processar letra:', error);
    return res.status(500).json({ error: 'Erro ao processar letra' });
  }
};

export const processLyricsFileUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo de letra não fornecido' });
    }

    const result = await processLyricsFile(req.file.path);

    return res.status(200).json({
      success: true,
      fileName: req.file.originalname,
      ...result,
    });
  } catch (error) {
    console.error('Erro ao processar arquivo de letra:', error);
    const detail = String(error?.message || '').replace(/^Erro ao processar arquivo de letra:\s*/i, '');
    const message = detail.toLowerCase();
    const isUnsupported = /formato de arquivo não suportado/i.test(message);
    const isEmpty = /não foi encontrado texto legível/i.test(message);
    const isOcrFailure = /não foi possível reconhecer texto neste pdf/i.test(message);

    return res.status(isUnsupported || isEmpty || isOcrFailure ? 422 : 400).json({
      code: isUnsupported
        ? 'UNSUPPORTED_LYRICS_FORMAT'
        : isOcrFailure
          ? 'LYRICS_OCR_FAILED'
          : isEmpty
            ? 'LYRICS_TEXT_NOT_FOUND'
            : 'LYRICS_READ_ERROR',
      fileName: req.file?.originalname || null,
      error: isUnsupported
        ? `O arquivo "${req.file?.originalname || 'enviado'}" não tem um formato de letra aceito.`
        : isOcrFailure
          ? `Não foi possível reconhecer o texto do PDF "${req.file?.originalname || 'enviado'}" nem com OCR. Verifique a qualidade da imagem e tente novamente.`
          : isEmpty
            ? `Não foi possível ler uma letra no arquivo "${req.file?.originalname || 'enviado'}".`
          : `Erro ao ler o arquivo "${req.file?.originalname || 'enviado'}". Confirme que ele não está corrompido e tente novamente.`,
    });
  } finally {
    await removeLocalFileSilently(req.file?.path);
  }
};
