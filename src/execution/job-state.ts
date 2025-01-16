import { Workflow } from "@/management/workflow.ts";
import {
   StepStatusSchema,
   StepType,
   StepTypeSchema
} from "@/utils";
import { Job as BullJob } from "bullmq";
import { z } from "zod";

export const JobInvocationSchema = z.object({
   fnId: z.string(),
   stepId: z.string()
});
export const JobMetricsSchema = z.object({
   startedAt: z.number()
     .nullish(),
   completedAt: z.number()
     .nullish(),
   failedAt: z.number()
     .nullish(),
   duration: z.number()
     .nullish(),
   attempts: z.number()
     .default(0)
});
export const JobErrorSchema = z.object({
   stepId: z.string(),
   errorMessage: z.string()
     .nullish(),
   error: z.any()
     .nullish()
});
export const StepStateSchema = z.object({
   type: StepTypeSchema,
   status: StepStatusSchema.default("active"),
   result: z.any()
     .nullish(),
   error: z.any()
     .nullish(),
   metrics: JobMetricsSchema.default({})
});
export type StepState = z.infer<typeof StepStateSchema>;
export type InpStepState = z.input<typeof StepStateSchema>;
export const JobLogLevelSchema = z.enum([
   "debug",
   "info",
   "warn",
   "error"
]);
export type JobLogLevel = z.infer<typeof JobLogLevelSchema>;
export const JobLogSchema = z.object({
   ts: z.number(),
   level: JobLogLevelSchema.default("debug"),
   message: z.string(),
   metadata: z.any()
     .nullish()
});
export type JobLog = z.infer<typeof JobLogSchema>;
export type JobInvocation = z.infer<typeof JobInvocationSchema>;
export type InpJobInvocation = z.input<typeof JobInvocationSchema>;
export const JobStateSchema = z.object({
   /**
    * Indicating that this job data as been prepare & parsed for openqueue usage
    */
   __openqueue: z.boolean(),
   /**
    * The original data coming with the job
    */
   __source: z.any(),
   /**
    * Stored invocation data so when this job is completed, an internal function will resume the step/fn that invoked this
    */
   __invocations: JobInvocationSchema.array()
     .default([]),
   /**
    * Storing of metrics for the entire job
    */
   __metrics: JobMetricsSchema.default({}),
   /**
    * Storing errors for the job
    */
   __errors: JobErrorSchema.array()
     .default([]),
   /**
    * Storing the state of each step. Due to technical limitations, we cannot retrieve all steps in a function
    * as we find out on the go.
    */
   __steps: z.record(
     z.string(),
     StepStateSchema
   ),
   /**
    * Storing logs for the job
    */
   __logs: JobLogSchema.array()
     .default([])
});
export type JobState = z.infer<typeof JobStateSchema>;
export type InpJobState = z.input<typeof JobStateSchema>;

export class JobStateManager {
   public __bullJob: BullJob;
   public __workflow: Workflow<any, any, any>;
   public data: JobState | null = null;
   public steps: Record<string, StepStateManager> = {};

   constructor (
     workflow: Workflow<any, any, any>,
     bullJob: BullJob
   ) {
      this.__bullJob = bullJob;
      this.__workflow = workflow;
   }

   /**
    * Mark the job as started
    */
   start () {
      if (!this.data) {
         throw new Error("Job data is not initialized");
      }

      if (!this.data.__metrics.startedAt) {
         this.data.__metrics.startedAt = Date.now();
      }
   }

   /**
    * Mark the job as complete
    */
   complete () {
      if (!this.data) {
         throw new Error("Job data is not initialized");
      }

      this.data.__metrics.completedAt = Date.now();
   }

   /**
    * Finishes the job, regardless of what happened. This is called either after completion or upon errors
    * during execution. This will wrap up everything and make it ready for saving.
    */
   finish () {
      if (!this.data) {
         throw new Error("Job data is not initialized");
      }

      const stepsData = this.getStepsData();
      this.data.__steps = stepsData;
   }

   getStepsData () {
      const result = {} as Record<string, StepState>;
      for (const stepId in this.steps) {
         result[stepId] = this.steps[stepId].format();
      }

      return result;
   }

