import { z } from 'zod';

export var FlowStepSchema = z.object({
  action: z.enum(['navigate', 'click', 'type', 'wait', 'select', 'hover', 'press', 'checkpoint']),
  url: z.string().optional(),
  selector: z.string().optional(),
  value: z.string().optional(),
  ms: z.number().int().min(0).optional(),
  key: z.string().optional(),
});

export var ScanRequestSchema = z.object({
  url: z.string().url('URL invalida - debe incluir http:// o https://'),
  visualDiffThreshold: z.number().min(0).max(1).optional(),
  flow: z.object({
    name: z.string().min(1).max(200),
    steps: z.array(FlowStepSchema).min(1),
  }).optional(),
  flowId: z.string().optional(),
  config: z
    .object({
      timeout: z.number().int().min(5000).max(120000).optional(),
    })
    .optional(),
});

export var ExplainRequestSchema = z.object({
  type: z.string().min(1),
  severity: z.string().min(1),
  description: z.string().min(1),
  url: z.string().min(1),
  model: z.string().optional(),
});
