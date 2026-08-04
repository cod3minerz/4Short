#!/usr/bin/env node

import { Resolver } from "node:dns/promises";

const siteHost = process.env.HASHPIX_SITE_HOST ?? "hashpix.ru";
const wwwHost = process.env.HASHPIX_WWW_HOST ?? "www.hashpix.ru";
const apiHost = process.env.HASHPIX_API_HOST ?? "api.hashpix.ru";
const requiredApiAddress = process.env.HASHPIX_API_ADDRESS ?? "147.45.99.153";
const resolver = new Resolver();
resolver.setServers([process.env.HASHPIX_DNS_RESOLVER ?? "1.1.1.1"]);

const failures = [];

async function addressesFor(host) {
  try {
    return await resolver.resolve4(host);
  } catch (error) {
    failures.push(`${host}: DNS lookup failed (${error.code ?? error.message})`);
    return [];
  }
}

async function checkHttps(url, expectedStatus = [200, 301, 302, 307, 308]) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (!expectedStatus.includes(response.status)) {
      failures.push(`${url}: unexpected HTTP ${response.status}`);
      return;
    }
    console.log(`✓ ${url}: HTTP ${response.status}`);
  } catch (error) {
    failures.push(`${url}: ${error.cause?.message ?? error.message}`);
  }
}

console.log("Hashpix release DNS and HTTPS readiness\n");

const [siteAddresses, wwwAddresses, apiAddresses] = await Promise.all([
  addressesFor(siteHost),
  addressesFor(wwwHost),
  addressesFor(apiHost),
]);

for (const [host, addresses] of [
  [siteHost, siteAddresses],
  [wwwHost, wwwAddresses],
  [apiHost, apiAddresses],
]) {
  if (addresses.length > 0) console.log(`✓ ${host}: ${addresses.join(", ")}`);
}

if (apiAddresses.length > 0 && !apiAddresses.includes(requiredApiAddress)) {
  failures.push(`${apiHost}: expected ${requiredApiAddress}, received ${apiAddresses.join(", ")}`);
}

await checkHttps(`https://${siteHost}/`);
await checkHttps(`https://${siteHost}/robots.txt`, [200]);
await checkHttps(`https://${siteHost}/sitemap.xml`, [200]);
await checkHttps(`https://${apiHost}/health/live`, [200]);

if (failures.length > 0) {
  console.error("\nNot ready:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nHashpix public routing is ready for release verification.");
}
