import express from 'express';
import {
  getMainProblems,
  getSubProblems,
  getBehaviors,
  getAllBehaviorsForMainProblem,
} from '../controllers/problems.controller';

const router = express.Router();

// GET /api/v1/problems — get all main problem categories
router.get('/', getMainProblems);

// GET /api/v1/problems/:mainProblemId/all-behaviors — all behaviors across all sub-problems of a main category
router.get('/:mainProblemId/all-behaviors', getAllBehaviorsForMainProblem);

// GET /api/v1/problems/:mainProblemId/sub-problems — get sub-problems for a main category
router.get('/:mainProblemId/sub-problems', getSubProblems);

// GET /api/v1/problems/:subProblemId/behaviors — get relational behaviors for a sub-problem
router.get('/:subProblemId/behaviors', getBehaviors);

export default router;
