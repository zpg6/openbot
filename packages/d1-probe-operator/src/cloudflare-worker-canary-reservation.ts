import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { canonicalizeJsonV1 } from "@openbot/gate-attestation/internal";

const DigestV1 = /^[0-9a-f]{64}$/u;
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const stateRoot = fileURLToPath(new URL("../../../.build/d1-probe-canary-state/", import.meta.url));

export type D1ProbeCloudflareWorkerCanaryReservationResultV1 =
    "reserved" | "already_reserved" | "reservation_unavailable";

export const reserveD1ProbeCloudflareWorkerCanaryPlanV1 = async (
    planDigest: string
): Promise<D1ProbeCloudflareWorkerCanaryReservationResultV1> => {
    if (!DigestV1.test(planDigest)) return "reservation_unavailable";
    try {
        const realRepositoryRoot = await realpath(repositoryRoot);
        await mkdir(stateRoot, { recursive: true, mode: 0o700 });
        await chmod(stateRoot, 0o700);
        const stateRootStat = await lstat(stateRoot);
        if (!stateRootStat.isDirectory() || stateRootStat.isSymbolicLink()) return "reservation_unavailable";
        const realStateRoot = await realpath(stateRoot);
        const expectedPrefix = `${realRepositoryRoot}/.build/`;
        if (!realStateRoot.startsWith(expectedPrefix)) return "reservation_unavailable";

        const reservation = await open(`${realStateRoot}/${planDigest}.lock`, "wx", 0o600).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
            throw error;
        });
        if (reservation === null) return "already_reserved";
        try {
            await reservation.writeFile(
                canonicalizeJsonV1({
                    schema_version: 1,
                    kind: "d1_probe_cloudflare_worker_api_canary_reservation",
                    plan_digest: planDigest,
                })
            );
            await reservation.sync();
        } finally {
            await reservation.close();
        }
        return "reserved";
    } catch {
        return "reservation_unavailable";
    }
};
