import { Workflow } from "@/management/workflow.ts";
import {
   DefaultJobOptions,
   DefaultJobOptionsSchema,
   InpDefaultJobOptions
} from "@/utils/schema.ts";
import Redis from "ioredis";

export type ClientOptions = {
   redisUrl: string;
   prefix?: string;
   defaultJobOptions?: InpDefaultJobOptions;
};

export class OpenQueueClient<
  $Workflows extends Record<string, Workflow<any, any, any>>,
  $WorkflowIds extends keyof $Workflows = keyof $Workflows
> {
   public __jobOptions: DefaultJobOptions;
   public __connection: Redis;
   public readonly __workflows: $Workflows;

   constructor (
     public __options: ClientOptions,
     workflows: $Workflows
   ) {
      this.__jobOptions = DefaultJobOptionsSchema.parse(__options.defaultJobOptions ?? {});
      this.__connection = this.#createConnection();
      this.__workflows = workflows;
   }

   getWorkflow<Id extends $WorkflowIds> (id: Id) {
      return this.__workflows[id];
   }

   async init () {
      return Promise.all(
        Object.values(this.__workflows)
          .map(workflow => workflow.__init(this))
      );
   }

   async start () {
      return Promise.all(
        Object.values(this.__workflows)
          .map(workflow => workflow.__start())
      );
   }

   async pause () {
      // Pause all workflow workers and queues
      await Promise.all(
        Object.values(this.__workflows)
          .map(async workflow => {
             await workflow.__wrapper.pause();
          })
      );
   }

   async stop () {
      // Stop all workflow workers and queues
      await Promise.all(
        Object.values(this.__workflows)
          .map(async workflow => {
             if (workflow.__wrapper.__bullWorker) {
                await workflow.__wrapper.__bullWorker.close();
             }
             if (workflow.__wrapper.__bullQueue) {
                await workflow.__wrapper.__bullQueue.close();
             }
          })
      );
      
      // Close the Redis connection
      await this.__connection.quit();
   }

   __getWorkflows () {
      return Object.values(this.__workflows);
   }

   __getWorkflowsAsQueues () {
      return this.__getWorkflows()
        .map(w => w.__wrapper.__getBullQueue());
   }

   __getConnection () {
      return this.__connection;
   }

   __getDefaultClientJobOptions () {
      return this.__jobOptions;
   }

   #createConnection () {
      const parsed = new URL(this.__options.redisUrl);
      return new Redis({
         host: parsed.hostname,
         port: parseInt(parsed.port),
         password: parsed.password,
         username: parsed.username,
         maxRetriesPerRequest: null,
         lazyConnect: true
      });
   }
}
