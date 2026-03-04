import { createGrowthbookAdapter } from "@flags-sdk/growthbook";

export const growthBookAdapter = createGrowthbookAdapter({
  apiHost: process.env.GROWTHBOOK_API_HOST!,
  clientKey: process.env.GROWTHBOOK_CLIENT_KEY!,
});
