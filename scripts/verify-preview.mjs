const required = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "METORIAL_API_KEY", "OPENROUTER_API_KEY"];
const missing = required.filter(name => !process.env[name]);

if (missing.length > 0 && process.env.CI_FORK === "true") {
    console.log(`preview verification skipped on fork, missing: ${missing.join(", ")}`);
    process.exit(0);
}

if (missing.length > 0) {
    console.error(`preview verification requires: ${missing.join(", ")}`);
    process.exit(1);
}

console.error("preview verification is gated until disposable vendor probes exist in checklist item 2");
process.exit(1);
