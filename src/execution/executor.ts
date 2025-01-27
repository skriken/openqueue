import { ExecutionContext } from "@/execution/ctx.ts";
import {
   JobStateManager,
   StepStateManager
} from "@/execution/job-state.ts";
import { ActiveJob } from "@/execution/job.ts";
import { Workflow } from "@/management/workflow.ts";
import {
   DelayedError,
   UnrecoverableError
} from "bullmq";

type ActiveJobExecutorOptions = {
   job: ActiveJob;
   ctx: ExecutionContext;
   workflow: Workflow<any, any, any>;
};
export type ExecutorFnParams<T> = {
   ctx: ExecutionContext;
   job: ActiveJob;
   data: T;
};
export type ExecutorFn<T> = (params: ExecutorFnParams<T>) => Promise<any>;

export class ActiveJobExecutor {
   public workflow: Workflow<any, any, any>;
   public job: ActiveJob;
   public state: JobStateManager;
   public ctx: ExecutionContext;
   public stepExecutor: StepExecutor;

   constructor (options: ActiveJobExecutorOptions) {
      this.workflow = options.workflow;
      this.job = options.job;
      this.ctx = options.ctx;
      this.state = options.job.state;
      this.stepExecutor = new StepExecutor(this);
   }

   async init () {
      await this.job.init();
      this.ctx.setStepExecutor(this.stepExecutor);
      this.ctx.checkIsReady();
   }

   /**
    * This will call the workflow's function/handler. It will also pass on all needed params for the fn.
    * The result of this is what will be given back to BullMQ's client
    */
   async execute () {
      const {
         job,
         ctx,
         state,
         stepExecutor
      } = this;

      try {
         //> Starting execution
         ctx.log(
           "debug",
           `Started execution of workflow ${ this.workflow.__id }`
         );
         state.start();
         const workflowResult = await this.workflow.__fn({
            ctx: this.ctx,
            job: this.job,
            data: this.job.state.getSourceData()
         });

         //> Marking execution as complete
         state.complete();
         ctx.log(
           "debug",
           `Execution of workflow ${ this.workflow.__id } completed`
         );

         return workflowResult;
      }
      catch (e) {
         if (e instanceof DelayedError) {
            // TODO: Return
            return;
         } else if (e instanceof UnrecoverableError) {
            // TODO: Return
            return;
         }

         ctx.log(
           "error",
           `An error occurred for workflow ${ this.workflow.__id }, error: ${ e?.toString() ?? "N/A" }`,
           {
              error: e?.toString ?? null
           }
         );
      }
      finally {
         this.wrapUp();
         this.state.finish();
         await this.state.updateData();
      }
   }

   wrapUp () {
      const logs = this.ctx.__logs;
      this.state.data!.__logs.push(
        ...logs
      );
   }
}


export type ExecuteStepBaseOptions = {
   id: string;
};
export type ExecuteStepResult<T> = {
   success: boolean;
   ran: boolean;
   result: T;
};
export type ExecuteRunStepOptions<Fn extends () => Promise<any> = () => Promise<any>> =
  ExecuteStepBaseOptions
  & {
   run: Fn;
};
export type ExecuteSleepStepOptions =
  ExecuteStepBaseOptions
  & {
   duration: number;
   stepState?: StepStateManager;
};
export type ExecuteSleepUntilStepOptions =
  ExecuteStepBaseOptions
  & {
   timestamp: number;
};


export class StepExecutor {
   constructor (public jobExecutor: ActiveJobExecutor) {

   }

   async executeRun<
     T,
     Ret extends ExecuteStepResult<any>
   > (options: ExecuteRunStepOptions) {
      const {
         ctx,
         state,
         job
      } = this.jobExecutor;
      const stepState = state.forStep(
        options.id,
        "run"
      );

      if (stepState.data.status === "completed") {
         ctx.log(
           "debug",
           `Skipping step ${ options.id } as it is already completed`
         );

         return {
            success: true,
            ran: false,
            result: stepState.data.result
         } as Ret;
      }

      ctx.log(
        "debug",
        `Executing step ${ options.id }`
      );

      try {
         const stepResult = await options.run() as T;
         stepState.complete(stepResult);
         return {
            success: true,
            ran: true,
            result: stepResult
         } as Ret;
      }
      catch (e) {
         ctx.log(
           "error",
           `An error occurred for step ${ options.id }, error: ${ e?.toString() ?? "N/A" }`,
           {
              error: e?.toString ?? null
           }
         );
         stepState.error(e);

         throw e;
      }
      finally {
         ctx.log(
           "debug",
           `Step ${ options.id } finished (regardless of status)`
         );
      }
   }

   async executeSleep (options: ExecuteSleepStepOptions): Promise<ExecuteStepResult<any>> {
      const {
         ctx,
         job,
         state
      } = this.jobExecutor;
      // We allow this option as we use this function in .sleepUntil()
      const stepState = options.stepState ?? state.forStep(
        options.id,
        "sleep"
      );

      if (stepState.data.status === "delayed") {
         // Already put for sleep, this time we can mark it as complete and procee
         stepState.complete(true);
         return {
            success: true,
            ran: true,
            result: true
         };
      } else {
         // Time to put it to sleep
         stepState.start();
         stepState.data.status = "delayed";

         // Change the job priority so it gets processed after out of delay
         const delayedPriority = this.jobExecutor.workflow.getDefaultJobOptions().priority?.delayDefaultValue ?? 1;
         await job.changePriority(delayedPriority);

         // Moving job to delayed until specified timestamp
         await job.delay(options.duration);
         // Throw an error which BullMQ recognizes as a sign to just not error the job, just delay it
         throw new DelayedError();
      }
   }

   executeSleepUntil (options: ExecuteSleepUntilStepOptions): Promise<ExecuteStepResult<any>> {
      const stepState = this.jobExecutor.state.forStep(
        options.id,
        "sleep-until"
      );

      return this.executeSleep({
         id: options.id,
         duration: options.timestamp - Date.now(),
         stepState
      });
   }

   executeRepeat () {

   }

   executeInvoke () {

   }
}
