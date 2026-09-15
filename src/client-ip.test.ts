// The one rule every per-caller brake in the app rests on: the caller does not get to
// say who they are. These assert it directly, at the resolver, so a route that starts
// trusting a header again fails here first.

import { test, expect, afterEach } from "bun:test";
import { Hono } from "hono";
import { clientIp, peerEnv, UNKNOWN_CALLER } from "./client-ip";

const app = new Hono().get("/who", (c) => c.text(clientIp(c)));

const who = async (headers: Record<string, string>, env?: unknown) =>
  (await app.request("http://hatch.test/who", { headers }, env)).text();

afterEach(() => { delete process.env.HATCH_TRUSTED_PROXIES; });

test("an untrusted peer is keyed on its own address, whatever it claims", async () => {
  const lan = peerEnv("192.168.1.42");
  expect(await who({}, lan)).toBe("192.168.1.42");
  expect(await who({ "cf-connecting-ip": "203.0.113.77" }, lan)).toBe("192.168.1.42");
  expect(await who({ "x-forwarded-for": "203.0.113.77" }, lan)).toBe("192.168.1.42");
  // The exploit, in one line: thirty different claims, one bucket.
  const claimed = new Set<string>();
  for (let i = 1; i <= 30; i++) claimed.add(await who({ "x-forwarded-for": `198.51.100.${i}` }, lan));
  expect([...claimed]).toEqual(["192.168.1.42"]);
});

test("a trusted proxy's cf-connecting-ip is believed, and beats x-forwarded-for", async () => {
  const tunnel = peerEnv("127.0.0.1");
  expect(await who({ "cf-connecting-ip": "203.0.113.5" }, tunnel)).toBe("203.0.113.5");
  expect(await who({ "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "10.0.0.1" }, tunnel)).toBe("203.0.113.5");
  // Nothing forwarded at all: the peer itself, never a constant.
  expect(await who({}, tunnel)).toBe("127.0.0.1");
});

test("x-forwarded-for is read from the LAST hop, because a proxy appends to what the client sent", async () => {
  const tunnel = peerEnv("::1");
  // The client prepended two lies; the rightmost entry is the one our proxy vouched for.
  expect(await who({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" }, tunnel)).toBe("203.0.113.9");
});

test("an IPv4-mapped peer keys the same bucket as the bare form", async () => {
  expect(await who({ "cf-connecting-ip": "203.0.113.5" }, peerEnv("::ffff:127.0.0.1"))).toBe("203.0.113.5");
});

test("HATCH_TRUSTED_PROXIES moves the trust, and empty trusts nobody", async () => {
  process.env.HATCH_TRUSTED_PROXIES = "10.9.0.1";
  expect(await who({ "cf-connecting-ip": "203.0.113.5" }, peerEnv("10.9.0.1"))).toBe("203.0.113.5");
  expect(await who({ "cf-connecting-ip": "203.0.113.5" }, peerEnv("127.0.0.1"))).toBe("127.0.0.1");
  process.env.HATCH_TRUSTED_PROXIES = "";
  expect(await who({ "cf-connecting-ip": "203.0.113.5" }, peerEnv("127.0.0.1"))).toBe("127.0.0.1");
});

test("no connection info at all is one shared bucket, never a header", async () => {
  expect(await who({ "cf-connecting-ip": "203.0.113.5" })).toBe(UNKNOWN_CALLER);
  expect(await who({ "x-forwarded-for": "203.0.113.6" }, {})).toBe(UNKNOWN_CALLER);
});
