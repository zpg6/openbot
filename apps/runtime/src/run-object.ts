interface RuntimeBindings {
    readonly CAPABILITY_GATEWAY: Fetcher;
}

export class RunObject implements DurableObject {
    readonly #state: DurableObjectState;
    readonly #bindings: RuntimeBindings;

    constructor(state: DurableObjectState, bindings: RuntimeBindings) {
        this.#state = state;
        this.#bindings = bindings;
    }

    fetch(_request: Request): Response {
        void this.#state.storage;
        void this.#bindings.CAPABILITY_GATEWAY;
        return new Response("Not found", {
            headers: { "Cache-Control": "no-store" },
            status: 404,
        });
    }
}
