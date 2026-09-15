// Mini-app glue: the deeplink + parent-app URL builders every share/open path
// rides on, and user-cancel detection (declining the wallet dialog must read
// as a normal outcome).

import { test, expect } from "bun:test";
import { MINIAPP_INIT_TIMEOUT_MS, isUserCancel, miniAppDeeplink, parentAppUrl } from "./miniapp";

test("deeplink wraps the URL in the nimiqpay://miniapp scheme, encoded", () => {
  const link = miniAppDeeplink("https://hatch.example.com/parent/#t=abc123");
  expect(link).toBe("nimiqpay://miniapp?url=https%3A%2F%2Fhatch.example.com%2Fparent%2F%23t%3Dabc123");
});

test("parentAppUrl: bare, with token, with ref, with both", () => {
  const origin = "https://hatch.example.com";
  expect(parentAppUrl(origin)).toBe("https://hatch.example.com/parent/");
  expect(parentAppUrl(origin, "deadbeef")).toBe("https://hatch.example.com/parent/#t=deadbeef");
  expect(parentAppUrl(origin, null, "ABCD2345")).toBe("https://hatch.example.com/parent/?ref=ABCD2345");
  expect(parentAppUrl(origin, "deadbeef", "ABCD2345")).toBe("https://hatch.example.com/parent/?ref=ABCD2345#t=deadbeef");
});

test("the token always rides in the fragment, never the query", () => {
  const url = parentAppUrl("https://x.test", "secret", "CODE");
  expect(new URL(url).hash).toBe("#t=secret");
  expect(new URL(url).search).not.toContain("secret");
});

test("user-cancel shapes are recognized (user/permission context or known SDK literals)", () => {
  expect(isUserCancel(new Error("Nimiq Pay: PermissionDenied"))).toBe(true);
  expect(isUserCancel(new Error("Nimiq Pay: permission_denied"))).toBe(true);
  expect(isUserCancel(new Error("Permission denied"))).toBe(true);
  expect(isUserCancel(new Error("CANCELED"))).toBe(true); // the Hub's exact popup-close rejection
  expect(isUserCancel(new Error("cancelled"))).toBe(true);
  expect(isUserCancel(new Error("User rejected the request"))).toBe(true);
  expect(isUserCancel(new Error("user cancelled"))).toBe(true);
  expect(isUserCancel(new Error("Request dismissed by user"))).toBe(true);
  expect(isUserCancel(new Error("Cancelled by the user"))).toBe(true);
  expect(isUserCancel("Popup closed")).toBe(true);
  expect(isUserCancel("Popup dismissed")).toBe(true);
});

test("real failures are NOT user cancels", () => {
  expect(isUserCancel(new Error("network timeout"))).toBe(false);
  expect(isUserCancel(new Error("connection refused"))).toBe(false);
  expect(isUserCancel(new Error("insufficient funds"))).toBe(false);
  expect(isUserCancel(undefined)).toBe(false);
  expect(isUserCancel({})).toBe(false);
});

test("bare rejected/denied/cancelled inside network or consensus failures stay errors", () => {
  expect(isUserCancel(new Error("transaction rejected by mempool"))).toBe(false);
  expect(isUserCancel(new Error("Request was cancelled: timeout"))).toBe(false);
  expect(isUserCancel(new Error("request cancelled by peer"))).toBe(false);
  expect(isUserCancel(new Error("access denied (403)"))).toBe(false);
  expect(isUserCancel(new Error("tx rejected: insufficient fee"))).toBe(false);
  expect(isUserCancel(new Error("consensus request aborted"))).toBe(false);
});

test("init timeout is ~10s per the port brief", () => {
  expect(MINIAPP_INIT_TIMEOUT_MS).toBe(10_000);
});
