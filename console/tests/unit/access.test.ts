import { describe, expect, it } from "@jest/globals";
import { allowedHosts, clientAddress, hostAllowed, isLoopbackHost, macAllowed, macInNeighbourEntry, normalizeMac, originAllowed, tokenMatches } from "../../server/access";

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

  it("should answer to a name the user gave it, and to no other", () => {
    const named = allowedHosts(3210, "0.0.0.0", ["192.168.1.5"], ["MacMini.home"]);
    expect(hostAllowed("macmini.home:3210", named)).toBe(true);
    expect(originAllowed("http://macmini.home:3210", named)).toBe(true);
    expect(hostAllowed("evil.example:3210", named)).toBe(false);
    expect(hostAllowed("macmini.home:3210", hosts)).toBe(false);
  });

  it("should read a hardware address whatever the tool that wrote it", () => {
    expect(normalizeMac("0:ce:39:d0:48:c")).toBe("00:ce:39:d0:48:0c");
    expect(normalizeMac("00-CE-39-D0-48-0C")).toBe("00:ce:39:d0:48:0c");
    expect(normalizeMac("00:ce:39:d0:48")).toBeUndefined();
    expect(normalizeMac("not-a-mac")).toBeUndefined();
    expect(macInNeighbourEntry("? (192.168.0.4) at 0:ce:39:d0:48:c on en0 ifscope [ethernet]")).toBe("00:ce:39:d0:48:0c");
    expect(macInNeighbourEntry("192.168.0.4 ether 00:ce:39:d0:48:0c C eth0")).toBe("00:ce:39:d0:48:0c");
    expect(macInNeighbourEntry("? (192.168.0.99) at (incomplete) on en0 ifscope [ethernet]")).toBeUndefined();
    expect(macInNeighbourEntry("192.168.0.99 (192.168.0.99) -- no entry")).toBeUndefined();
  });

  it("should let in only the devices listed, and none the neighbour table does not know", () => {
    const listed = new Set(["00:ce:39:d0:48:0c"]);
    expect(macAllowed("00:ce:39:d0:48:0c", listed)).toBe(true);
    expect(macAllowed("dc:b4:d9:5c:67:bc", listed)).toBe(false);
    expect(macAllowed(undefined, listed)).toBe(false);
  });

  it("should read the address of an IPv4 client reported in its IPv6 form", () => {
    expect(clientAddress("::ffff:192.168.1.5")).toBe("192.168.1.5");
    expect(clientAddress("192.168.1.5")).toBe("192.168.1.5");
    expect(clientAddress(undefined)).toBe("");
  });

  it("should accept only the exact hook secret", () => {
    expect(tokenMatches("secret", "secret")).toBe(true);
    expect(tokenMatches("secreT", "secret")).toBe(false);
    expect(tokenMatches("secret-longer", "secret")).toBe(false);
    expect(tokenMatches(undefined, "secret")).toBe(false);
    expect(tokenMatches("", "secret")).toBe(false);
  });
});
