import { describe, expect, it } from "vitest";

import { presenceChannelTopic } from "./use-presence";

describe("presence channel topics", () => {
  it("changes for each subscription generation", () => {
    expect(presenceChannelTopic("account-1", 1)).not.toBe(
      presenceChannelTopic("account-1", 2),
    );
  });

  it("keeps subscriptions for different accounts isolated", () => {
    expect(presenceChannelTopic("account-1", 1)).not.toBe(
      presenceChannelTopic("account-2", 1),
    );
  });
});
