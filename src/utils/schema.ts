import { z } from "zod";

export const StepTypeSchema = z.enum([
   "run",
   "sleep",
   "sleep-until",
   "repeat",
   "invoke-wait-for-result"
]);
export type StepType = z.infer<typeof StepTypeSchema>;
export const StepStatusSchema = z.enum([
   "active",
   "completed",
   "failed",
   "delayed"
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const BackoffStrategiesSchema = z.enum([
   "fixed",
   "exponential"
]);
export type BackoffStrategies = z.infer<typeof BackoffStrategiesSchema>;

export const DefaultRetrySchema = z.object({
   enabled: z.boolean()
     .default(true),
   amount: z.number()
     .default(3),
   delay: z.number()
     .default(1000),
   backoff: BackoffStrategiesSchema.default("exponential")
});
export const DefaultConcurrencySchema = z.object({
   enabled: z.boolean()
     .default(true),
   local: z.number()
     .default(1),
   global: z.number()
     .optional()
});
export const DefaultRateLimitSchema = z.object({
   enabled: z.boolean()
     .default(true),
   amount: z.number(),
   duration: z.number(),
   key: z.string()
     .nullish()
});
export const DefaultDelaySchema = z.object({
   enabled: z.boolean()
     .default(true),
   duration: z.number(),
   key: z.string()
     .optional()
});
export const DefaultPrioritySchema = z.object({
   defaultValue: z.number()
     .default(2),
   delayDefaultValue: z.number()
     .default(1)
});
const DefaultJobRemovalTypeSchema = z.object({
   always: z.boolean()
     .default(false),
   age: z.number()
     .optional(),
   afterAmount: z.number()
     .optional()
});
export const DefaultJobRemovalSchema = z.object({
   onComplete: DefaultJobRemovalTypeSchema.default({}),
   onFail: DefaultJobRemovalTypeSchema.default({})
});

export const JobOrderSchema = z.enum([
   "fifo",
   "lifo"
]);
export type JobOrder = z.infer<typeof JobOrderSchema>;

export const DefaultJobOptionsSchema = z.object({
   order: JobOrderSchema.default("fifo"),
   retries: DefaultRetrySchema.optional(),
   concurrency: DefaultConcurrencySchema.optional(),
   rateLimit: DefaultRateLimitSchema.optional(),
   delay: DefaultDelaySchema.optional(),
   priority: DefaultPrioritySchema.optional(),
   removal: DefaultJobRemovalSchema.optional()
});
export type DefaultJobOptions = z.infer<typeof DefaultJobOptionsSchema>;
export type InpDefaultJobOptions = z.input<typeof DefaultJobOptionsSchema>;

export const SimplifiedDefaultJobOptionsSchema = z.object({
   order: JobOrderSchema.default("fifo"),
   retries: z.union([
        z.boolean(),
        z.number(),
        DefaultRetrySchema
     ])
     .optional(),
   concurrency: z.union([
        z.boolean(),
        z.number(),
        DefaultConcurrencySchema
     ])
     .optional(),
   rateLimit: z.union([
        z.boolean(),
        z.number(),
        DefaultRateLimitSchema
     ])
     .optional(),
   delay: z.union([
        z.boolean(),
        z.number(),
        DefaultDelaySchema
     ])
     .optional(),
   priority: z.union([
        z.number(),
        DefaultPrioritySchema
     ])
     .optional(),
   removal: z.union([
        z.boolean(),
        DefaultJobRemovalSchema
     ])
     .optional()
});
export type InpSimplifiedDefaultJobOptions = z.input<typeof SimplifiedDefaultJobOptionsSchema>;
export type SimplifiedDefaultJobOptions = z.infer<typeof SimplifiedDefaultJobOptionsSchema>;

export const convertSimplifiedDefaultJobOptions = (input: InpSimplifiedDefaultJobOptions): DefaultJobOptions => {
   const parsedInput = SimplifiedDefaultJobOptionsSchema.parse(input);
   const convertedInput = {} as InpDefaultJobOptions;

   if (parsedInput.retries) {
      if (typeof parsedInput.retries === "boolean") {
         convertedInput.retries = {
            enabled: parsedInput.retries
         };
      } else if (typeof parsedInput.retries === "number") {
         convertedInput.retries = {
            amount: parsedInput.retries
         };
      } else {
         convertedInput.retries = parsedInput.retries;
      }
   }

   if (parsedInput.concurrency) {
      if (typeof parsedInput.concurrency === "boolean") {
         convertedInput.concurrency = {
            enabled: parsedInput.concurrency
         };
      } else if (typeof parsedInput.concurrency === "number") {
         convertedInput.concurrency = {
            local: parsedInput.concurrency
         };
      } else {
         convertedInput.concurrency = parsedInput.concurrency;
      }
   }

   if (parsedInput.rateLimit) {
      if (typeof parsedInput.rateLimit === "boolean") {
         convertedInput.rateLimit = {
            enabled: parsedInput.rateLimit,
            amount: 1,
            duration: 1000
         };
      } else if (typeof parsedInput.rateLimit === "number") {
         convertedInput.rateLimit = {
            amount: parsedInput.rateLimit,
            duration: 1000
         };
      } else {
         convertedInput.rateLimit = parsedInput.rateLimit;
      }
   }

   if (parsedInput.delay) {
      if (typeof parsedInput.delay === "boolean") {
         convertedInput.delay = {
            enabled: parsedInput.delay,
            duration: 1000
         };
      } else if (typeof parsedInput.delay === "number") {
         convertedInput.delay = {
            duration: parsedInput.delay
         };
      } else {
         convertedInput.delay = parsedInput.delay;
      }
   }

   if (parsedInput.priority) {
      if (typeof parsedInput.priority === "number") {
         convertedInput.priority = {
            defaultValue: parsedInput.priority
         };
      } else {
         convertedInput.priority = parsedInput.priority;
      }
   }

   if (parsedInput.removal) {
      if (typeof parsedInput.removal === "boolean") {
         convertedInput.removal = {
            onComplete: {
               always: parsedInput.removal
            },
            onFail: {
               always: parsedInput.removal
            }
         };
      } else {
         convertedInput.removal = parsedInput.removal;
      }
   }

   const converted = DefaultJobOptionsSchema.parse(convertedInput);
   return converted;
};
export const JobOptionsSchema = z.object({
   retries: z.number()
     .optional(),
   delay: z.number()
     .optional(),
   priority: z.number()
     .int()
     .optional(),
   order: z.enum([
        "fifo",
        "lifo"
     ])
     .default("fifo"),
   deduplication: z.object({
        ttl: z.number(),
        id: z.string()
     })
     .nullish(),
   uniqueJobId: z.string()
     .nullish()
});
export type JobOptions = z.infer<typeof JobOptionsSchema>;
export type InpJobOptions = z.input<typeof JobOptionsSchema>;
