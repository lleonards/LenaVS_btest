import path from 'path';
import { supabase } from '../config/supabase.js';
import { cloneMediaReferenceForUser } from '../services/storageService.js';
import { normalizeProjectPayload } from '../utils/stanzaNormalizer.js';

const DEFAULT_RESOLUTION = '720p';

// Termos bloqueados: palavrões, ofensivos, discriminatórios e spam
const BLOCKED_TERMS = [
  'puta', 'merda', 'caralho', 'porra', 'buceta', 'foda', 'fdp', 'vsf',
  'cu', 'cuzao', 'bosta', 'xoxota', 'punheta', 'viado', 'viadao',
  'arrombado', 'filha da puta', 'filho da puta', 'penis', 'escroto',
  'fuck', 'shit', 'asshole', 'bitch', 'cunt', 'nigger', 'nigga',
  'faggot', 'pussy', 'cock', 'dick', 'slut', 'whore', 'porn', 'xxx',
];

const validatePublicName = (name) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { valid: false, error: 'O nome público é obrigatório.' };
  if (trimmed.length < 3) return { valid: false, error: 'O nome público precisa ter pelo menos 3 caracteres.' };
  if (trimmed.length > 60) return { valid: false, error: 'O nome público pode ter no máximo 60 caracteres.' };
  if (/^s+$/.test(trimmed)) return { valid: false, error: 'O nome público não pode conter apenas espaços.' };
  if (/^d+$/.test(trimmed)) return { valid: false, error: 'O nome público não pode conter apenas números.' };
  if (/^[^a-zA-ZÀ-ÿ0-9]+$/.test(trimmed)) return { valid: false, error: 'O nome público não pode conter apenas símbolos.' };
  const lower = trimmed.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const term of BLOCKED_TERMS) {
    if (lower.includes(term)) return { valid: false, error: 'O nome público contém termos não permitidos.' };
  }
  return { valid: true, error: null };
};
const UNKNOWN_OWNER_NAME = 'Projeto da comunidade';
const PROJECT_MEDIA_KEYS = ['musicaOriginal', 'musicaInstrumental', 'video', 'imagem'];
const VALID_AUDIO_TYPES = new Set(['original', 'instrumental']);

const normalizeDisplayName = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const deriveDisplayNameFromEmail = (email) => {
  const localPart = String(email || '').split('@')[0] || '';
  const normalized = localPart.replace(/[._-]+/g, ' ').trim();
  return normalized ? normalized.replace(/\b\w/g, (character) => character.toUpperCase()) : '';
};

const normalizeIncomingConfig = (body = {}) => {
  const rawConfig = body.config ?? body.data ?? {};
  return normalizeProjectPayload(rawConfig);
};

const normalizeProjectResponse = (project) => {
  if (!project) return project;

  return {
    ...project,
    config: normalizeProjectPayload(project.config || {}),
  };
};

const extractDisplayNameFromAuthUser = (authUser) => {
  const candidates = [
    authUser?.user_metadata?.name,
    authUser?.user_metadata?.full_name,
    authUser?.user_metadata?.display_name,
    authUser?.raw_user_meta_data?.name,
    authUser?.raw_user_meta_data?.full_name,
    authUser?.raw_user_meta_data?.display_name,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (normalized) {
      return normalized;
    }
  }

  return '';
};

const getDefaultExtensionForMediaKey = (mediaKey) => {
  if (mediaKey === 'video') return '.mp4';
  if (mediaKey === 'imagem') return '.jpg';
  return '.mp3';
};

const cloneProjectMediaForUser = async (mediaFiles = {}, mediaMetadata = {}, targetUserId) => {
  const clonedMediaFiles = {
    musicaOriginal: null,
    musicaInstrumental: null,
    video: null,
    imagem: null,
    ...(mediaFiles || {}),
  };
  const clonedMediaMetadata = {
    musicaOriginal: null,
    musicaInstrumental: null,
    video: null,
    imagem: null,
    ...(mediaMetadata || {}),
  };

  const issues = [];

  for (const mediaKey of PROJECT_MEDIA_KEYS) {
    const sourceValue = mediaFiles?.[mediaKey];
    if (!sourceValue) {
      clonedMediaFiles[mediaKey] = null;
      clonedMediaMetadata[mediaKey] = null;
      continue;
    }

    try {
      const clonedValue = await cloneMediaReferenceForUser(sourceValue, {
        userId: targetUserId,
        category: `forks/${mediaKey}`,
        prefix: mediaKey,
        fallbackName: `${mediaKey}${getDefaultExtensionForMediaKey(mediaKey)}`,
      });
      clonedMediaFiles[mediaKey] = clonedValue || sourceValue;
      // O exportador deve usar a referência efetivamente copiada (ou a
      // referência pública original quando a cópia legada não for possível),
      // nunca o storagePath antigo do projeto publicado.
      clonedMediaMetadata[mediaKey] = {
        ...(mediaMetadata?.[mediaKey] || {}),
        publicUrl: clonedValue || sourceValue,
        storagePath: null,
      };
    } catch (error) {
      // Uma falha ao copiar um arquivo não deve apagar a mídia do projeto
      // aberto. A biblioteca já expõe a referência pública original, então
      // ela continua disponível até o usuário substituí-la no editor.
      clonedMediaFiles[mediaKey] = sourceValue;
      clonedMediaMetadata[mediaKey] = {
        ...(mediaMetadata?.[mediaKey] || {}),
        publicUrl: sourceValue,
        storagePath: null,
      };
      issues.push(`${mediaKey}: ${error.message}`);
    }
  }

  if (issues.length) {
    console.warn('Alguns arquivos de mídia do projeto não puderam ser copiados integralmente:', issues.join(' | '));
  }

  return {
    mediaFiles: clonedMediaFiles,
    mediaMetadata: clonedMediaMetadata,
  };
};

