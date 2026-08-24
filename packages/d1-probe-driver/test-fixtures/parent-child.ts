import { closeSync, readSync } from "node:fs";

import {
    D1ProbeGatewayChildAssignmentV1Schema,
    canonicalD1ProbeGatewayChildResultV1,
    goForD1ProbeGatewayChildV1,
    readyForD1ProbeGatewayChildV1,
} from "../src/child.js";

const readStdin = async (): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
};

const assignmentInput = JSON.parse(await readStdin()) as unknown;
const assignment = D1ProbeGatewayChildAssignmentV1Schema.parse(assignmentInput);
const ready = readyForD1ProbeGatewayChildV1(assignment);
if (ready === null || !process.connected || process.send === undefined) process.exit(1);

const goPromise = new Promise<unknown>((resolve, reject) => {
    process.once("message", resolve);
    process.once("disconnect", () => reject(new Error("disconnected")));
});
await new Promise<void>((resolve, reject) => {
    process.send?.(ready, error => (error === null ? resolve() : reject(error)));
});
const go = goForD1ProbeGatewayChildV1(assignment, await goPromise);
if (go === null) process.exit(1);

const secret = Buffer.alloc(514);
let secretSize = 0;
try {
    while (secretSize < secret.byteLength) {
        const read = readSync(4, secret, secretSize, secret.byteLength - secretSize, null);
        if (read === 0) break;
        secretSize += read;
    }
} finally {
    closeSync(4);
}
if (secretSize < 33 || secret.includes(0x0a, 0) === false) process.exit(1);

const result = {
    schema_version: 1,
    kind: "d1_probe_gateway_child_result",
    child_process_id: assignment.trial.child_process_id,
    writer_role: assignment.trial.writer_role,
    request_digest: assignment.trial.request_digest,
    go_receipt_digest: assignment.trial.go_receipt_digest,
    transport_result: {
        status: "outcome_unknown",
        request_digest: assignment.trial.request_digest,
        writer_role: assignment.trial.writer_role,
        error_code: "network_error",
    },
} as const;
process.stdout.write(`${canonicalD1ProbeGatewayChildResultV1(result)}\n`);
process.disconnect();
