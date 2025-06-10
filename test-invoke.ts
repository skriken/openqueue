import { OpenQueue } from "./src/index.ts";
import { z } from "zod";

// Simple test to verify invoke functionality

// Define schemas
const taskBSchema = z.object({
  number: z.number()
});

const taskCSchema = z.object({
  text: z.string()
});

const taskASchema = z.object({
  value: z.number(),
  message: z.string()
});

// Create task B - doubles a number
const taskB = OpenQueue.workflow({
  id: "task-b",
  schema: taskBSchema,
  fn: async ({ ctx, data }) => {
    console.log(`[Task B] Received number: ${data.number}`);
    
    const result = await ctx.run({
      id: "double-number",
      run: async () => {
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 1000));
        return data.number * 2;
      }
    });
    
    console.log(`[Task B] Returning: ${result.result}`);
    return result.result;
  }
});

// Create task C - reverses a string
const taskC = OpenQueue.workflow({
  id: "task-c",
  schema: taskCSchema,
  fn: async ({ ctx, data }) => {
    console.log(`[Task C] Received text: ${data.text}`);
    
    const result = await ctx.run({
      id: "reverse-text",
      run: async () => {
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 1000));
        return data.text.split('').reverse().join('');
      }
    });
    
    console.log(`[Task C] Returning: ${result.result}`);
    return result.result;
  }
});

// Create task A - orchestrates B and C
const taskA = OpenQueue.workflow({
  id: "task-a",
  schema: taskASchema,
  fn: async ({ ctx, data }) => {
    console.log(`[Task A] Starting with value: ${data.value}, message: ${data.message}`);
    
    // Run task B
    console.log(`[Task A] Invoking task B...`);
    const resultB = await ctx.invoke({
      id: "call-task-b",
      workflow: "task-b",
      data: { number: data.value }
    });
    
    console.log(`[Task A] Task B returned: ${resultB.result}`);
    
    // Run task C
    console.log(`[Task A] Invoking task C...`);
    const resultC = await ctx.invoke({
      id: "call-task-c",
      workflow: "task-c",
      data: { text: data.message }
    });
    
    console.log(`[Task A] Task C returned: ${resultC.result}`);
    
    // Combine results
    const finalResult = {
      doubledValue: resultB.result,
      reversedMessage: resultC.result,
      combined: `${resultC.result} -> ${resultB.result}`
    };
    
    console.log(`[Task A] Final result:`, finalResult);
    return finalResult;
  }
});

// Run the test
async function runTest() {
  console.log("=== OpenQueue Invoke Test ===\n");
  
  // Create client
  const client = OpenQueue.createClient(
    {
      redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
      defaultJobOptions: {
        retries: 0 // Disable retries for testing
      }
    },
    [taskA, taskB, taskC]
  );
  
  try {
    // Initialize and start
    console.log("Initializing client...");
    await client.init();
    await client.start();
    console.log("Client started successfully\n");
    
    // Create a job in task A
    console.log("Creating job in task A...");
    const { bullJob } = await client.getWorkflow("task-a").createJob({
      value: 21,
      message: "Hello World"
    });
    
    console.log(`Created job ${bullJob.id}\n`);
    console.log("Waiting for job completion...\n");
    
    // Poll for completion
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout
    
    while (attempts < maxAttempts) {
      const job = await client.getWorkflow("task-a").getBullJob(bullJob.id!);
      const state = await job.getState();
      
      if (state === "completed") {
        console.log("\n✅ Job completed successfully!");
        console.log("Result:", JSON.stringify(job.returnvalue, null, 2));
        break;
      } else if (state === "failed") {
        console.error("\n❌ Job failed!");
        const failedReason = job.failedReason;
        console.error("Error:", failedReason);
        break;
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (attempts >= maxAttempts) {
      console.error("\n❌ Job timed out!");
    }
    
  } catch (error) {
    console.error("\n❌ Test failed with error:", error);
  } finally {
    console.log("\nStopping client...");
    await client.stop();
    console.log("Client stopped");
    process.exit(0);
  }
}

// Run the test
runTest().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});