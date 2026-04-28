import { GrowthBookClient } from "@growthbook/growthbook";
import { flag } from "flags/next";
import type { Adapter } from "flags";

const growthBookClientKey = process.env.GROWTHBOOK_CLIENT_KEY;
const growthBookApiHost = process.env.GROWTHBOOK_API_HOST;

const growthBookClient = growthBookClientKey
  ? new GrowthBookClient({
      clientKey: growthBookClientKey,
      apiHost: growthBookApiHost || "https://cdn.growthbook.io",
    })
  : undefined;

let growthBookInitPromise: Promise<unknown> | undefined;

const growthBookFeatureAdapter = growthBookClient
  ? ({
      origin: (key: string) => `https://app.growthbook.io/features/${key}`,
      decide: async ({ key, entities, defaultValue }) => {
        growthBookInitPromise ??= growthBookClient.init({ streaming: false });
        await growthBookInitPromise;

        return (
          growthBookClient.evalFeature(key, {
            attributes: entities as Record<string, unknown> | undefined,
          }).value ??
          defaultValue ??
          false
        );
      },
    } satisfies Adapter<boolean, unknown>)
  : undefined;

const baseFlagConfig = {
  key: "new-landing-hero",
  defaultValue: false,
  description: "A/B test: show alternative hero section on landing page",
  options: [
    { value: true, label: "New Hero" },
    { value: false, label: "Current Hero" },
  ],
};

export const newLandingHeroFlag = flag<boolean>(
  growthBookFeatureAdapter
    ? {
        ...baseFlagConfig,
        adapter: growthBookFeatureAdapter,
      }
    : {
        ...baseFlagConfig,
        decide: () => false,
      },
);
