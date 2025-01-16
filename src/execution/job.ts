import { JobStateManager } from "@/execution/job-state.ts";
import { Workflow } from "@/management/workflow.ts";
import { Job as BullJob } from "bullmq";

export type ActiveJobOptions = {
   bullJob: BullJob;
   bullToken?: string;
};

export class ActiveJob {
   public __bullJob: BullJob;
   public __bullToken?: string;
   public state: JobStateManager;

   constructor (
     public __workflow: Workflow<any, any, any>,
     options: ActiveJobOptions
   ) {
      this.__bullJob = options.bullJob;
      this.__bullToken = options.bullToken;
      this.state = new JobStateManager(
        __workflow,
        options.bullJob
      );
   }

   async init () {
      await this.state.init();
   }

   async delay (amountMs: number) {
      await this.__bullJob.moveToDelayed(
        Date.now() + amountMs,
        this.__bullToken
      );
   }
}
