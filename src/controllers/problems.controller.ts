import { Request, Response } from 'express';
import problemData from '../data/problemData';

// ===== TYPE DEFINITIONS =====

interface Pricing {
  currency: string;
  min_price: number;
  max_price: number;
}

interface RelationalBehavior {
  id: string;
  title: string;
  default_level: string;
  pricing: Pricing;
  repair: boolean;
  replacement: boolean;
}

interface SubProblem {
  id: string;
  title: string;
  relational_behaviors: RelationalBehavior[];
}

interface MainProblemCategory {
  id: string;
  main_problem_category: string;
  sub_problems: SubProblem[];
}

interface ProblemData {
  laptop_problem_behavior_master: MainProblemCategory[];
}

// ===== CONTROLLERS =====

/**
 * GET /api/v1/problems
 * Returns all main problem categories
 */
export const getMainProblems = (req: Request, res: Response): void => {
  try {
    const mainProblems = problemData.laptop_problem_behavior_master.map(category => ({
      id: category.id,
      title: category.main_problem_category,
    }));

    res.status(200).json({
      success: true,
      data: mainProblems,
    });
  } catch (error) {
    console.error('Error fetching main problems:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch main problems',
    });
  }
};

/**
 * GET /api/v1/problems/:mainProblemId/sub-problems
 * Returns sub-problems for a given main problem category
 */
export const getSubProblems = (req: Request, res: Response): void => {
  try {
    const { mainProblemId } = req.params;

    const mainCategory = problemData.laptop_problem_behavior_master.find(
      category => category.id === mainProblemId
    );

    if (!mainCategory) {
      res.status(404).json({
        success: false,
        message: `Main problem category with id '${mainProblemId}' not found`,
      });
      return;
    }

    const subProblems = mainCategory.sub_problems.map(sp => ({
      id: sp.id,
      title: sp.title,
    }));

    res.status(200).json({
      success: true,
      data: subProblems,
    });
  } catch (error) {
    console.error('Error fetching sub-problems:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sub-problems',
    });
  }
};

/**
 * GET /api/v1/problems/:mainProblemId/all-behaviors
 * Returns ALL relational behaviors from ALL sub-problems of a given main problem category,
 * each enriched with subProblemId and subProblemTitle for context.
 */
export const getAllBehaviorsForMainProblem = (req: Request, res: Response): void => {
  try {
    const { mainProblemId } = req.params;

    const mainCategory = problemData.laptop_problem_behavior_master.find(
      category => category.id === mainProblemId
    );

    if (!mainCategory) {
      res.status(404).json({
        success: false,
        message: `Main problem category with id '${mainProblemId}' not found`,
      });
      return;
    }

    // Flatten all behaviors across all sub-problems, tagging each with its sub-problem info
    const allBehaviors = mainCategory.sub_problems.flatMap(sp =>
      sp.relational_behaviors.map(b => ({
        ...b,
        subProblemId: sp.id,
        subProblemTitle: sp.title,
      }))
    );

    res.status(200).json({
      success: true,
      data: allBehaviors,
    });
  } catch (error) {
    console.error('Error fetching all behaviors for main problem:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch behaviors',
    });
  }
};

/**
 * GET /api/v1/problems/:subProblemId/behaviors
 * Returns relational behaviors for a given sub-problem
 */
export const getBehaviors = (req: Request, res: Response): void => {
  try {
    const { subProblemId } = req.params;

    // Scan all main categories to find the sub-problem
    let foundBehaviors: RelationalBehavior[] | null = null;

    for (const category of problemData.laptop_problem_behavior_master) {
      const subProblem = category.sub_problems.find(sp => sp.id === subProblemId);
      if (subProblem) {
        foundBehaviors = subProblem.relational_behaviors;
        break;
      }
    }

    if (!foundBehaviors) {
      res.status(404).json({
        success: false,
        message: `Sub-problem with id '${subProblemId}' not found`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: foundBehaviors,
    });
  } catch (error) {
    console.error('Error fetching behaviors:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch behaviors',
    });
  }
};