const buildOwnerMap = async (userIds = []) => {
  const uniqueUserIds = [...new Set((userIds || []).filter(Boolean))];
  if (!uniqueUserIds.length) {
    return {};
  }

  const ownerMap = Object.fromEntries(
    uniqueUserIds.map((userId) => [userId, { owner_name: UNKNOWN_OWNER_NAME, owner_email: null }])
  );

  const { data: owners, error: ownersError } = await supabase
    .from('users')
    .select('id, email, display_name')
    .in('id', uniqueUserIds);

  if (ownersError) {
    console.warn('Não foi possível carregar usuários da tabela users:', ownersError.message);
  } else {
    (owners || []).forEach((owner) => {
      const ownerEmail = owner?.email || null;
      ownerMap[owner.id] = {
        ...ownerMap[owner.id],
        owner_email: ownerEmail || ownerMap[owner.id]?.owner_email || null,
        owner_name:
          normalizeDisplayName(owner?.display_name)
          || deriveDisplayNameFromEmail(ownerEmail)
          || ownerMap[owner.id]?.owner_name
          || UNKNOWN_OWNER_NAME,
      };
    });
  }

  await Promise.all(
    uniqueUserIds.map(async (userId) => {
      try {
        const { data, error } = await supabase.auth.admin.getUserById(userId);
        if (error || !data?.user) {
          if (error) {
            console.warn(`Não foi possível carregar metadata do usuário ${userId}:`, error.message);
          }
          return;
        }

        const displayName = extractDisplayNameFromAuthUser(data.user);
        const ownerEmail = data.user.email || ownerMap[userId]?.owner_email || null;
        ownerMap[userId] = {
          owner_name:
            displayName
            || deriveDisplayNameFromEmail(ownerEmail)
            || ownerMap[userId]?.owner_name
            || UNKNOWN_OWNER_NAME,
          owner_email: ownerEmail,
        };
      } catch (error) {
        console.warn(`Falha ao buscar metadata do usuário ${userId}:`, error.message);
      }
    })
  );

  return ownerMap;
};

export const createProject = async (req, res) => {
  try {
    const { name, resolution, description, isPublic, forkedFrom } = req.body;
    const userId = req.user.id;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
    }

    const payload = {
      user_id: userId,
      name: String(name).trim(),
      config: normalizeIncomingConfig(req.body),
      resolution: String(resolution || DEFAULT_RESOLUTION),
      description: String(description || '').trim(),
      is_public: false, // projetos são criados como privados por padrão
      forked_from: forkedFrom || null,
    };

    const { data: project, error } = await supabase
      .from('projects')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      project: normalizeProjectResponse(project),
    });
  } catch (error) {
    console.error('Erro ao criar projeto:', error);
    return res.status(500).json({ error: 'Erro ao criar projeto' });
  }
};

export const listProjects = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: projects, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      projects: (projects || []).map(normalizeProjectResponse),
    });
  } catch (error) {
    console.error('Erro ao listar projetos:', error);
    return res.status(500).json({ error: 'Erro ao listar projetos' });
  }
};

