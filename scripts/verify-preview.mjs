const required = ["OPENBOT_PREVIEW_ORIGIN"];
const missing = required.filter(name => !process.env[name]);

if (missing.length > 0 && process.env.CI_FORK === "true") {
    console.log(`preview verification skipped on fork, missing: ${missing.join(", ")}`);
    process.exit(0);
}

if (missing.length > 0) {
    console.error(`preview verification requires: ${missing.join(", ")}`);
    process.exit(1);
}

let origin;
try {
    const parsed = new URL(process.env.OPENBOT_PREVIEW_ORIGIN);
    if (
        parsed.protocol !== "https:" ||
        parsed.username !== "" ||
        parsed.password !== "" ||
        parsed.port !== "" ||
        parsed.pathname !== "/" ||
        parsed.search !== "" ||
        parsed.hash !== ""
    ) {
        throw new Error("not a canonical HTTPS origin");
    }
    origin = parsed.origin;
} catch (error) {
    console.error(`OPENBOT_PREVIEW_ORIGIN is invalid: ${error instanceof Error ? error.message : "invalid URL"}`);
    process.exit(1);
}

const request = async path => {
    const response = await fetch(`${origin}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "OpenBot-Preview-Verifier/1.0" },
    });
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > 512 * 1024) throw new Error(`${path} exceeded 512 KiB`);
    return { response, body };
};

const health = await request("/healthz");
if (health.response.status !== 200) throw new Error(`/healthz returned ${health.response.status}`);
const healthDocument = JSON.parse(health.body);
if (healthDocument?.profile !== "d1" || healthDocument?.status !== "ok") {
    throw new Error("/healthz did not report the D1 production profile as ready");
}

const login = await request("/login");
if (login.response.status !== 200 || !login.body.includes("OpenBot")) {
    throw new Error("/login did not render the OpenBot application");
}
if (!login.response.headers.get("content-security-policy")?.includes("default-src 'none'")) {
    throw new Error("/login is missing the reviewed content security policy");
}

console.log(`preview verification passed for ${origin}`);
