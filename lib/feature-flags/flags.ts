import { flag } from "flags/next";
import { growthBookAdapter } from "./growthbook-adapter";

export const newLandingHeroFlag = flag<boolean>({
  key: "new-landing-hero",
  defaultValue: false,
  description: "A/B test: show alternative hero section on landing page",
  options: [
    { value: true, label: "New Hero" },
    { value: false, label: "Current Hero" },
  ],
  adapter: growthBookAdapter.feature<boolean>(),
});