export const listPublicProjects = async (req, res) => {
  try {
    const userId = req.user.id;
    const search = String(req.query.q || '').trim();

    let query = supabase
      .from('projects')
      .select('id, user_id, name, public_name, published_at, description, resolution, is_public, download_count, forked_from, created_at, updated_at, config')
      .eq('is_public', true)
      .order('published_at', { ascending: false, nullsFirst: false });

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,public_name.ilike.%${search}%`);
    }

    const { data: projects, error } = await query;

    if (error) throw error;

    const ownerMap = await buildOwnerMap((projects || []).map((item) => item.user_id));

    const normalizedProjects = (projects || []).map((project) => ({
      ...normalizeProjectResponse(project),
      owner_name: ownerMap[project.user_id]?.owner_name || UNKNOWN_OWNER_NAME,
      owner_email: ownerMap[project.user_id]?.owner_email || null,
      is_owner: project.user_id === userId,
    }));

    return res.status(200).json({
      success: true,
      projects: normalizedProjects,
    });
  } catch (error) {
    console.error('Erro ao listar biblioteca pública:', error);
    return res.status(500).json({ error: 'Erro ao listar biblioteca pública' });
  }
};

export const getProject = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: project, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    if (!project) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    const canAccess = project.user_id === userId || project.is_public === true;

    if (!canAccess) {
      return res.status(403).json({ error: 'Você não tem permissão para acessar este projeto' });
    }

    return res.status(200).json({
      success: true,
      project: normalizeProjectResponse(project),
    });
  } catch (error) {
    console.error('Erro ao obter projeto:', error);
    return res.status(500).json({ error: 'Erro ao obter projeto' });
  }
};

export const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, resolution, description } = req.body;
    const userId = req.user.id;

    const { data: existingProject, error: existingError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (existingError) throw existingError;

    if (!existingProject) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    const updateData = {};

    if (typeof name !== 'undefined') {
      if (!String(name).trim()) {
        return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
      }
      updateData.name = String(name).trim();
    }

    if (typeof req.body.config !== 'undefined' || typeof req.body.data !== 'undefined') {
      updateData.config = normalizeIncomingConfig(req.body);
    }

    if (typeof resolution !== 'undefined') {
      updateData.resolution = String(resolution || DEFAULT_RESOLUTION);
    }

    if (typeof description !== 'undefined') {
      updateData.description = String(description || '').trim();
    }

    const { data: project, error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      project: normalizeProjectResponse(project),
    });
  } catch (error) {
    console.error('Erro ao atualizar projeto:', error);
    return res.status(500).json({ error: 'Erro ao atualizar projeto' });
  }
};

export const publishProject = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const publicName = String(req.body?.publicName || '').trim();

    const validation = validatePublicName(publicName);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const { data: existingProject, error: existingError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (existingError) throw existingError;
    if (!existingProject) return res.status(404).json({ error: 'Projeto não encontrado' });

    const { data: project, error } = await supabase
      .from('projects')
      .update({
        is_public: true,
        public_name: publicName,
        published_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, project: normalizeProjectResponse(project) });
  } catch (error) {
    console.error('Erro ao publicar projeto:', error);
    return res.status(500).json({ error: 'Erro ao publicar projeto' });
  }
};

export const unpublishProject = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: existingProject, error: existingError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (existingError) throw existingError;
    if (!existingProject) return res.status(404).json({ error: 'Projeto não encontrado' });

    const { data: project, error } = await supabase
      .from('projects')
      .update({ is_public: false })
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, project: normalizeProjectResponse(project) });
  } catch (error) {
    console.error('Erro ao despublicar projeto:', error);
    return res.status(500).json({ error: 'Erro ao despublicar projeto' });
  }
};

export const forkProject = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const requestedName = String(req.body?.name || '').trim();

    const { data: originalProject, error: originalError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();

    if (originalError) throw originalError;

    if (!originalProject) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    if (!originalProject.is_public && originalProject.user_id !== userId) {
      return res.status(403).json({ error: 'Este projeto não está disponível para cópia' });
    }

    const normalizedOriginalConfig = normalizeProjectPayload(originalProject.config || {});
    const clonedMedia = await cloneProjectMediaForUser(
      normalizedOriginalConfig.mediaFiles || {},
      normalizedOriginalConfig.mediaMetadata || {},
      userId
    );

    const forkedConfig = {
      ...normalizedOriginalConfig,
      audioType: VALID_AUDIO_TYPES.has(normalizedOriginalConfig.audioType)
        ? normalizedOriginalConfig.audioType
        : 'original',
      // Uma cópia da Biblioteca é um projeto normal já preenchido. Não há
      // bloqueio de faixa de áudio ou de qualquer outro arquivo de mídia.
      lockedAudioType: null,
      mediaFiles: clonedMedia.mediaFiles,
      mediaMetadata: clonedMedia.mediaMetadata,
    };

    const forkName = requestedName || `${originalProject.name} (cópia)`;

    const { data: forkedProject, error: forkError } = await supabase
      .from('projects')
      .insert({
        user_id: userId,
        name: forkName,
        config: forkedConfig,
        resolution: originalProject.resolution || DEFAULT_RESOLUTION,
        description: originalProject.description || '',
        is_public: false,
        forked_from: originalProject.id,
      })
      .select('*')
      .single();

    if (forkError) throw forkError;

    if (originalProject.user_id !== userId) {
      const { error: downloadHistoryError } = await supabase
        .from('project_downloads')
        .insert({
          project_id: originalProject.id,
          user_id: userId,
        });

      if (downloadHistoryError) {
        console.warn('Não foi possível registrar o fork no histórico:', downloadHistoryError.message);
      }

      const { error: incrementError } = await supabase.rpc('increment_download_count', {
        project_id: originalProject.id,
      });

      if (incrementError) {
        console.warn('Não foi possível incrementar download_count:', incrementError.message);
      }
    }

    return res.status(201).json({
      success: true,
      project: normalizeProjectResponse(forkedProject),
    });
  } catch (error) {
    console.error('Erro ao criar cópia do projeto:', error);
    return res.status(error.status || 500).json({
      error: error.message || 'Erro ao criar cópia do projeto',
      details: error.details || undefined,
    });
  }
};

export const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: 'Projeto deletado com sucesso',
    });
  } catch (error) {
    console.error('Erro ao deletar projeto:', error);
    return res.status(500).json({ error: 'Erro ao deletar projeto' });
  }
};
