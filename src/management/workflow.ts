import { ExecutionContext } from "@/execution/ctx.ts";
import {
   ActiveJobExecutor,
   ExecutorFn
} from "@/execution/executor.ts";
import { JobStateManager } from "@/execution/job-state.ts";
import { ActiveJob } from "@/execution/job.ts";
import { OpenQueueClient } from "@/management/client.ts";
import { Wrapper } from "@/management/wrapper.ts";
import {
   convertSimplifiedDefaultJobOptions,
   DefaultJobOptions,
   InpJobOptions,
   InpSimplifiedDefaultJobOptions
} from "@/utils/schema.ts";
import { deepmerge } from "@/utils/fns.ts";
import { Job as BullJob } from "bullmq";
import { z } from "zod";

export type WorkflowOptions<
  Id extends string,
  S extends z.AnyZodObject,
  Fn extends ExecutorFn<z.infer<S>>,
> = {
   id: Id;
   schema: S;
   fn: Fn;
   onError?: (error: any) => Promise<any>;
   jobOptions?: InpSimplifiedDefaultJobOptions;
};

export class Workflow<
  Id extends string = string,
  S extends z.AnyZodObject = z.AnyZodObject,
  Fn extends ExecutorFn<z.infer<S>> = ExecutorFn<z.infer<S>>
> {
   public __id: Id;
   public __schema: S;
   public __fn: Fn;
   public __onError?: any;
   public __jobOptions: DefaultJobOptions;
   public __client: OpenQueueClient<any> | null = null;
   public __wrapper: Wrapper;

   constructor (options: WorkflowOptions<Id, S, Fn>) {
      this.__id = options.id;
      this.__schema = options.schema;
      this.__fn = options.fn;
      this.__onError = options.onError;
      this.__jobOptions = convertSimplifiedDefaultJobOptions(options.jobOptions ?? {});
      this.__wrapper = new Wrapper({
         name: this.__id,
         workflow: this
      });
   }

   format<T extends { [K in Id]: Workflow<Id, S, Fn> }> (): T {
      return {
         [this.__id]: this
      } as unknown as T;
   }

   async __init (client: OpenQueueClient<any>) {
      this.__client = client;
      await this.__wrapper.init();
   }

   async __start () {
      await this.__wrapper.start();
   }

   async createJob (
     data: z.input<S>,
     options: InpJobOptions = {}
   ) {
      const jobOptions = this.__wrapper.__generateJobOptions(options);
      const parsedData = this.__schema.parse(data);
      const prepared = JobStateManager.prepareData(parsedData);

      const createdBullJob = await this.__wrapper.__bullQueue!.add(
        "default",
        prepared.data,
        jobOptions
      );

      return {
         bullJob: createdBullJob
      };
   }

   async createJobs (entries: Array<{
      data: z.input<S>;
      options: InpJobOptions;
   }>) {
      const preparedJobs = entries.map(entry => (
        {
           name: "default",
           data: JobStateManager.prepareData(this.__schema.parse(entry.data)).data,
           opts: this.__wrapper.__generateJobOptions(entry.options)
        }
      ));

      const added = await this.__wrapper.__bullQueue!.addBulk(preparedJobs);

      return {
         bulkBullJobs: added
      };
   }

   async getActiveJob (id: string) {
      const bullJob = await this.getBullJob(id);
      const activeJob = new ActiveJob(
        this,
        {
           bullJob,
           bullToken: bullJob.token
        }
      );
      await activeJob.init();

      return activeJob;
   }

   async getBullJob (id: string): Promise<BullJob> {
      return this.__wrapper.__getBullQueue()
        .getJob(id);
   }

   async processJob (
     bullJob: BullJob,
     bullToken?: string
   ) {
      // console.log(`[Workflow ${ this.__id }]: Processing job ${ bullJob.id }`);
      const activeJob = new ActiveJob(
        this,
        {
           bullJob,
           bullToken
        }
      );
      const ctx = new ExecutionContext({
         workflow: this
      });
      const executor = new ActiveJobExecutor({
         job: activeJob,
         ctx,
         workflow: this
      });

      await executor.init();
      return executor.execute();
   }

   getDefaultJobOptions (withClientDefaults = false) {
      const thisDefault = this.__jobOptions;

      if (withClientDefaults && this.__client) {
         return deepmerge(
           this.__client.__getDefaultClientJobOptions(),
           thisDefault
         );
      }

      return thisDefault;
   }

   getConnection () {
      if (!this.__client) {
         throw new Error("Client not initialized");
      }

      return this.__client.__getConnection();
   }
}
