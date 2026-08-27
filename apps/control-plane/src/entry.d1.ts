import { createProductionControlPlaneV1, type ProductionControlPlaneBindings } from "./production.ts";

export default {
    fetch(request, env, executionContext) {
        return createProductionControlPlaneV1(env).fetch(request, env, executionContext);
    },
} satisfies ExportedHandler<ProductionControlPlaneBindings>;
