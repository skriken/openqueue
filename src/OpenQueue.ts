import { ExecutorFn } from "@/execution/executor.ts";
import { OpenQueueClient } from "@/management/client.ts";
import {
   Workflow,
   WorkflowOptions
} from "@/management/workflow.ts";
import {
   convertSimplifiedDefaultJobOptions,
   DefaultJobOptionsSchema,
   InpSimplifiedDefaultJobOptions
} from "@/utils";
import { z } from "zod";

// First, let's define a base interface for objects with __id
interface HasId<T extends string> {
   __id: T;
}

// Type that converts a single class/object with __id into {[id]: this}
type ToIdMap<T extends HasId<string>> = {
   [K in T["__id"]]: T;
}

// Type that merges multiple objects with __id into a single object
type MergeIdMaps<T extends HasId<string>[]> = T extends Array<infer U>
                                              ? U extends HasId<string>
                                                ? { [K in U["__id"]]: U }
                                                : never
                                              : never;

export type CreateClientOptions = {
   /**
    * The full redis url to connect to including authentication information
    */
   redisUrl: string;
   /**
    * If you want to use a prefix for all this client's queues. This is useful if you have several queue clients
    * for different purposes.
    */
   prefix?: string;
   /**
    * Set default job options that will apply to all jobs for all queues, unless explicitly overridden in each queue, or
    * when adding a job.
    */
   defaultJobOptions?: InpSimplifiedDefaultJobOptions;
};

export class OpenQueue {
   static createClientFromRecord<
     const Flows extends Record<string, Workflow<any, any, any>>
   > (
     options: CreateClientOptions,
     flows: Flows
   ): OpenQueueClient<Flows> {
      const convertedFromSimplified = convertSimplifiedDefaultJobOptions(options.defaultJobOptions ?? {});
      const parsedJobOptions = DefaultJobOptionsSchema.parse(convertedFromSimplified);

      return new OpenQueueClient<Flows>(
        {
           redisUrl: options.redisUrl,
           prefix: options.prefix,
           defaultJobOptions: parsedJobOptions
        },
        flows
      );
   }

   static createClient<
     const T extends readonly Workflow<any, any, any>[], // make it accept readonly arrays
     Id extends T[number]["__id"] = T[number]["__id"] // extract IDs from the workflows
   > (
     options: CreateClientOptions,
     flows: T
   ) {
      type Converted = {
         [K in Id]: Extract<T[number], {
            __id: K
         }> // map each ID to its corresponding workflow
      };

      const convertedFromSimplified = convertSimplifiedDefaultJobOptions(options.defaultJobOptions ?? {});
      const parsedJobOptions = DefaultJobOptionsSchema.parse(convertedFromSimplified);

      // Create the converted object with proper typing
      const converted = flows.reduce(
        (
          acc,
          flow
        ) => {
           return {
              ...acc,
              [flow.__id]: flow
           };
        },
        {}
      ) as Converted;

      return new OpenQueueClient<Converted>(
        {
           redisUrl: options.redisUrl,
           prefix: options.prefix,
           defaultJobOptions: parsedJobOptions
        },
        converted
      );
   }


   static workflow<
     Id extends string,
     S extends z.AnyZodObject,
     Fn extends ExecutorFn<z.infer<S>> = ExecutorFn<z.infer<S>>
   > (options: WorkflowOptions<Id, S, Fn>) {
      return new Workflow<Id, S, Fn>(options);
   }
}
