import express from 'express';
import {
  createProject,
  listProjects,
  listPublicProjects,
  getProject,
  updateProject,
  publishProject,
  unpublishProject,
  forkProject,
  deleteProject,
} from '../controllers/projectController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/library', listPublicProjects);
router.post('/', createProject);
router.get('/', listProjects);
router.get('/:id', getProject);
router.put('/:id', updateProject);
router.post('/:id/publish', publishProject);
router.post('/:id/unpublish', unpublishProject);
router.post('/:id/fork', forkProject);
router.delete('/:id', deleteProject);

export default router;
