import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Checks whether a website is up and returns its HTTP status code",
  inputSchema: z.object({
    url: z.string().url().describe("Full website URL to check, including protocol"),
  }),
  async execute(input) {
    try {
      const response = await fetch(input.url, {
        method: "HEAD",
        redirect: "follow",
      });
      const up = response.status >= 200 && response.status < 400;
      return {
        url: input.url,
        status_code: response.status,
        up,
      };
    } catch (error) {
      return {
        url: input.url,
        status_code: null,
        up: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});