## OpenQueue

A very simple & opinionated workflow library built on top of BullMQ (Redis), with Inngest-like DX.

### Tell me more

Although I've loved using services like Inngest and Trigger.dev they are not self-host friendly, and if I needed
to make a workflow system for my projects, I either had to pay $$ to have good developer experience, or I had to use
BullMQ directly, which works but there's a lot of boilerplate code to write and doesn't provide native durable
step system.

That's why with this I've made it super simple for myself to setup a workflow system which supports durable steps &
execution. All you need to do is setup a redis instance, use the library, define a function and start it all.

### Benefits with OpenQueue over services like Inngest or Trigger.dev

- You can self-host everything
- No need to pay enormous amounts of money if you want a simple & robust workflow system
    - I.e. in one of my cases I wanted to setup a workflow for processing millions of entities every week, this would
      have easily cost me thousands of $
- Built on top of BullMQ, which has been an industry standard for a long time for queues with Redis
- Super easy to get started

### Comparison in code

```typescript
// Inngest

const app = express();
const Inngest = new Inngest({ id: "my-app" });
const helloWorld = Inngest.createFucntion(
  { id: "hello-world" },
  { event: "test/hello.world" },
  async ({
     event,
     step
  }) => {
     await step.sleep(
       "wait-a-moment",
       "1s"
     );
  }
);

app.use(
  "/api",
  Inngest.serve({ functions: [ helloWorld ] })
);

Inngest.send({
   name: "test/hello.world"
})
```

```typescript
// OpenQueue

const helloWorld = OpenQueue.workflow({
   id: "hello-world",
   schema: z.object({
      name: z.string()
   }),
   fn: async ({
      ctx,
      job,
      data
   }) => {
      await ctx.sleep({
         id: "wait-a-moment",
         duration: 1000
      });

      await ctx.run({
         id: "send-mail",
         async run () {
            console.log("Hello, world!");
         },
         async rollback () {
            console.log("Oops, undo that!")
         }
      });

      return {
         greeted: `Hello, ${ data.name }`
      };
   }
});

const workflows = OpenQueue.createClient({
   redisUrl: "redis://",
   workflows: [
      helloWorld
   ]
});

workflows.invoke(
  helloWorld,
  {
     name: "John Doe"
  }
);
```

### Getting started

#### Installing

```bash
bun add openqueue
```

#### Creating a workflow

```typescript
const greetNewUser = OpenQueue.workflow({
   id: "greet-new-user",
   schema: z.object({
      userId: z.string()
   }),
   async handle ({
      ctx,
      job,
      data
   }) {
      // Don't recommend putting things that reqire live data in steps, in case you were to retry them
      // Remember each time a job gets run again everything outside of the step scopes will be re-run (i.e. db calls)
      const user = await db.getUser();

      await ctx.run({
         id: "send-mail",
         async run () {
            return resend.sendEmail({
               from: "my@email.com",
               to: user.email,
               subject: "Welcome to my app",
               body: `Hello, ${ user.name }`
            });
         }
      });

      await ctx.sleep({
         id: "wait-1-day",
         duration: 864_000_000
      });

      const checkSubscription = await ctx.repeat({
         id: "check-subscription-for-7-days",
         limit: 7,
         every: 864_000_000,
         run: async () => {
            const hasSubscribed = await db.hasUserSubscribed();
            if (hasSubscribed) {

               // Returning a truthy value will mark the repeat step as complete, and will not repeat anymore.
               return {
                  finally: "subscribed"
               };
            }

            // Return falsy value to indicate it's not done
            return false;
         }
      });

      if (!checkSubscription) {
         // User didn't subscribe after 7 days
         await sendFollowUpEmail(user.email);
      }

      return {
         userId: data.userId,
         subscribed: !!checkSubscription
      };
   }
});
```

#### Setting up the client

```typescript
const workflows = OpenQueue.createClient({
   redisUrl: "redis://",
   workflows: [
      greetNewUser
   ]
});

// This will set up the workflows (and their bullmq queues/workers)
// It will not yet start the worker
await workflows.init();
// This will start the worker for processing jobs
await workflows.start();
```

#### Adding a job

```typescript
workflows.invoke(
  greetNewUser,
  {
     userId: "123"
  }
);
```

#### How does it work?

All the heavy lifting is done by [BullMQ](https://bullmq.io), and OpenQueue is just a simple layer on top to make the
developer experience. (It's a wrapper 😱). Explained simply, a workflow in openqueue is a layer on top of both a BullMQ
queue & worker.

When a job is added to the queue, the BullMQ worker will make openqueue process it. Internally, OpenQueue will parse the
job data and prepare it for use. It will then prepare a execution context, tied to the job & workflow, and whenever you
in your code call i.e. `ctx.run()` it will call the executor. This in turn will check for the
previous state by the step `id`. If it's already done, there is no need to redo the step, and it will return the
previously executed result.

## Future

I'm pretty sure this can be expanded on, adding more features. Some ideas I've had are:

- different steps (sleep, wait for event, wait for other job to complete, repeatable steps)
- different execution, in addition to publishing events which queues can subscribe to
- portal that is easy to self-host, simply `openqueue panel start` and full overview of queues, jobs and analytics
- integrate jobs into databases like Postgres. that way it's easy to move finished jobs to database for improved
  querying and to keep track of historical jobs
- much better DX
