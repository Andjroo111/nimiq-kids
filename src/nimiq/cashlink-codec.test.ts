import { test, expect } from "bun:test";
import { encodeCashlinkPayload, decodeCashlinkPayload, payloadFromUrl } from "./cashlink-codec";

const PRIV = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);

test("round-trips private key, value, message, theme", () => {
  const p = encodeCashlinkPayload(PRIV, 500_000, "chore:42", 3);
  const d = decodeCashlinkPayload(p);
  expect([...d.priv]).toEqual([...PRIV]);
  expect(d.value).toBe(500_000);
  expect(d.message).toBe("chore:42");
  expect(d.theme).toBe(3);
});

test("round-trips with no message and no theme", () => {
  const p = encodeCashlinkPayload(PRIV, 1);
  const d = decodeCashlinkPayload(p);
  expect([...d.priv]).toEqual([...PRIV]);
  expect(d.value).toBe(1);
  expect(d.message).toBe("");
  expect(d.theme).toBe(0);
});

test("handles large values (uint64) without precision loss within safe int", () => {
  const v = 9_000_000_000; // 90,000 NIM in luna — well within Number.MAX_SAFE_INTEGER
  const d = decodeCashlinkPayload(encodeCashlinkPayload(PRIV, v));
  expect(d.value).toBe(v);
});

test("payload uses url-safe base64 alphabet only", () => {
  const p = encodeCashlinkPayload(PRIV, 123_456, "hello world");
  expect(p).not.toMatch(/[+/]/);
  expect(p.replace(/[~=]/g, "")).toMatch(/^[A-Za-z0-9_-]+$/);
});

test("payloadFromUrl extracts fragment", () => {
  const p = encodeCashlinkPayload(PRIV, 5);
  expect(payloadFromUrl("https://hub.nimiq.com/cashlink/#" + p)).toBe(p);
  expect(payloadFromUrl(p)).toBe(p);
});

test("rejects wrong-size private key", () => {
  expect(() => encodeCashlinkPayload(new Uint8Array(16), 5)).toThrow();
});

test("inserts ~ separators only for long payloads and they round-trip", () => {
  const p = encodeCashlinkPayload(PRIV, 5, "x".repeat(220));
  expect(p).toContain("~");
  expect(decodeCashlinkPayload(p).message).toBe("x".repeat(220));
});

test("decode accepts '.'-padded payloads (Nimiq BufferUtils native pad char)", () => {
  const p = encodeCashlinkPayload(PRIV, 500_000, "chore:42");
  const dotPadded = p.replace(/=+$/g, (m) => ".".repeat(m.length));
  const d = decodeCashlinkPayload(dotPadded);
  expect([...d.priv]).toEqual([...PRIV]);
  expect(d.value).toBe(500_000);
  expect(d.message).toBe("chore:42");
});
