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

      let workflowResult: any;
      
      try {
         //> Starting execution
         ctx.log(
           "debug",
           `Started execution of workflow ${ this.workflow.__id }`
         );
         state.start();
         workflowResult = await this.workflow.__fn({
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

         //> Handle invocations - notify waiting jobs
         if (state.data?.__invocations && state.data.__invocations.length > 0) {
            ctx.log(
              "debug",
              `Processing ${state.data.__invocations.length} invocations for completed job ${job.__bullJob.id}`
            );
            
            for (const invocation of state.data.__invocations) {
               try {
                  ctx.log(
                    "debug",
                    `Processing invocation from workflow ${invocation.fnId}, step ${invocation.stepId}`
                  );
                  
                  // Get the workflow that invoked this job
                  const invokerWorkflow = this.workflow.__client?.__workflows[invocation.fnId];
                  if (!invokerWorkflow) {
                     ctx.log(
                       "error",
                       `Could not find invoker workflow ${invocation.fnId}`
                     );
                     continue;
                  }

                  // Resume the waiting job by moving it out of delayed state
                  const waitingJobs = await invokerWorkflow.__wrapper.__getBullQueue().getDelayed();
                  ctx.log(
                    "debug",
                    `Found ${waitingJobs.length} delayed jobs in workflow ${invocation.fnId}`
                  );
                  
                  for (const waitingJob of waitingJobs) {
                     // Parse the job state properly
                     const rawJobData = waitingJob.data;
                     const preparedData = JobStateManager.prepareData(rawJobData);
                     const jobState = preparedData.data;
                     
                     if (jobState.__openqueue && jobState.__steps && jobState.__steps[invocation.stepId]) {
                        const stepState = jobState.__steps[invocation.stepId];
                        ctx.log(
                          "debug",
                          `Checking step ${invocation.stepId}: status=${stepState.status}, jobId=${stepState.result?.jobId}`
                        );
                        
                        if (stepState.status === "delayed" && stepState.result?.jobId === job.__bullJob.id) {
                           // Move the job back to waiting queue
                           await waitingJob.promote();
                           ctx.log(
                             "debug",
                             `Promoted waiting job ${waitingJob.id} for step ${invocation.stepId}`
                           );
                           break;
                        }
                     }
                  }
               } catch (e) {
                  ctx.log(
                    "error",
                    `Error processing invocation: ${e?.toString() ?? "N/A"}`
                  );
               }
            }
         }
      }
      catch (e) {
         if (e instanceof DelayedError) {
            // Re-throw DelayedError so BullMQ can handle it properly
            throw e;
         } else if (e instanceof UnrecoverableError) {
            // Re-throw UnrecoverableError so BullMQ can handle it properly
            throw e;
         }

         ctx.log(
           "error",
           `An error occurred for workflow ${ this.workflow.__id }, error: ${ e?.toString() ?? "N/A" }`,
           {
              error: e?.toString ?? null
           }
         );
         // Re-throw other errors
         throw e;
      }
      finally {
         this.wrapUp();
         this.state.finish();
         await this.state.updateData();
      }
      
      // Return the workflow result after all processing is complete
      return workflowResult;
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
export type ExecuteInvokeStepOptions<T = any> =
  ExecuteStepBaseOptions
  & {
   workflow: string;
   data: T;
};
export type ExecuteRepeatStepOptions<Fn extends () => Promise<any> = () => Promise<any>> =
  ExecuteStepBaseOptions
  & {
   limit: number;
   every?: number;
   run: Fn;
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
         await this.jobExecutor.state.updateData();
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
         const error = e instanceof Error ? e : new Error(String(e));
         stepState.error(error);
         await this.jobExecutor.state.updateData();

         throw error;
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
         await this.jobExecutor.state.updateData();
         return {
            success: true,
            ran: true,
            result: true
         };
      } else {
         // Time to put it to sleep
         stepState.start();
         stepState.data.status = "delayed";
         await this.jobExecutor.state.updateData();

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

   async executeRepeat<T = any> (options: ExecuteRepeatStepOptions): Promise<ExecuteStepResult<T | false>> {
      const {
         ctx,
         job,
         state
      } = this.jobExecutor;
      const stepState = state.forStep(
        options.id,
        "repeat"
      );

      if (stepState.data.status === "completed") {
         ctx.log(
           "debug",
           `Skipping repeat step ${ options.id } as it is already completed`
         );

         return {
            success: true,
            ran: false,
            result: stepState.data.result as T | false
         };
      }

      // Initialize or retrieve repeat state
      let repeatState = stepState.data.result as {
         attempt: number;
         lastResult: T | false;
         completed: boolean;
         needsDelay?: boolean;
      } | undefined;

      if (!repeatState) {
         repeatState = {
            attempt: 0,
            lastResult: false,
            completed: false
         };
         stepState.start();
         stepState.data.result = repeatState;
         await this.jobExecutor.state.updateData();
      }

      // Check if we're resuming from a delay
      if (stepState.data.status === "delayed" && repeatState.needsDelay) {
         // We're back from a delay, clear the flag
         repeatState.needsDelay = false;
         stepState.data.status = "active";
         stepState.data.result = repeatState;
         await this.jobExecutor.state.updateData();
      }

      // Check if we've exceeded the limit
      if (repeatState.attempt >= options.limit) {
         // All attempts exhausted, return false
         stepState.complete(false);
         await this.jobExecutor.state.updateData();
         
         ctx.log(
           "debug",
           `Repeat step ${ options.id } failed after ${ options.limit } attempts`
         );

         return {
            success: true,
            ran: true,
            result: false
         };
      }

      ctx.log(
        "debug",
        `Executing repeat step ${ options.id }, attempt ${ repeatState.attempt + 1 }/${ options.limit }`
      );

      try {
         // Execute the run function
         const result = await options.run() as T;
         repeatState.attempt++;
         repeatState.lastResult = result;

         // Check if the result is truthy (indicates success)
         if (result) {
            // Success! Mark as completed with the truthy value
            stepState.complete(result);
            await this.jobExecutor.state.updateData();
            
            ctx.log(
              "debug",
              `Repeat step ${ options.id } succeeded on attempt ${ repeatState.attempt }`
            );

            return {
               success: true,
               ran: true,
               result: result
            };
         }

         // Result was falsy, we need to retry
         ctx.log(
           "debug",
           `Repeat step ${ options.id } attempt ${ repeatState.attempt } returned falsy value, will retry`
         );

         // Check if we need to delay before next attempt
         if (options.every && options.every > 0 && repeatState.attempt < options.limit) {
            // Mark that we need a delay
            repeatState.needsDelay = true;
            stepState.data.result = repeatState;
            stepState.data.status = "delayed";
            await this.jobExecutor.state.updateData();
            
            // Move job to delayed state
            await job.delay(options.every);
            throw new DelayedError();
         }

         // Update state for next attempt (no delay case)
         stepState.data.result = repeatState;
         stepState.data.status = "active";
         await this.jobExecutor.state.updateData();

         // Self-invoke to continue immediately
         return this.executeRepeat(options);
      }
      catch (e) {
         if (e instanceof DelayedError) {
            throw e;
         }
         
         if (e instanceof UnrecoverableError) {
            // UnrecoverableError should fail immediately without retry
            ctx.log(
              "error",
              `Unrecoverable error in repeat step ${ options.id }: ${ e?.toString() ?? "N/A" }`
            );
            stepState.error(e);
            stepState.data.status = "failed";
            await this.jobExecutor.state.updateData();
            throw e;
         }
         
         ctx.log(
           "error",
           `Error in repeat step ${ options.id }: ${ e?.toString() ?? "N/A" }`
         );
         const error = e instanceof Error ? e : new Error(String(e));
         stepState.error(error);
         await this.jobExecutor.state.updateData();
         throw error;
      }
   }

   async executeInvoke<T = any, R = any> (options: ExecuteInvokeStepOptions<T>): Promise<ExecuteStepResult<R>> {
      const {
         ctx,
         job,
         state
      } = this.jobExecutor;
      const stepState = state.forStep(
        options.id,
        "invoke-wait-for-result"
      );

      if (stepState.data.status === "completed") {
         ctx.log(
           "debug",
           `Skipping invoke step ${ options.id } as it is already completed`
         );

         return {
            success: true,
            ran: false,
            result: stepState.data.result as R
         };
      }

      if (stepState.data.status === "delayed") {
         // We're resuming from a delay, check if the invoked job is complete
         const invokedJobId = stepState.data.result?.jobId;
         if (!invokedJobId) {
            throw new Error(`No invoked job ID found for step ${ options.id }`);
         }

         ctx.log(
           "debug",
           `Resuming invoke step ${ options.id }, checking job ${ invokedJobId } in workflow ${ options.workflow }`
         );

         // Get the target workflow
         const targetWorkflow = this.jobExecutor.workflow.__client?.__workflows[options.workflow];
         if (!targetWorkflow) {
            throw new Error(`Workflow ${ options.workflow } not found`);
         }

         // Check if the invoked job is complete
         const invokedJob = await targetWorkflow.getBullJob(invokedJobId);
         if (!invokedJob) {
            throw new Error(`Invoked job ${ invokedJobId } not found`);
         }

         const jobState = await invokedJob.getState();
         ctx.log(
           "debug",
           `Invoked job ${ invokedJobId } state: ${ jobState }`
         );
         
         if (jobState === "completed") {
            // Get the result and mark step as complete
            const result = invokedJob.returnvalue as R;
            stepState.complete(result);
            await this.jobExecutor.state.updateData();
            
            ctx.log(
              "debug",
              `Invoke step ${ options.id } completed with result from job ${ invokedJobId }`
            );

            return {
               success: true,
               ran: true,
               result
            };
         } else if (jobState === "failed") {
            const error = new Error(`Invoked job ${ invokedJobId } failed`);
            stepState.error(error);
            await this.jobExecutor.state.updateData();
            throw error;
         } else {
            // Job is still running, delay again
            ctx.log(
              "debug",
              `Job ${ invokedJobId } still in state ${ jobState }, delaying again`
            );
            await job.delay(1000); // Check again in 1 second
            throw new DelayedError();
         }
      }

      // First time invoking - create the job in the target workflow
      ctx.log(
        "debug",
        `Invoking workflow ${ options.workflow } from step ${ options.id }`
      );

      try {
         // Get the target workflow
         const targetWorkflow = this.jobExecutor.workflow.__client?.__workflows[options.workflow];
         if (!targetWorkflow) {
            throw new Error(`Workflow ${ options.workflow } not found`);
         }

         // Create the job in the target workflow
         const { bullJob: invokedJob } = await targetWorkflow.createJob(options.data);

         // Store the invoked job ID in our step state
         stepState.start();
         stepState.data.result = { jobId: invokedJob.id };
         stepState.data.status = "delayed";
         await this.jobExecutor.state.updateData();

         // Add invocation info to the invoked job so it knows to notify us when done
         const invokedJobData = invokedJob.data;
         const preparedInvokedData = JobStateManager.prepareData(invokedJobData);
         
         if (preparedInvokedData.data.__openqueue) {
            preparedInvokedData.data.__invocations.push({
               fnId: this.jobExecutor.workflow.__id,
               stepId: options.id
            });
            await invokedJob.updateData(preparedInvokedData.data);
            
            ctx.log(
              "debug",
              `Added invocation info to job ${ invokedJob.id }: workflow=${ this.jobExecutor.workflow.__id }, step=${ options.id }`
            );
         }

         ctx.log(
           "debug",
           `Created job ${ invokedJob.id } in workflow ${ options.workflow } for step ${ options.id }`
         );

         // Delay this job to wait for the invoked job
         await job.delay(1000); // Check again in 1 second
         throw new DelayedError();
      }
      catch (e) {
         if (e instanceof DelayedError) {
            throw e;
         }
         
         ctx.log(
           "error",
           `Error invoking workflow ${ options.workflow } from step ${ options.id }: ${ e?.toString() ?? "N/A" }`
         );
         const error = e instanceof Error ? e : new Error(String(e));
         stepState.error(error);
         await this.jobExecutor.state.updateData();
         throw error;
      }
   }
}