   forStep (
     stepId: string,
     type: StepType
   ) {
      if (!this.data) {
         throw new Error("Job data is not initialized");
      }
      const foundExistingManager = this.steps[stepId];
      if (foundExistingManager) {
         return foundExistingManager;
      }

      const foundExistingState = this.data.__steps[stepId];
      const stepManager = new StepStateManager({
         initialData: foundExistingState,
         type: type,
         jobStateManager: this
      });

      this.steps[stepId] = stepManager;
      return stepManager;
   }

   getData () {
      return this.data;
   }

   getSourceData () {
      if (!this.data) {
         throw new Error("Job data is not initialized");
      }

      return this.data.__source;
   }

   parseSourceData (data: any) {
      return this.__workflow.__schema.parse(data);
   }

   __getUntouchedJobData () {
      return this.__bullJob.data;
   }

   __compress (data: any) {
      const str = JSON.stringify(data);
      const compressed = Bun.gzipSync(str);
      return Buffer.from(compressed)
        .toString("hex");
   }

   __decompress (hexString: string) {
      // Convert hex string to Uint8Array
      const compressed = new Uint8Array(Buffer.from(
        hexString,
        "hex"
      ));
      const decompressed = Bun.gunzipSync(compressed);
      const str = new TextDecoder().decode(decompressed);
      return JSON.parse(str);
   }

   async init () {
      const rawData = this.__getUntouchedJobData();
      const prepared = this.prepareData(rawData);
      this.data = prepared.data;

      if (!prepared.wasPrepared) {
         await this.updateData();
      }

      return this;
   }

   async forceRefetchData () {
      const fetchedJob = await this.__workflow.getBullJob(this.__bullJob.id!);
      this.__bullJob = fetchedJob;
      this.data = null;

      await this.init();
      return this;
   }

   async updateData (): Promise<JobState> {
      const data = this.data;
      const parsed = JobStateSchema.parse(data);

      // Checks to prevent infinite nesting
      if (parsed.__source?.["__openqueue"]) {
         throw new Error(`Cannot have source data with __openqueue property`);
      }

      this.data = parsed;
      await this.__bullJob.updateData(parsed);
      return parsed;
   }

   static prepareData (data: any) {
      // First assume the data is already prepared, and to avoid duplication we check this
      const firstParse = JobStateSchema.safeParse(data);
      if (firstParse.success) {
         return {
            wasPrepared: true,
            data: firstParse.data
         };
      }

      const createdJobState = JobStateSchema.parse({
         __openqueue: true,
         __source: data,
         __invocations: [],
         __metrics: {},
         __errors: [],
         __steps: {},
         __logs: []
      } satisfies InpJobState);

      return {
         wasPrepared: false,
         data: createdJobState
      };
   }

   prepareData (data: any) {
      const prepared = JobStateManager.prepareData(data);
      const parsedSourceData = this.parseSourceData(prepared.data.__source);
      prepared.data.__source = parsedSourceData;
      return prepared;
   }
}

export type StepStateManagerOptions = {
   jobStateManager: JobStateManager;
   initialData?: StepState;
   type: StepType;
};

export class StepStateManager {
   public data: StepState;
   public __initialData?: StepState;
   public __jobStateManager: JobStateManager;

   constructor (options: StepStateManagerOptions) {
      this.__initialData = options.initialData;
      this.__jobStateManager = options.jobStateManager;

      if (!this.__initialData) {
         this.data = StepStateSchema.parse({
            type: options.type,
            status: "active",
            result: null,
            error: null,
            metrics: {}
         });
      } else {
         this.data = this.__initialData;
      }
   }

   format () {
      return this.data;
   }

   start () {
      this.data.status = "active";
      this.data.metrics.startedAt = Date.now();
   }

   complete (result: any) {
      this.data.status = "completed";
      this.data.result = result;
      this.data.metrics.completedAt = Date.now();
      this.data.metrics.duration = this.data.metrics.completedAt - (
        this.data.metrics.startedAt ?? Date.now()
      );
   }

   error (e: Error) {
      this.data.status = "failed";
      this.data.error = e?.toString ?? "N/A";
      this.data.metrics.failedAt = Date.now();
   }
}
