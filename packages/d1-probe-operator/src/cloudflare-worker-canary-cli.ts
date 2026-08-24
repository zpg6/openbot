const DISABLED_CODE_V1 = "worker_api_canary_disabled";

const main = async (): Promise<void> => {
    await new Promise<void>(resolve => {
        process.stderr.write(`${DISABLED_CODE_V1}\n`, () => resolve());
    }).catch(() => undefined);
    process.exitCode = 1;
};

await main();
