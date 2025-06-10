import { z } from "zod";
import { OpenQueue } from "../src";
const createUser = OpenQueue.workflow({
  id: "create-user",
  schema: z.object({
    name: z.string(),
    email: z.string().email(),
    password: z.string().min(8).max(100),
  }),
  async fn({ ctx, data }) {
    console.log("creating password");
    const password = await ctx.invokeWorkflow(createPassword, {
      data: {
        password: data.password,
      },
      id: "gen-pwd",
    });

    console.log("emailing");
    const emailed = await ctx.run({
      id: "send-email",
      async run() {
        return {
          resendId: "123",
        };
      },
    });

    const created = {
      userId: Date.now().toString(),
      email: emailed,
      password,
    };

    console.log(JSON.stringify(created));
  },
});

const createPassword = OpenQueue.workflow({
  id: "create-password",
  schema: z.object({
    password: z.string(),
  }),
  async fn({ ctx, data }) {
    const hashed = await Bun.password.hash(data.password);
    return hashed;
  },
});

const client = OpenQueue.createClient(
  {
    redisUrl: process.env.REDIS_URL,
  },
  [createPassword, createUser],
);

await client.init();
await client.start();


const created = await client.getWorkflow("create-user").createJob({
  name: "Martin",
  email: "m@xnx.no",
  password: "Lolo12345",
});

console.log(created);
