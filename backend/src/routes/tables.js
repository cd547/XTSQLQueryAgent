import { Router } from 'express';
import { authRequired } from '../services/auth.js';

const router = Router();

router.use(authRequired);

export default router;

