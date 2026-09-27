import { describe, expect, it } from "@jest/globals";
import { allowedHosts, hostAllowed, isLoopbackHost, originAllowed, tokenMatches } from "../../server/access";

describe("who may talk to the console", () => {
  const hosts = allowedHosts(3210, "127.0.0.1");

  it("should answer requests addressed to the console by a loopback name", () => {
    expect(hostAllowed("127.0.0.1:3210", hosts)).toBe(true);
    expect(hostAllowed("localhost:3210", hosts)).toBe(true);
    expect(hostAllowed("[::1]:3210", hosts)).toBe(true);
  });

  it("should refuse a request addressed to a foreign name, as a DNS rebinding sends", () => {
    expect(hostAllowed("evil.example:3210", hosts)).toBe(false);
    expect(hostAllowed("127.0.0.1:3211", hosts)).toBe(false);
    expect(hostAllowed(undefined, hosts)).toBe(false);
  });

  it("should accept a socket opened by a page the console served", () => {
    expect(originAllowed("http://127.0.0.1:3210", hosts)).toBe(true);
    expect(originAllowed("http://localhost:3210", hosts)).toBe(true);
    expect(originAllowed("http://[::1]:3210", hosts)).toBe(true);
  });

  it("should refuse a socket opened by any other page", () => {
    expect(originAllowed("https://evil.example", hosts)).toBe(false);
    expect(originAllowed("http://127.0.0.1:8080", hosts)).toBe(false);
    expect(originAllowed("null", hosts)).toBe(false);
    expect(originAllowed("file://", hosts)).toBe(false);
    expect(originAllowed(undefined, hosts)).toBe(false);
  });

  it("should answer to the interface it binds and, bound to all of them, to every address of the machine", () => {
    expect(hostAllowed("192.168.1.5:3210", allowedHosts(3210, "192.168.1.5"))).toBe(true);
    const everywhere = allowedHosts(3210, "0.0.0.0", ["192.168.1.5", "fe80::1"]);
    expect(hostAllowed("192.168.1.5:3210", everywhere)).toBe(true);
    expect(hostAllowed("[fe80::1]:3210", everywhere)).toBe(true);
    expect(originAllowed("http://192.168.1.5:3210", everywhere)).toBe(true);
    expect(hostAllowed("192.168.1.5:3210", hosts)).toBe(false);
  });

  it("should tell a loopback interface from one reachable from the network", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.5")).toBe(false);
  });

  it("should accept only the exact hook secret", () => {
    expect(tokenMatches("secret", "secret")).toBe(true);
    expect(tokenMatches("secreT", "secret")).toBe(false);
    expect(tokenMatches("secret-longer", "secret")).toBe(false);
    expect(tokenMatches(undefined, "secret")).toBe(false);
    expect(tokenMatches("", "secret")).toBe(false);
  });
});
