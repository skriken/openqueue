import {
   ExecuteStepResult,
   StepExecutor
} from "@/execution/executor.ts";
import {
   JobLog,
   JobLogLevel
} from "@/execution/job-state.ts";
import { Workflow } from "@/management/workflow.ts";
import { ExecutorFn } from "@/execution/executor.ts";
import { z } from "zod";

// Type helper to extract the return type of a workflow
export type ExtractWorkflowReturn<W> = W extends Workflow<any, any, infer Fn>
  ? Awaited<ReturnType<Fn>>
  : never;

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
type InvokeOptions<T = any> = {
   id: string;
   workflow: string;
   data: T;
};
type InvokeWorkflowOptions<W extends Workflow<any, any, any>> = {
   id: string;
   data: z.input<W["__schema"]>;
};
type RepeatOptions<Fn extends () => Promise<any>> = {
   id: string;
   limit: number;
   every?: number;
   run: Fn;
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

   async repeat<
     Fn extends () => Promise<any>,
     T = ReturnType<Fn> extends Promise<infer U> ? U : never
   > (options: RepeatOptions<Fn>): Promise<T | false> {
      this.checkIsReady();
      const result = await this.__stepExecutor!.executeRepeat<T>({
         id: options.id,
         limit: options.limit,
         every: options.every,
         run: options.run
      });
      return result.result;
   }

   // Basic invoke method (backward compatibility)
   async invoke<T = any, R = any> (options: InvokeOptions<T>): Promise<ExecuteStepResult<R>> {
      this.checkIsReady();
      return this.__stepExecutor!.executeInvoke<T, R>({
         id: options.id,
         workflow: options.workflow,
         data: options.data
      });
   }

   // Type-safe method that accepts a workflow instance
   async invokeWorkflow<W extends Workflow<any, any, any>>(
      workflow: W,
      options: {
         id: string;
         data: z.input<W["__schema"]>;
      }
   ): Promise<ExtractWorkflowReturn<W>> {
      this.checkIsReady();
      const result = await this.__stepExecutor!.executeInvoke({
         id: options.id,
         workflow: workflow.__id,
         data: options.data
      });
      return result.result as ExtractWorkflowReturn<W>;
   }

   // Overloaded invoke method that accepts a workflow reference for type safety
   async invokeTyped<W extends Workflow<any, any, any>>(
      workflow: W,
      options: {
         id: string;
         data: z.input<W["__schema"]>;
      }
   ): Promise<ExtractWorkflowReturn<W>> {
      return this.invokeWorkflow(workflow, options);
   }

   // Type-safe helper to get workflow from current client
   getWorkflow<WId extends string>(workflowId: WId): Workflow<any, any, any> | null {
      const client = this.__options.workflow.__client;
      if (!client) {
         return null;
      }
      
      return client.__workflows[workflowId] || null;
   }

   // Type-safe invoke by getting workflow from client
   async invokeById<WId extends string>(
      workflowId: WId,
      options: {
         id: string;
         data: any; // We can't infer the type without the workflow reference
      }
   ): Promise<any> {
      const workflow = this.getWorkflow(workflowId);
      if (!workflow) {
         throw new Error(`Workflow ${workflowId} not found`);
      }
      
      return this.invokeWorkflow(workflow, options);
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
