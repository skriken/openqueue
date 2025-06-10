import { Workflow } from "@/management/workflow.ts";
import {
   InpJobOptions,
   JobOptions,
   JobOptionsSchema
} from "@/utils/schema.ts";
import {
   Job as BullJob,
   JobsOptions as BullJobsOptions,
   Queue as BullQueue,
   QueueOptions as BullQueueOptions,
   Worker as BullWorker,
   WorkerOptions as BullWorkerOptions
} from "bullmq";

export type WrapperOptions = {
   name: string;
   workflow: Workflow<any, any, any>;
};

export class Wrapper {
   public __workflow: Workflow<any, any, any>;
   public __bullWorker: BullWorker | null = null;
   public __bullQueue: BullQueue | null = null;

   constructor (public __options: WrapperOptions) {
      this.__workflow = this.__options.workflow;
   }

   async init () {
      await this.setupQueue();
      await this.setupWorker();
   }

   async start () {
      if (!this.__bullWorker) {
         throw new Error("Worker not initialized");
      }
      if (!this.__bullQueue) {
         throw new Error("Queue not initialized");
      }

      // We can't await the .run() as it freezes.
      this.__bullQueue.resume();
      this.__bullWorker.run();
      this.__bullWorker.resume();
   }

   async pause () {
      if (this.__bullWorker) {
         await this.__bullWorker.pause();
      }
      if (this.__bullQueue) {
         await this.__bullQueue.pause();
      }
   }

   async stop () {
      if (this.__bullWorker) {
         await this.__bullWorker.close();
      }
      if (this.__bullQueue) {
         await this.__bullQueue.close();
      }
   }

   async setupQueue () {
      if (this.__bullQueue) {
         throw new Error("Queue already exists");
      }

      const globalConcurrency = this.__workflow.getDefaultJobOptions(true).concurrency?.global;
      const queueOptions = this.__generateQueueOptions();
      this.__bullQueue = new BullQueue(
        this.__options.name,
        {
           ...queueOptions,
           connection: this.__workflow.getConnection()
        }
      );

      if (globalConcurrency !== undefined) {
         await this.__bullQueue.setGlobalConcurrency(globalConcurrency);
      }
   }

   async setupWorker () {
      if (this.__bullWorker) {
         throw new Error("Worker already exists");
      }

      const workerOptions = this.__generateWorkerOptions();
      this.__bullWorker = new BullWorker(
        this.__options.name,
        this.__processJob.bind(this),
        {
           ...workerOptions,
           connection: this.__workflow.getConnection()
        }
      );
   }

   async setupJob (_options: InpJobOptions) {
      const jobOptions = this.__generateJobOptions(_options);

      return {
         jobOptions
      };
   }

   async __processJob (
     bullJob: BullJob,
     bullToken?: string
   ) {
      return this.__workflow.processJob(
        bullJob,
        bullToken
      );
   }

   __generateQueueOptions () {
      const defaultOptions = this.__workflow.getDefaultJobOptions(true);
      const bullOptions = {} as NonNullable<BullQueueOptions["defaultJobOptions"]>;

      //> Priority options
      if (defaultOptions?.priority) {
         bullOptions.priority = defaultOptions.priority.defaultValue;
      }

      //> Queue ordering options
      bullOptions.lifo = defaultOptions.order === "lifo";

      //> Retry options
      if (defaultOptions?.retries && defaultOptions.retries.enabled) {
         bullOptions.attempts = defaultOptions.retries.amount;
         bullOptions.backoff = {
            type: defaultOptions.retries.backoff,
            delay: defaultOptions.retries.delay
         };
      }

      //> Removal options
      if (defaultOptions?.removal) {
         if (defaultOptions.removal.onFail) {
            if (defaultOptions.removal.onFail.always) {
               bullOptions.removeOnFail = true;
            } else if (defaultOptions.removal.onFail.afterAmount !== undefined) {
               bullOptions.removeOnFail = {
                  count: defaultOptions.removal.onFail.afterAmount
               };
            } else if (defaultOptions.removal.onFail.age !== undefined) {
               bullOptions.removeOnFail = {
                  age: defaultOptions.removal.onFail.age
               };
            } else {
               throw new Error("Invalid removal options");
            }
         } else {
            bullOptions.removeOnFail = false;
         }

         if (defaultOptions.removal.onComplete) {
            if (defaultOptions.removal.onComplete.always) {
               bullOptions.removeOnComplete = true;
            } else if (defaultOptions.removal.onComplete.afterAmount !== undefined) {
               bullOptions.removeOnComplete = {
                  count: defaultOptions.removal.onComplete.afterAmount
               };
            } else if (defaultOptions.removal.onComplete.age !== undefined) {
               bullOptions.removeOnComplete = {
                  age: defaultOptions.removal.onComplete.age
               };
            }
         } else {
            bullOptions.removeOnComplete = false;
         }
      }

      return {
         bullOptions
      };
   }

   __generateWorkerOptions () {
      const defaultOptions = this.__workflow.getDefaultJobOptions(true);
      const bullOptions = {
         autorun: false, // We want to start the worker manually
      } as NonNullable<BullWorkerOptions>;

      if (defaultOptions.concurrency && defaultOptions.concurrency.enabled) {
         bullOptions.concurrency = defaultOptions.concurrency.local;
      }

      if (defaultOptions.rateLimit && defaultOptions.rateLimit.enabled) {
         bullOptions.limiter = {
            max: defaultOptions.rateLimit.amount,
            duration: defaultOptions.rateLimit.duration
         };
      }

      return bullOptions;
   }

   __generateJobOptions (_jobOptions: JobOptions | InpJobOptions) {
      const jobOptions = JobOptionsSchema.parse(_jobOptions);
      const defaultOptions = this.__workflow.getDefaultJobOptions(true);
      const bullOptions = {
         priority: jobOptions?.priority ?? defaultOptions.priority?.defaultValue ?? 2,
         lifo: (
           jobOptions?.order === "lifo"
         ) || (
           defaultOptions.order === "lifo"
         ),
         deduplication: jobOptions.deduplication ? (
           {
              ttl: jobOptions.deduplication.ttl,
              id: jobOptions.deduplication.id
           }
         ) : undefined,
         jobId: jobOptions.uniqueJobId
      } as BullJobsOptions;

      if (jobOptions.delay || defaultOptions.delay?.enabled) {
         bullOptions.delay = jobOptions.delay ?? defaultOptions.delay?.duration;
      }

      if (jobOptions.retries || defaultOptions.retries?.enabled) {
         bullOptions.attempts = jobOptions.retries ?? defaultOptions.retries?.amount;
      } else {
         bullOptions.attempts = 0;
      }

      return bullOptions;
   }

   __getBullQueue () {
      if (!this.__bullQueue) {
         throw new Error("Queue not initialized");
      }

      return this.__bullQueue;
   }
}
