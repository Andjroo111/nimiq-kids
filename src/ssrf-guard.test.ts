import { test, expect } from "bun:test";
import { isPrivateIp, notifyUrlShapeOk, notifyUrlSafe } from "./ssrf-guard";

test("isPrivateIp flags every internal IPv4 range and passes public ones", () => {
  for (const ip of [
    "127.0.0.1", "127.4.5.6", "10.0.0.1", "10.255.1.1", "172.16.0.1", "172.31.255.255",
    "192.168.1.243", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
  ]) expect(isPrivateIp(ip)).toBe(true);
  for (const ip of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "192.169.0.1", "93.184.216.34"]) {
    expect(isPrivateIp(ip)).toBe(false);
  }
});

test("isPrivateIp flags internal IPv6 (loopback, link-local, ULA, mapped v4)", () => {
  for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1"]) {
    expect(isPrivateIp(ip)).toBe(true);
  }
  expect(isPrivateIp("2606:4700:4700::1111")).toBe(false); // public (1.1.1.1 v6)
});

test("notifyUrlShapeOk requires https and rejects internal literals/hostnames", () => {
  expect(notifyUrlShapeOk("http://ntfy.sh/topic")).toBe(false);   // not https
  expect(notifyUrlShapeOk("ftp://ntfy.sh")).toBe(false);
  expect(notifyUrlShapeOk("not a url")).toBe(false);
  expect(notifyUrlShapeOk("https://127.0.0.1:8648/")).toBe(false);
  expect(notifyUrlShapeOk("https://[::1]/")).toBe(false);
  expect(notifyUrlShapeOk("https://192.168.1.243/hook")).toBe(false);
  expect(notifyUrlShapeOk("https://localhost/")).toBe(false);
  expect(notifyUrlShapeOk("https://printer.local/")).toBe(false);
  expect(notifyUrlShapeOk("https://ntfy.sh/my-topic")).toBe(true);
  expect(notifyUrlShapeOk("https://1.1.1.1/")).toBe(true); // public IP literal is fine
});

test("notifyUrlSafe: the exact PoC targets are refused, a public https IP literal is allowed", async () => {
  // No DNS needed for any of these (literals or shape rejections).
  expect(await notifyUrlSafe("http://127.0.0.1:8648/")).toBe(false); // the advisory PoC
  expect(await notifyUrlSafe("https://127.0.0.1:8648/")).toBe(false);
  expect(await notifyUrlSafe("https://192.168.1.243/")).toBe(false);
  expect(await notifyUrlSafe("https://[::1]/")).toBe(false);
  expect(await notifyUrlSafe("https://localhost/")).toBe(false);
  expect(await notifyUrlSafe("https://1.1.1.1/hook")).toBe(true); // public literal, no lookup
});
