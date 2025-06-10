import { OpenQueue } from "../src/index.ts";
import { z } from "zod";

// Define schemas for each workflow
const workflowBSchema = z.object({
  message: z.string(),
  value: z.number()
});

const workflowCSchema = z.object({
  text: z.string(),
  multiplier: z.number()
});

const workflowASchema = z.object({
  initialValue: z.number(),
  message: z.string()
});

// Create workflow B - performs a calculation
const workflowB = OpenQueue.workflow({
  id: "workflow-b",
  schema: workflowBSchema,
  fn: async ({ ctx, data }) => {
    console.log(`[Workflow B] Processing: ${data.message}`);
    
    // Simulate some work
    await ctx.run({
      id: "calculate",
      run: async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return data.value * 2;
      }
    });
    
    const result = {
      processedMessage: `B processed: ${data.message}`,
      calculatedValue: data.value * 2
    };
    
    console.log(`[Workflow B] Completed with result:`, result);
    return result;
  }
});

// Create workflow C - performs text processing
const workflowC = OpenQueue.workflow({
  id: "workflow-c",
  schema: workflowCSchema,
  fn: async ({ ctx, data }) => {
    console.log(`[Workflow C] Processing: ${data.text}`);
    
    // Simulate some work
    await ctx.run({
      id: "process-text",
      run: async () => {
        await new Promise(resolve => setTimeout(resolve, 1500));
        return data.text.toUpperCase();
      }
    });
    
    const result = {
      processedText: data.text.toUpperCase(),
      multipliedValue: data.multiplier * 10
    };
    
    console.log(`[Workflow C] Completed with result:`, result);
    return result;
  }
});

// Create workflow A - orchestrates B and C
const workflowA = OpenQueue.workflow({
  id: "workflow-a",
  schema: workflowASchema,
  fn: async ({ ctx, data }) => {
    console.log(`[Workflow A] Starting orchestration with:`, data);
    
    // Invoke workflow B
    const resultB = await ctx.invoke({
      id: "invoke-workflow-b",
      workflow: "workflow-b",
      data: {
        message: data.message,
        value: data.initialValue
      }
    });
    
    console.log(`[Workflow A] Received result from B:`, resultB.result);
    
    // Invoke workflow C
    const resultC = await ctx.invoke({
      id: "invoke-workflow-c", 
      workflow: "workflow-c",
      data: {
        text: data.message,
        multiplier: resultB.result.calculatedValue
      }
    });
    
    console.log(`[Workflow A] Received result from C:`, resultC.result);
    
    // Combine results
    const finalResult = {
      messageFromB: resultB.result.processedMessage,
      valueFromB: resultB.result.calculatedValue,
      textFromC: resultC.result.processedText,
      valueFromC: resultC.result.multipliedValue,
      combinedValue: resultB.result.calculatedValue + resultC.result.multipliedValue
    };
    
    console.log(`[Workflow A] Completed orchestration with final result:`, finalResult);
    return finalResult;
  }
});

// Example usage
async function main() {
  // Create the client with all workflows
  const client = OpenQueue.createClient(
    {
      redisUrl: "redis://localhost:6379",
      defaultJobOptions: {
        retries: 3
      }
    },
    [workflowA, workflowB, workflowC]
  );
  
  // Initialize and start the client
  await client.init();
  await client.start();
  
  console.log("OpenQueue client started. Creating job in workflow A...");
  
  // Create a job in workflow A
  const { bullJob } = await client.getWorkflow("workflow-a").createJob({
    initialValue: 5,
    message: "Hello from the orchestrator"
  });
  
  console.log(`Created job ${bullJob.id} in workflow A`);
  
  // Wait for completion (in a real app, you'd handle this differently)
  const checkJob = async () => {
    const job = await client.getWorkflow("workflow-a").getBullJob(bullJob.id);
    const state = await job.getState();
    
    if (state === "completed") {
      console.log("\nJob completed! Final result:", job.returnvalue);
      
      // Gracefully shutdown
      await client.stop();
      process.exit(0);
    } else if (state === "failed") {
      console.error("\nJob failed!");
      await client.stop();
      process.exit(1);
    } else {
      console.log(`Job state: ${state}`);
      setTimeout(checkJob, 1000);
    }
  };
  
  setTimeout(checkJob, 1000);
}

// Run the example
main().catch(console.error);