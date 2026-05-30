// smithers-source: authored
// smithers-metadata-version: 1
// smithers-display-name: Hello World
// smithers-description: Return a static Hello World response.
// smithers-tags: example, hello-world
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";

const { Workflow, Task, outputs, smithers } = createSmithers({
  helloWorld: z.object({
    message: z.literal("Hello World"),
  }),
});

export default smithers(() => (
  <Workflow name="hello-world">
    <Task id="hello-world" output={outputs.helloWorld}>
      {{ message: "Hello World" }}
    </Task>
  </Workflow>
));
