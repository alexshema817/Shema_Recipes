// Blocks server-side fetches to loopback, private, link-local and other
// non-public addresses (SSRF), including hosts that resolve to them.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function ipv4Parts(ip) {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}

/** True for addresses that must never be fetched from the server. */
export function isPrivateAddress(ip) {
  const addr = String(ip || "").toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = ipv4Parts(addr);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && v4[2] === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  if (isIP(addr) === 6) {
    if (addr === "::" || addr === "::1") return true;
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(addr)) return true; // hex-form mapped IPv4: refuse
    const first = parseInt(addr.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00; // ULA, link-local, multicast
  }
  return true; // not an IP at all: refuse
}

/** Throws unless the URL is http(s) and its host resolves only to public addresses. */
export async function assertPublicUrl(url) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs are supported");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("That address is not allowed");
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`Could not resolve ${host}`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error("That address is not allowed");
  return u;
}
