import { describe, expect, it } from "@jest/globals";
import { ControlAccess, validateNetworkAccess } from "../../server/control-access";

const token = "a".repeat(64);
const cookieHeader = (cookie: string) => cookie.split(";")[0]!;
describe("console authentication", () => {
  it("should require credentials even with a valid Host and Origin", () => {
    const access = new ControlAccess(token);
    expect(access.authenticated({ host: "localhost:3210", origin: "http://localhost:3210" })).toBe(false);
    expect(access.authenticated({ authorization: `Bearer ${token}` })).toBe(true);
    expect(access.authenticated({ authorization: "Bearer wrong" })).toBe(false);
  });
  it("should expire cookies and invalidate them on restart, even with a fixed token", () => {
    let now = 1_000;
    const access = new ControlAccess(token, () => now);
    const cookie = access.cookie(true);
    expect(cookie).toContain("HttpOnly; SameSite=Strict"); expect(cookie).toContain("; Secure");
    expect(access.authenticated({ cookie: cookieHeader(cookie) })).toBe(true);
    expect(new ControlAccess(token).authenticated({ cookie: cookieHeader(cookie) })).toBe(false);
    expect(access.authenticated({ cookie: cookieHeader(cookie).replace(/.$/, "z") })).toBe(false);
    now += 12 * 60 * 60_000;
    expect(access.authenticated({ cookie: cookieHeader(cookie) })).toBe(false);
  });
  it("should refuse an exposed server without a strong token and TLS", () => {
    expect(() => validateNetworkAccess("127.0.0.1", undefined, undefined, undefined)).not.toThrow();
    expect(() => validateNetworkAccess("127.0.0.1", "", "", "")).not.toThrow();
    expect(() => validateNetworkAccess("192.0.2.10", undefined, undefined, undefined)).toThrow("Network binding requires");
    expect(() => validateNetworkAccess("192.0.2.10", "short", "/cert", "/key")).toThrow("32 characters");
    expect(() => validateNetworkAccess("192.0.2.10", token, "/cert", undefined)).toThrow("Both");
    expect(() => validateNetworkAccess("0.0.0.0", token, "/cert", "/key", "https://console.example:3210")).not.toThrow();
    expect(() => validateNetworkAccess("0.0.0.0", token, "/cert", "/key")).toThrow("IMPL_PUBLIC_URL");
    expect(() => validateNetworkAccess("192.0.2.10", token, "/cert", "/key", "http://console.example")).toThrow("HTTPS origin");
  });
});
