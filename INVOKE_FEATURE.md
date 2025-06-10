# Invoke Feature - Cross-Workflow Task Execution

The invoke feature in OpenQueue allows workflows to call and wait for other workflows to complete, enabling complex orchestration patterns where one task depends on the results of multiple other tasks.

## Overview

With the invoke functionality, you can:
- Have a workflow (Task A) invoke other workflows (Task B and Task C)
- Wait for the invoked workflows to complete
- Retrieve the results from the invoked workflows
- Continue processing with those results

This is particularly useful for:
- Breaking down complex workflows into smaller, reusable components
- Orchestrating multiple services or tasks
- Creating workflow pipelines with dependencies

## Usage

### Basic Example

```typescript
// Inside a workflow's execution function
const result = await ctx.invoke({
  id: "unique-step-id",      // Unique identifier for this invocation step
  workflow: "target-workflow", // ID of the workflow to invoke
  data: {                     // Data to pass to the invoked workflow
    someField: "value"
  }
});

// Access the result
console.log(result.result); // Contains the return value from the invoked workflow
```

### Complete Example

Here's a full example showing Task A invoking both Task B and Task C:

```typescript
import { OpenQueue } from "openqueue";
import { z } from "zod";

// Define Task B - performs calculation
const taskB = OpenQueue.workflow({
  id: "task-b",
  schema: z.object({ number: z.number() }),
  fn: async ({ data }) => {
    return data.number * 2;
  }
});

// Define Task C - performs text processing
const taskC = OpenQueue.workflow({
  id: "task-c",
  schema: z.object({ text: z.string() }),
  fn: async ({ data }) => {
    return data.text.toUpperCase();
  }
});

// Define Task A - orchestrates B and C
const taskA = OpenQueue.workflow({
  id: "task-a",
  schema: z.object({
    value: z.number(),
    message: z.string()
  }),
  fn: async ({ ctx, data }) => {
    // Invoke Task B
    const resultB = await ctx.invoke({
      id: "call-task-b",
      workflow: "task-b",
      data: { number: data.value }
    });
    
    // Invoke Task C
    const resultC = await ctx.invoke({
      id: "call-task-c",
      workflow: "task-c",
      data: { text: data.message }
    });
    
    // Use both results
    return {
      doubled: resultB.result,
      uppercased: resultC.result
    };
  }
});

// Create client with all workflows
const client = OpenQueue.createClient(
  {
    redisUrl: "redis://localhost:6379"
  },
  [taskA, taskB, taskC]
);

// Initialize and use
await client.init();
await client.start();

// Create a job in Task A
const { bullJob } = await client.getWorkflow("task-a").createJob({
  value: 10,
  message: "hello"
});
```

## How It Works

1. **Invocation**: When `ctx.invoke()` is called, it creates a new job in the target workflow
2. **Waiting**: The calling job is moved to a delayed state and periodically checks if the invoked job has completed
3. **Result Retrieval**: Once the invoked job completes, its result is retrieved and returned to the calling workflow
4. **Continuation**: The calling workflow continues execution with the result

### Internal Implementation

- The invoke step is tracked with a unique ID to handle retries and resume correctly
- Job state includes invocation metadata to track which jobs are waiting for results
- When a job completes, it notifies any waiting jobs by promoting them from the delayed queue
- The system uses BullMQ's delayed job feature to implement the waiting mechanism

## Important Considerations

1. **All workflows must be registered**: The invoked workflow must be part of the same client instance
2. **Step IDs must be unique**: Each invoke call needs a unique step ID within the workflow
3. **Error handling**: If an invoked job fails, the calling job will also fail
4. **Performance**: Each invocation creates a new job, so consider the overhead for high-frequency operations
5. **Circular dependencies**: Be careful not to create circular invocation chains

## Advanced Patterns

### Parallel Invocation

You can invoke multiple workflows in parallel by using Promise.all:

```typescript
const [resultB, resultC] = await Promise.all([
  ctx.invoke({
    id: "call-b",
    workflow: "task-b",
    data: { number: 10 }
  }),
  ctx.invoke({
    id: "call-c",
    workflow: "task-c", 
    data: { text: "hello" }
  })
]);
```

### Conditional Invocation

Invoke workflows based on conditions:

```typescript
const result = data.needsProcessing 
  ? await ctx.invoke({
      id: "process-data",
      workflow: "processor",
      data: data
    })
  : { result: data };
```

### Chained Invocations

Use the result of one invocation as input to another:

```typescript
const step1 = await ctx.invoke({
  id: "step-1",
  workflow: "preprocessor",
  data: rawData
});

const step2 = await ctx.invoke({
  id: "step-2",
  workflow: "analyzer",
  data: step1.result
});

const final = await ctx.invoke({
  id: "step-3",
  workflow: "finalizer",
  data: step2.result
});
```

## Limitations

- Invoked workflows must be in the same OpenQueue client instance
- No support for remote workflow invocation (different Redis instances)
- Results are stored in Redis, so very large results may impact performance
- Circular dependencies are not detected automatically

## Error Handling

When an invoked job fails:

```typescript
try {
  const result = await ctx.invoke({
    id: "risky-operation",
    workflow: "risky-workflow",
    data: { ... }
  });
} catch (error) {
  // Handle the error
  console.error("Invoked job failed:", error);
  // You can still use other OpenQueue features like retry, etc.
}
```

## Best Practices

1. **Keep workflows focused**: Each workflow should have a single responsibility
2. **Use meaningful step IDs**: They help with debugging and monitoring
3. **Handle errors gracefully**: Always consider what happens if an invoked job fails
4. **Monitor performance**: Track how long invocations take and optimize if needed
5. **Document dependencies**: Make it clear which workflows depend on others