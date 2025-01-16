import { OpenQueueClient } from "@/management/client.ts";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { showRoutes } from "hono/dev";

export const runBullUiServer = async (client: OpenQueueClient<any>) => {
   const queues = client.__getWorkflowsAsQueues();

   const serverAdapter = new HonoAdapter(serveStatic);
   const app = new Hono();
   const connection = client.__getConnection();
   const bullUiQueues = queues.map(q => new BullMQAdapter(q!));

   createBullBoard({
      queues: bullUiQueues,
      serverAdapter
   });

   serverAdapter.setBasePath("/ui");

   app.route(
     "/ui",
     serverAdapter.registerPlugin()
   );

   showRoutes(app);

   serve(
     {
        fetch: app.fetch,
        port: 3010
     },
     ({
        address,
        port
     }) => {
        console.log(`Bull UI is running at http://${ address }:${ port }`);
     }
   );
};
