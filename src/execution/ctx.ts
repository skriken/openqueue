import {
   ExecuteStepResult,
   StepExecutor
} from "@/execution/executor.ts";
import {
   JobLog,
   JobLogLevel
} from "@/execution/job-state.ts";
import { Workflow } from "@/management/workflow.ts";

export type ExecutionContextOptions = {
   workflow: Workflow;
};

type RunOptions<Fn extends () => Promise<any>> = {
   id: string;
   run: Fn;
};
type SleepOptions = {
   id: string;
   duration: number;
};
type SleepUntilOptions = {
   id: string;
   timestamp: number;
};

export class ExecutionContext {
   public __logs: JobLog[] = [];
   public __stepExecutor: StepExecutor | null = null;

   constructor (public __options: ExecutionContextOptions) {
   }

   async run<
     Fn extends () => Promise<any>,
     T = ReturnType<Fn> extends Promise<infer U> ? U : never
   > (options: RunOptions<Fn>) {
      this.checkIsReady();
      const executed = await this.__stepExecutor!.executeRun<T, ExecuteStepResult<T>>({
         id: options.id,
         run: options.run as Fn
      });

      return executed as ExecuteStepResult<T>;
   }

   sleep (options: SleepOptions) {
      this.checkIsReady();
      return this.__stepExecutor?.executeSleep({
         id: options.id,
         duration: options.duration
      });
   }

   sleepUntil (options: SleepUntilOptions) {
      this.checkIsReady();
      return this.__stepExecutor!.executeSleepUntil({
         id: options.id,
         timestamp: options.timestamp
      });
   }

   repeat () {
      throw new Error("Not implemented");
   }

   invoke () {
      throw new Error("Not implemented");
   }

   setStepExecutor (executor: StepExecutor) {
      this.__stepExecutor = executor;
   }

   checkIsReady () {
      if (!this.__stepExecutor) {
         throw new Error("Step executor is not set");
      }
   }

   log (
     level: JobLogLevel,
     message: string,
     meta = {}
   ) {
      this.__logs.push({
         ts: Date.now(),
         level,
         message,
         metadata: meta || {}
      });
   }
}
