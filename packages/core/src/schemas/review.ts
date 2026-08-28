import { z } from "zod";

export const severitySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export const confidenceSchema = z.enum(["low", "medium", "high"]);
export const findingCategorySchema = z.enum([
  "bug",
  "security",
  "performance",
  "maintainability",
  "code_quality",
  "testing",
  "regression",
]);
export const recommendationSchema = z.enum([
  "approve",
  "approve_with_suggestions",
  "request_changes",
  "manual_review_required",
]);

export const reviewFindingSchema = z.object({
  id: z.string().min(1).optional(),
  category: findingCategorySchema,
  severity: severitySchema,
  confidence: confidenceSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  file: z.string().min(1).max(500).optional(),
  line: z.number().int().positive().optional(),
  suggestion: z.string().max(2000).optional(),
  reasoning: z.string().max(2000).optional(),
});

export const testingAssessmentSchema = z.object({
  testsDetected: z.boolean(),
  coverageConcerns: z.array(z.string().max(500)).max(20),
  suggestedTests: z.array(z.string().max(500)).max(20),
});

export const aiChunkReviewSchema = z.object({
  summary: z.string().min(1).max(4000),
  findings: z.array(reviewFindingSchema).max(50),
  positiveObservations: z.array(z.string().max(500)).max(20),
  testingAssessment: testingAssessmentSchema,
  sensitiveAreas: z.array(z.string().max(200)).max(30),
  manualReviewAreas: z.array(z.string().max(500)).max(20),
  recommendation: recommendationSchema,
  insufficientContext: z.boolean().optional().default(false),
});

export type ParsedAIChunkReview = z.infer<typeof aiChunkReviewSchema>;
export type ParsedReviewFinding = z.infer<typeof reviewFindingSchema>;
