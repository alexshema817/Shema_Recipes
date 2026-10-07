// Unit tests for token encryption (lib/secret-box.mjs) and the SSRF guard
// (lib/net-guard.mjs). Run: npm run test:security
import { seal, open, isSealed } from "../netlify/lib/secret-box.mjs";
import { isPrivateAddress, assertPublicUrl } from "../netlify/lib/net-guard.mjs";

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`ok    ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
  }
}

async function rejects(url) {
  try {
    await assertPublicUrl(url);
    return false;
  } catch {
    return true;
  }
}

console.log("# secret box");
process.env.SESSION_SECRET = "test-secret-0123456789-abcdefghij";
const tokens = { accessToken: "AT-123", refreshToken: "RT-456", expiresAt: 1 };
const box = seal(tokens);
check("sealed value is marked", isSealed(box), true);
check("ciphertext hides the token", JSON.stringify(box).includes("RT-456"), false);
check("round trip", open(box), tokens);
check("two seals differ (random IV)", seal(tokens).data !== box.data, true);
check("tampered data is rejected", open({ ...box, data: box.data.slice(0, -2) + (box.data.endsWith("A") ? "BB" : "AA") }), null);
check("plaintext is not treated as sealed", isSealed(tokens), false);
process.env.SESSION_SECRET = "a-different-secret-0123456789-xyz";
check("changed SESSION_SECRET cannot open it", open(box), null);

console.log("\n# private addresses");
for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "not-an-ip"]) {
  check(`blocks ${ip}`, isPrivateAddress(ip), true);
}
for (const ip of ["8.8.8.8", "172.32.0.1", "151.101.1.69", "2606:4700::6810:84e5"]) {
  check(`allows ${ip}`, isPrivateAddress(ip), false);
}

console.log("\n# URL guard");
for (const url of ["http://localhost/", "http://127.0.0.1:9001/2018-06-01/runtime/invocation/next", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://foo.internal/", "file:///etc/passwd", "ftp://example.com/"]) {
  check(`rejects ${url}`, await rejects(url), true);
}
check("allows a public site", await rejects("https://www.bbcgoodfood.com/"), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
