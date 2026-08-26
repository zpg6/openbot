import { Avatar, Style } from "@dicebear/core";
import moodsDefinition from "@dicebear/styles/moods.json" with { type: "json" };
import type { Hono } from "hono";

import type { ControlPlaneBindings } from "./app.js";
import type {
    OpenBotClientCatalogAppV1,
    OpenBotClientBotDetailV1,
    OpenBotClientBotV1,
    OpenBotClientIntegrationV1,
    OpenBotClientPageV1,
    OpenBotClientPermissionV1,
    OpenBotClientViewV1,
} from "./product-client-page.js";

const MAX_NAME_BYTES = 128;
const MAX_DESCRIPTION_BYTES = 512;
const MAX_PURPOSE_BYTES = 512;
const MAX_INSTRUCTIONS_BYTES = 32 * 1024;
const MAX_PROMPT_BYTES = 16 * 1024;
const MAX_SCHEDULE_BYTES = 256;
const CONFIRMATION_LIFETIME_MS = 5 * 60 * 1_000;
const unsafeDisplayCharacters = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const unsafeContentCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export interface ControlPlaneActorV1 {
    readonly account_id: string;
    readonly organization_name: string;
    readonly user_id: string;
    readonly display_name: string;
    readonly csrf_token: string;
    readonly role: "owner" | "admin" | "member";
}

export interface ProductProofPermissionV1 {
    readonly integration_id: string;
    readonly policy_id: string;
    readonly display_name: string;
    readonly tool_key: string;
    readonly effect: "read" | "write" | "destructive";
    readonly consequence_summary: string;
    readonly resource_scope_summary: string;
    readonly enabled: boolean;
    readonly policy_revision: string;
    readonly policy_sha256: string;
    readonly input_schema_sha256: string;
    readonly output_schema_sha256: string;
}

export type ProductProofMetorialAuthBindingV1 =
    | {
          readonly mode: "user_grant";
          readonly connection_grant_id: string;
      }
    | {
          readonly mode: "deployment";
      }
    | {
          readonly mode: "authless";
      };

export interface ProductProofMetorialIntegrationV1 {
    readonly integration_id: string;
    readonly provider_identifier: string;
    readonly provider_deployment_id: string;
    readonly provider_version_id: string;
    readonly provider_specification_id: string;
    readonly auth: ProductProofMetorialAuthBindingV1;
    readonly connected_account_label: string;
    readonly display_name: string;
    readonly description: string;
    readonly icon_data_uri?: string | null | undefined;
    readonly connection_state: "connected" | "needs_connection";
    readonly permissions: readonly ProductProofPermissionV1[];
}

export interface ProductProofMetorialCatalogAppV1 {
    readonly identifier: string;
    readonly display_name: string;
    readonly description: string;
    readonly categories: readonly string[];
    readonly icon_url: string | null;
}

export interface ProductProofBotPermissionPinV1 {
    readonly policy_id: string;
    readonly policy_revision: string;
    readonly policy_sha256: string;
    readonly tool_key: string;
    readonly effect: "read" | "write" | "destructive";
    readonly input_schema_sha256: string;
    readonly output_schema_sha256: string;
}

export interface ProductProofBotIntegrationV1 {
    readonly integration_id: string;
    readonly provider_deployment_id: string;
    readonly provider_version_id: string;
    readonly provider_specification_id: string;
    readonly auth: ProductProofMetorialAuthBindingV1;
    readonly permission_pins: readonly ProductProofBotPermissionPinV1[];
}

export interface ProductProofMetorialSessionIntentV1 {
    readonly intent_version: "openbot_metorial_session_intent_v1";
    readonly metorial_api_version: string;
    readonly serialization_identity: string;
    readonly providers: readonly {
        readonly provider_deployment_id: string;
        readonly provider_version_id: string;
        readonly provider_specification_id: string;
        readonly auth: ProductProofMetorialAuthBindingV1;
        readonly allowed_tool_keys: readonly string[];
    }[];
}

export interface ProductProofBotV1 {
    readonly bot_id: string;
    readonly account_id: string;
    readonly owner_user_id: string;
    readonly name: string;
    readonly short_description: string;
    readonly palette_color_id: string;
    readonly avatar_shape_id: string;
    readonly avatar_face_id: string;
    readonly purpose: string;
    readonly standing_instructions: string;
    readonly integrations: readonly ProductProofBotIntegrationV1[];
    readonly created_at_ms: number;
}

export interface ProductProofConfirmationV1 {
    readonly confirmation_id: string;
    readonly account_id: string;
    readonly bot_id: string;
    readonly prompt: string;
    readonly metorial_session_intent: ProductProofMetorialSessionIntentV1;
    readonly metorial_authority_snapshot: readonly ProductProofBotIntegrationV1[];
    readonly permissions_snapshot: readonly ProductProofPermissionV1[];
    readonly created_at_ms: number;
    readonly expires_at_ms: number;
    readonly state: "pending" | "started";
}

export interface ProductProofRunV1 {
    readonly run_id: string;
    readonly account_id: string;
    readonly bot_id: string;
    readonly confirmation_id: string;
    readonly prompt: string;
    readonly result_text: string | null;
    readonly execution_state: "running" | "completed";
    readonly cleanup_state: "not_required";
    readonly evidence_state: "synthetic_test_only";
    readonly created_at_ms: number;
    readonly completed_at_ms: number | null;
}

export interface ProductProofRoutineProposalV1 {
    readonly proposal_id: string;
    readonly account_id: string;
    readonly bot_id: string;
    readonly name: string;
    readonly prompt: string;
    readonly schedule: string;
    readonly metorial_session_intent: ProductProofMetorialSessionIntentV1;
    readonly metorial_authority_snapshot: readonly ProductProofBotIntegrationV1[];
    readonly permissions_snapshot: readonly ProductProofPermissionV1[];
    readonly created_at_ms: number;
    readonly expires_at_ms: number;
    readonly state: "pending" | "saved";
}

export interface ProductProofRoutineV1 {
    readonly routine_id: string;
    readonly account_id: string;
    readonly bot_id: string;
    readonly name: string;
    readonly prompt: string;
    readonly schedule: string;
    readonly revision: number;
    readonly metorial_session_intent: ProductProofMetorialSessionIntentV1;
    readonly metorial_authority_snapshot: readonly ProductProofBotIntegrationV1[];
    readonly permissions_snapshot: readonly ProductProofPermissionV1[];
    readonly created_at_ms: number;
    readonly updated_at_ms: number;
}

export interface ProductProofRepositoryV1 {
    listBots(accountId: string): Promise<readonly ProductProofBotV1[]>;
    createBot(input: {
        readonly account_id: string;
        readonly owner_user_id: string;
        readonly name: string;
        readonly short_description: string;
        readonly palette_color_id: string;
        readonly avatar_shape_id: string;
        readonly avatar_face_id: string;
        readonly purpose: string;
        readonly standing_instructions: string;
        readonly integrations: readonly ProductProofBotIntegrationV1[];
        readonly created_at_ms: number;
    }): Promise<ProductProofBotV1>;
    getBot(accountId: string, botId: string): Promise<ProductProofBotV1 | null>;
    createConfirmation(input: {
        readonly account_id: string;
        readonly bot_id: string;
        readonly prompt: string;
        readonly metorial_session_intent: ProductProofMetorialSessionIntentV1;
        readonly metorial_authority_snapshot: readonly ProductProofBotIntegrationV1[];
        readonly permissions_snapshot: readonly ProductProofPermissionV1[];
        readonly created_at_ms: number;
        readonly expires_at_ms: number;
    }): Promise<ProductProofConfirmationV1>;
    getConfirmation(accountId: string, confirmationId: string): Promise<ProductProofConfirmationV1 | null>;
    claimConfirmation(input: {
        readonly account_id: string;
        readonly confirmation_id: string;
        readonly claimed_at_ms: number;
    }): Promise<ProductProofRunV1 | null>;
    completeRun(input: {
        readonly account_id: string;
        readonly run_id: string;
        readonly result_text: string;
        readonly completed_at_ms: number;
    }): Promise<ProductProofRunV1 | null>;
    getRun(accountId: string, botId: string, runId: string): Promise<ProductProofRunV1 | null>;
    listRoutines(accountId: string, botId: string): Promise<readonly ProductProofRoutineV1[]>;
    getRoutine(accountId: string, botId: string, routineId: string): Promise<ProductProofRoutineV1 | null>;
    createRoutineProposal(input: {
        readonly account_id: string;
        readonly bot_id: string;
        readonly name: string;
        readonly prompt: string;
        readonly schedule: string;
        readonly metorial_session_intent: ProductProofMetorialSessionIntentV1;
        readonly metorial_authority_snapshot: readonly ProductProofBotIntegrationV1[];
        readonly permissions_snapshot: readonly ProductProofPermissionV1[];
        readonly created_at_ms: number;
        readonly expires_at_ms: number;
    }): Promise<ProductProofRoutineProposalV1>;
    getRoutineProposal(accountId: string, proposalId: string): Promise<ProductProofRoutineProposalV1 | null>;
    saveRoutineProposal(input: {
        readonly account_id: string;
        readonly proposal_id: string;
        readonly saved_at_ms: number;
    }): Promise<ProductProofRoutineV1 | null>;
    updateRoutine(input: {
        readonly account_id: string;
        readonly bot_id: string;
        readonly routine_id: string;
        readonly expected_revision: number;
        readonly name: string;
        readonly prompt: string;
        readonly schedule: string;
        readonly metorial_session_intent: ProductProofMetorialSessionIntentV1;
        readonly metorial_authority_snapshot: readonly ProductProofBotIntegrationV1[];
        readonly permissions_snapshot: readonly ProductProofPermissionV1[];
        readonly updated_at_ms: number;
    }): Promise<ProductProofRoutineV1 | null>;
}

export interface ProductProofTaskExecutorV1 {
    execute(input: {
        readonly account_id: string;
        readonly user_id: string;
        readonly run_id: string;
        readonly bot: ProductProofBotV1;
        readonly prompt: string;
        readonly permissions: readonly ProductProofPermissionV1[];
        readonly metorial_session_intent: ProductProofMetorialSessionIntentV1;
    }): Promise<{ readonly result_text: string }>;
}

export interface ControlPlaneProductProofDependenciesV1 {
    readonly resolveActor: (request: Request) => Promise<ControlPlaneActorV1 | null>;
    readonly listMetorialIntegrations: (
        accountId: string,
        userId: string
    ) => Promise<readonly ProductProofMetorialIntegrationV1[]>;
    readonly listMetorialCatalogApps?: (() => Promise<readonly ProductProofMetorialCatalogAppV1[]>) | undefined;
    readonly metorial_api_version: string;
    readonly metorial_session_serialization_identity: string;
    readonly repository: ProductProofRepositoryV1;
    readonly taskExecutor: ProductProofTaskExecutorV1;
    readonly setOrganizationPermissionEnabled?:
        | ((input: {
              readonly account_id: string;
              readonly user_id: string;
              readonly integration_id: string;
              readonly policy_id: string;
              readonly enabled: boolean;
          }) => Promise<boolean>)
        | undefined;
    readonly now?: (() => number) | undefined;
}

interface ProductProofBotColorV1 {
    readonly color_id: string;
    readonly display_name: string;
    readonly hex: string;
    readonly soft_hex: string;
}

interface ProductProofBotFaceV1 {
    readonly face_id: string;
    readonly display_name: string;
    readonly eyes: "calm" | "happy" | "small" | "uneven" | "sleepy" | "sparkle";
    readonly mouth: "line" | "smile" | "smirk" | "grin";
}

const BOT_COLOR_CATALOG_V1: readonly ProductProofBotColorV1[] = Object.freeze([
    Object.freeze({ color_id: "graphite", display_name: "Graphite", hex: "#54565c", soft_hex: "#dfe0e3" }),
    Object.freeze({ color_id: "stone", display_name: "Stone", hex: "#817971", soft_hex: "#e7e2dd" }),
    Object.freeze({ color_id: "sand", display_name: "Sand", hex: "#c1a875", soft_hex: "#f3ead8" }),
    Object.freeze({ color_id: "coral", display_name: "Coral", hex: "#d67670", soft_hex: "#f9dedb" }),
    Object.freeze({ color_id: "amber", display_name: "Amber", hex: "#d39a38", soft_hex: "#f6e8c9" }),
    Object.freeze({ color_id: "lime", display_name: "Lime", hex: "#7fa154", soft_hex: "#e5edda" }),
    Object.freeze({ color_id: "teal", display_name: "Teal", hex: "#408f82", soft_hex: "#d9ece8" }),
    Object.freeze({ color_id: "sky", display_name: "Sky", hex: "#5a8fc1", soft_hex: "#dce9f4" }),
    Object.freeze({ color_id: "violet", display_name: "Violet", hex: "#856dad", soft_hex: "#e8e0f2" }),
    Object.freeze({ color_id: "pink", display_name: "Pink", hex: "#d95f91", soft_hex: "#f7dce7" }),
]);

const BOT_SHAPE_CATALOG_V1 = Object.freeze([
    Object.freeze({ shape_id: "round", display_name: "Round" }),
    Object.freeze({ shape_id: "squircle", display_name: "Soft square" }),
    Object.freeze({ shape_id: "hexagon", display_name: "Hexagon" }),
]);

const BOT_FACE_CATALOG_V1: readonly ProductProofBotFaceV1[] = Object.freeze([
    Object.freeze({ face_id: "calm", display_name: "Calm", eyes: "calm", mouth: "line" }),
    Object.freeze({ face_id: "cheerful", display_name: "Cheerful", eyes: "happy", mouth: "smile" }),
    Object.freeze({ face_id: "focused", display_name: "Focused", eyes: "small", mouth: "line" }),
    Object.freeze({ face_id: "curious", display_name: "Curious", eyes: "uneven", mouth: "smirk" }),
    Object.freeze({ face_id: "sleepy", display_name: "Sleepy", eyes: "sleepy", mouth: "line" }),
    Object.freeze({ face_id: "bright", display_name: "Bright", eyes: "sparkle", mouth: "grin" }),
]);

const colorById = new Map(BOT_COLOR_CATALOG_V1.map(color => [color.color_id, color]));
const shapeById = new Map<string, (typeof BOT_SHAPE_CATALOG_V1)[number]>(
    BOT_SHAPE_CATALOG_V1.map(shape => [shape.shape_id, shape])
);
const faceById = new Map(BOT_FACE_CATALOG_V1.map(face => [face.face_id, face]));
const moodsStyle = new Style(moodsDefinition);

const escapeHtml = (value: string): string =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const avatarDataUri = (input: {
    readonly seed: string;
    readonly colorId: string;
    readonly faceId: string;
    readonly animated: boolean;
}): string => {
    const color = colorById.get(input.colorId) ?? BOT_COLOR_CATALOG_V1[0];
    const face = faceById.get(input.faceId) ?? BOT_FACE_CATALOG_V1[0];
    if (color === undefined || face === undefined) throw new Error("Bot appearance catalogs must not be empty");
    return new Avatar(moodsStyle, {
        seed: input.seed,
        backgroundColor: color.hex,
        faceColor: color.hex,
        inkColor: "#222221",
        eyesVariant: face.eyes,
        mouthVariant: face.mouth,
        animationVariant: input.animated ? "slowest" : "none",
    }).toDataUri();
};

const safeText = (value: FormDataEntryValue | null, maximumBytes: number, multiline = false): string | null => {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return null;
    if (
        (multiline ? unsafeContentCharacters : unsafeDisplayCharacters).test(value) ||
        new TextEncoder().encode(value).byteLength > maximumBytes
    ) {
        return null;
    }
    return value;
};

const safeId = (value: string): boolean => /^[a-z0-9][a-z0-9_-]{0,127}$/u.test(value);
const safeMetorialId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,253}$/u.test(value);
const safeConfiguredMetorialIdentity = (value: string): boolean =>
    /^[A-Za-z0-9][A-Za-z0-9._:@/+_-]{0,253}$/u.test(value);
const safeCatalogDisplayText = (value: string, maximumBytes: number): boolean =>
    value.length > 0 &&
    value === value.trim() &&
    !unsafeDisplayCharacters.test(value) &&
    new TextEncoder().encode(value).byteLength <= maximumBytes;
const validMetorialAuthBinding = (auth: ProductProofMetorialAuthBindingV1): boolean => {
    if (auth === null || typeof auth !== "object") return false;
    const keys = Object.keys(auth).sort();
    if (auth.mode === "user_grant") {
        return (
            keys.length === 2 &&
            keys[0] === "connection_grant_id" &&
            keys[1] === "mode" &&
            safeId(auth.connection_grant_id)
        );
    }
    return (auth.mode === "deployment" || auth.mode === "authless") && keys.length === 1 && keys[0] === "mode";
};
const sameMetorialAuthBinding = (
    left: ProductProofMetorialAuthBindingV1,
    right: ProductProofMetorialAuthBindingV1
): boolean =>
    left.mode === right.mode &&
    (left.mode !== "user_grant" ||
        (right.mode === "user_grant" && left.connection_grant_id === right.connection_grant_id));
const frozenMetorialAuthBinding = (auth: ProductProofMetorialAuthBindingV1): ProductProofMetorialAuthBindingV1 =>
    auth.mode === "user_grant"
        ? Object.freeze({ mode: "user_grant", connection_grant_id: auth.connection_grant_id })
        : Object.freeze({ mode: auth.mode });

const validIntegrationCatalogEntry = (integration: ProductProofMetorialIntegrationV1): boolean => {
    const policyIds = new Set<string>();
    const toolKeys = new Set<string>();
    return (
        safeId(integration.integration_id) &&
        /^[a-z0-9][a-z0-9-]{0,127}$/u.test(integration.provider_identifier) &&
        safeMetorialId(integration.provider_deployment_id) &&
        safeMetorialId(integration.provider_version_id) &&
        safeMetorialId(integration.provider_specification_id) &&
        validMetorialAuthBinding(integration.auth) &&
        safeCatalogDisplayText(integration.connected_account_label, 512) &&
        safeCatalogDisplayText(integration.display_name, MAX_NAME_BYTES) &&
        safeCatalogDisplayText(integration.description, MAX_DESCRIPTION_BYTES) &&
        integration.permissions.length <= 256 &&
        integration.permissions.every(permission => {
            if (
                permission.integration_id !== integration.integration_id ||
                !safeId(permission.policy_id) ||
                !safeCatalogDisplayText(permission.display_name, MAX_NAME_BYTES) ||
                !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/u.test(permission.tool_key) ||
                !safeCatalogDisplayText(permission.consequence_summary, MAX_DESCRIPTION_BYTES) ||
                !safeCatalogDisplayText(permission.resource_scope_summary, MAX_DESCRIPTION_BYTES) ||
                !safeId(permission.policy_revision) ||
                !/^[a-f0-9]{64}$/u.test(permission.policy_sha256) ||
                !/^[a-f0-9]{64}$/u.test(permission.input_schema_sha256) ||
                !/^[a-f0-9]{64}$/u.test(permission.output_schema_sha256) ||
                policyIds.has(permission.policy_id) ||
                toolKeys.has(permission.tool_key)
            ) {
                return false;
            }
            policyIds.add(permission.policy_id);
            toolKeys.add(permission.tool_key);
            return true;
        })
    );
};

const validIntegrationCatalog = (catalog: readonly ProductProofMetorialIntegrationV1[]): boolean => {
    const integrationIds = new Set<string>();
    return catalog.every(integration => {
        if (integrationIds.has(integration.integration_id) || !validIntegrationCatalogEntry(integration)) return false;
        integrationIds.add(integration.integration_id);
        return true;
    });
};

const selectedIntegrationBindings = (
    bot: ProductProofBotV1,
    catalog: readonly ProductProofMetorialIntegrationV1[]
):
    | readonly {
          readonly selection: ProductProofBotIntegrationV1;
          readonly integration: ProductProofMetorialIntegrationV1;
          readonly permissions: readonly ProductProofPermissionV1[];
      }[]
    | null => {
    if (bot.integrations.length < 1 || bot.integrations.length > 16 || !validIntegrationCatalog(catalog)) return null;
    const selectedIds = new Set<string>();
    const bindings = bot.integrations.map(selection => {
        if (
            selectedIds.has(selection.integration_id) ||
            !validMetorialAuthBinding(selection.auth) ||
            selection.permission_pins.length < 1 ||
            new Set(selection.permission_pins.map(pin => pin.policy_id)).size !== selection.permission_pins.length
        ) {
            return null;
        }
        selectedIds.add(selection.integration_id);
        const integration = catalog.find(
            candidate =>
                candidate.integration_id === selection.integration_id &&
                candidate.provider_deployment_id === selection.provider_deployment_id &&
                candidate.provider_version_id === selection.provider_version_id &&
                candidate.provider_specification_id === selection.provider_specification_id &&
                validMetorialAuthBinding(candidate.auth) &&
                sameMetorialAuthBinding(candidate.auth, selection.auth)
        );
        if (
            integration === undefined ||
            integration.connection_state !== "connected" ||
            !validIntegrationCatalogEntry(integration)
        ) {
            return null;
        }
        const permissions = selection.permission_pins.map(pin =>
            integration.permissions.find(
                permission =>
                    permission.policy_id === pin.policy_id &&
                    permission.enabled &&
                    permission.policy_revision === pin.policy_revision &&
                    permission.policy_sha256 === pin.policy_sha256 &&
                    permission.tool_key === pin.tool_key &&
                    permission.effect === pin.effect &&
                    permission.input_schema_sha256 === pin.input_schema_sha256 &&
                    permission.output_schema_sha256 === pin.output_schema_sha256
            )
        );
        if (permissions.length < 1 || permissions.some(permission => permission === undefined)) return null;
        return Object.freeze({
            selection,
            integration,
            permissions: Object.freeze(permissions as ProductProofPermissionV1[]),
        });
    });
    return bindings.some(binding => binding === null)
        ? null
        : Object.freeze(
              bindings as readonly {
                  readonly selection: ProductProofBotIntegrationV1;
                  readonly integration: ProductProofMetorialIntegrationV1;
                  readonly permissions: readonly ProductProofPermissionV1[];
              }[]
          );
};

const freezeBotAuthoritySnapshot = (
    integrations: readonly ProductProofBotIntegrationV1[]
): readonly ProductProofBotIntegrationV1[] =>
    Object.freeze(
        integrations.map(integration =>
            Object.freeze({
                integration_id: integration.integration_id,
                provider_deployment_id: integration.provider_deployment_id,
                provider_version_id: integration.provider_version_id,
                provider_specification_id: integration.provider_specification_id,
                auth: frozenMetorialAuthBinding(integration.auth),
                permission_pins: Object.freeze(
                    integration.permission_pins.map(permission => Object.freeze({ ...permission }))
                ),
            })
        )
    );

const freezePermissionSnapshot = (
    permissions: readonly ProductProofPermissionV1[]
): readonly ProductProofPermissionV1[] =>
    Object.freeze(permissions.map(permission => Object.freeze({ ...permission })));

const authorityMatchesSnapshot = (
    snapshot: {
        readonly metorial_session_intent: ProductProofMetorialSessionIntentV1;
        readonly metorial_authority_snapshot: readonly ProductProofBotIntegrationV1[];
        readonly permissions_snapshot: readonly ProductProofPermissionV1[];
    },
    bot: ProductProofBotV1,
    permissions: readonly ProductProofPermissionV1[],
    metorialSessionIntent: ProductProofMetorialSessionIntentV1
): boolean =>
    sameMetorialSessionIntent(snapshot.metorial_session_intent, metorialSessionIntent) &&
    JSON.stringify(snapshot.metorial_authority_snapshot) === JSON.stringify(bot.integrations) &&
    JSON.stringify(snapshot.permissions_snapshot) === JSON.stringify(permissions);

const authorityMatchesConfirmation = (
    confirmation: ProductProofConfirmationV1,
    bot: ProductProofBotV1,
    permissions: readonly ProductProofPermissionV1[],
    metorialSessionIntent: ProductProofMetorialSessionIntentV1
): boolean => authorityMatchesSnapshot(confirmation, bot, permissions, metorialSessionIntent);

const compileMetorialSessionIntent = (
    dependencies: ControlPlaneProductProofDependenciesV1,
    bindings: NonNullable<ReturnType<typeof selectedIntegrationBindings>>
): ProductProofMetorialSessionIntentV1 | null => {
    if (
        !safeConfiguredMetorialIdentity(dependencies.metorial_api_version) ||
        !safeConfiguredMetorialIdentity(dependencies.metorial_session_serialization_identity)
    ) {
        return null;
    }
    return Object.freeze({
        intent_version: "openbot_metorial_session_intent_v1" as const,
        metorial_api_version: dependencies.metorial_api_version,
        serialization_identity: dependencies.metorial_session_serialization_identity,
        providers: Object.freeze(
            bindings.map(binding =>
                Object.freeze({
                    provider_deployment_id: binding.integration.provider_deployment_id,
                    provider_version_id: binding.integration.provider_version_id,
                    provider_specification_id: binding.integration.provider_specification_id,
                    auth: frozenMetorialAuthBinding(binding.integration.auth),
                    allowed_tool_keys: Object.freeze(binding.permissions.map(permission => permission.tool_key).sort()),
                })
            )
        ),
    });
};

const sameMetorialSessionIntent = (
    left: ProductProofMetorialSessionIntentV1,
    right: ProductProofMetorialSessionIntentV1
): boolean => JSON.stringify(left) === JSON.stringify(right);

const clientRoutineBindings = (
    routines: readonly ProductProofRoutineV1[],
    bot: ProductProofBotV1,
    permissions: readonly ProductProofPermissionV1[],
    metorialSessionIntent: ProductProofMetorialSessionIntentV1
): readonly { readonly routine: ProductProofRoutineV1; readonly blocked: boolean }[] =>
    routines.map(routine => ({
        routine,
        blocked: !authorityMatchesSnapshot(routine, bot, permissions, metorialSessionIntent),
    }));

const styles = `
:root {
    color-scheme: dark;
    --font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-family: var(--font-sans);
    --canvas: #222221;
    --surface: #2f2f2e;
    --surface-raised: #363635;
    --sidebar: #121211;
    --sidebar-hover: #252524;
    --ink: #ececea;
    --muted: #a7a7a2;
    --faint: #777772;
    --line: #3b3b39;
    --line-strong: #575753;
    --signature: #d95f91;
    --signature-soft: rgba(217,95,145,.16);
    --positive: #62c9a7;
    --positive-soft: rgba(70,169,137,.16);
    --danger: #ff9a90;
    --danger-soft: rgba(180,35,24,.18);
    background: var(--canvas);
    color: var(--ink);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--canvas); font-size: 15px; font-weight: 400; line-height: 1.5; letter-spacing: 0; font-synthesis: none; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
.skip-link { position: fixed; z-index: 10; top: .5rem; left: .5rem; padding: .55rem .75rem; border-radius: .45rem; background: var(--ink); color: var(--canvas); transform: translateY(-150%); }
.skip-link:focus { transform: translateY(0); }
a { color: inherit; text-underline-offset: .18em; }
a:hover { text-decoration-thickness: 2px; }
a:focus-visible, button:focus-visible { outline: 3px solid var(--signature); outline-offset: 3px; }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: .45rem; font-size: 2rem; line-height: 1.1; letter-spacing: -.03em; font-weight: 600; }
h2 { margin-bottom: .45rem; font-size: 1.125rem; line-height: 1.35; letter-spacing: -.015em; font-weight: 600; }
.shell { min-height: 100vh; display: grid; grid-template-columns: 17.5rem minmax(0, 1fr); background: linear-gradient(to right, var(--sidebar) 0 17.5rem, var(--canvas) 17.5rem); }
.shell.has-context { grid-template-columns: 17.5rem minmax(0, 1fr) 20rem; }
.sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; padding: .75rem; background: var(--sidebar); }
.sidebar-primary { min-height: 0; flex: 1; overflow: auto; }
.brand { display: flex; align-items: center; gap: .7rem; min-height: 2.75rem; padding: .4rem .55rem; color: var(--ink); font-size: .93rem; font-weight: 600; text-decoration: none; }
.brand-mark { width: 1.8rem; height: 1.8rem; display: grid; place-items: center; border-radius: 50%; background: var(--signature); color: #fff; font-size: .7rem; font-weight: 700; letter-spacing: -.025em; }
.new-bot { display: flex; align-items: center; gap: .65rem; margin-top: .55rem; padding: .68rem .72rem; border: 1px solid var(--line); border-radius: .65rem; background: rgba(255,255,255,.035); font-size: .9rem; font-weight: 500; text-decoration: none; }
.new-bot:hover { background: var(--surface); }
.plus { color: var(--muted); font-size: 1.2rem; line-height: 1; }
.section-label, .eyebrow { color: var(--muted); font-size: .6875rem; line-height: 1.2; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; }
.section-label { margin: 1.5rem .65rem .45rem; }
.eyebrow { margin-bottom: .75rem; }
.bot-list { list-style: none; padding: 0; margin: 0; display: grid; gap: .18rem; }
.bot-list a { display: grid; gap: .12rem; padding: .62rem .68rem; border-radius: .58rem; text-decoration: none; }
.bot-list a:hover { background: var(--sidebar-hover); }
.bot-list a[aria-current='page'] { background: #2b2b2a; }
.bot-list .bot-row > span:last-child { min-width: 0; display: grid; }
.bot-list .bot-row > span:last-child > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .875rem; font-weight: 500; }
.bot-list small, .muted { color: var(--muted); }
.bot-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8125rem; line-height: 1.35; font-weight: 400; }
.account { display: grid; grid-template-columns: 2rem 1fr; align-items: center; gap: .65rem; padding: .7rem .55rem .3rem; border-top: 1px solid var(--line); }
.account-avatar { width: 2rem; height: 2rem; display: grid; place-items: center; border-radius: 50%; background: #31312f; font-size: .7rem; font-weight: 600; }
.account small { display: block; color: var(--muted); font-size: .75rem; line-height: 1.35; }
.account-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .875rem; font-weight: 500; }
.account-organization { min-width: 0; display: grid; color: inherit; text-decoration: none; }
.account-organization:hover .account-name { text-decoration: underline; text-underline-offset: .18em; }
main { min-width: 0; padding: 4rem clamp(1.5rem, 6vw, 6rem); }
.has-context main { min-height: 100vh; padding: 0 clamp(1.25rem, 4vw, 3rem) 2rem; }
.content { width: 100%; max-width: 49rem; margin: 0 auto; }
.context-panel { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 1.1rem; border-left: 1px solid var(--line); background: #191817; }
.context-head { display: flex; align-items: center; gap: .65rem; padding: .25rem 0 1rem; }
.context-head h2 { margin: 0; }
.context-section { padding: 1rem 0; border-top: 1px solid var(--line); }
.context-section h3 { margin: 0 0 .7rem; font-size: .75rem; line-height: 1.2; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.context-list { display: grid; gap: .65rem; margin: 0; }
.context-list div { display: grid; gap: .12rem; }
.context-list dt { color: var(--muted); font-size: .75rem; line-height: 1.35; font-weight: 500; }
.context-list dd { margin: 0; font-size: .8125rem; line-height: 1.45; font-weight: 400; overflow-wrap: anywhere; }
.context-tools { list-style: none; display: grid; gap: .5rem; padding: 0; margin: .7rem 0 0; }
.context-tools li { display: grid; gap: .08rem; padding: .65rem; border: 1px solid var(--line); border-radius: .6rem; background: rgba(255,255,255,.035); font-size: .8125rem; line-height: 1.45; font-weight: 400; }
.context-integration + .context-integration { margin-top: .9rem; padding-top: .9rem; border-top: 1px solid var(--line); }
.context-integration-head { display: grid; grid-template-columns: 2rem minmax(0, 1fr); align-items: center; gap: .6rem; }
.context-integration-head > span:last-child { min-width: 0; display: grid; }
.routine-empty { padding: .8rem; border: 1px dashed var(--line-strong); border-radius: .65rem; color: var(--muted); font-size: .8125rem; line-height: 1.45; }
.routine-list { list-style: none; display: grid; gap: .5rem; padding: 0; margin: 0; }
.routine-list a { display: grid; gap: .16rem; padding: .7rem; border: 1px solid var(--line); border-radius: .6rem; background: rgba(255,255,255,.035); font-size: .8125rem; text-decoration: none; }
.routine-list a > span:not(.status-badge) { color: var(--muted); }
.chat-header { position: sticky; z-index: 2; top: 0; display: flex; align-items: center; gap: .75rem; min-height: 4rem; padding: .75rem 0; border-bottom: 1px solid var(--line); background: var(--canvas); }
.chat-header h1 { margin: 0; font-size: 1rem; line-height: 1.25; font-weight: 600; letter-spacing: -.015em; }
.chat-header p { margin: 0; font-size: .8125rem; line-height: 1.35; }
.chat-page { min-height: 100vh; display: flex; flex-direction: column; }
.chat-empty { display: grid; justify-items: center; padding: clamp(4rem, 10vh, 7rem) 1rem 3rem; text-align: center; }
.chat-page .chat-empty { flex: 1; align-content: center; }
.chat-empty h2 { margin-top: 1.15rem; font-size: 1.5rem; line-height: 1.25; font-weight: 600; letter-spacing: -.02em; }
.chat-empty p { max-width: 30rem; }
.chat-composer { padding: .75rem; border: 1px solid var(--line-strong); border-radius: 1rem; background: var(--surface); box-shadow: 0 14px 36px rgba(0,0,0,.22); }
.chat-composer form { gap: .55rem; }
.chat-composer textarea { min-height: 6rem; padding: .6rem; border: 0; background: transparent; box-shadow: none; }
.composer-note { color: var(--muted); font-size: .75rem; line-height: 1.4; }
.routine-builder { border-top: 1px solid var(--line); padding-top: .65rem; }
.routine-builder summary { width: fit-content; color: var(--muted); font-size: .8125rem; font-weight: 500; cursor: pointer; }
.routine-fields { display: grid; grid-template-columns: 1fr 1.35fr auto; align-items: end; gap: .65rem; padding-top: .75rem; }
.routine-fields input { background: #292928; }
.routine-edit-head { margin-top: 2rem; }
.page-head, .actions { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.page-head { align-items: flex-start; margin-bottom: 2rem; }
.page-head p { margin-bottom: 0; }
.card, fieldset { margin: 1rem 0; padding: 1.35rem; border: 1px solid var(--line); border-radius: .9rem; background: var(--surface); }
.card { box-shadow: 0 1px 2px rgba(0,0,0,.025); }
.empty-state { padding: 4rem 2rem; text-align: center; }
.empty-mark { width: 2.7rem; height: 2.7rem; display: grid; place-items: center; margin: 0 auto 1rem; border-radius: 50%; background: #393937; color: var(--ink); font-weight: 700; }
form { display: grid; gap: 1rem; }
fieldset { display: grid; gap: 1rem; }
legend { padding: 0 .35rem; font-size: .9375rem; line-height: 1.3; font-weight: 600; letter-spacing: -.01em; }
label { display: grid; gap: .45rem; font-size: .8125rem; line-height: 1.4; font-weight: 500; }
input[type='text'], input[type='search'], textarea, select { width: 100%; padding: .78rem .85rem; border: 1px solid var(--line-strong); border-radius: .62rem; background: var(--surface); color: var(--ink); font: 400 15px/1.5 var(--font-sans); letter-spacing: 0; outline: none; transition: border-color 120ms, box-shadow 120ms; }
input[type='text']:focus, input[type='search']:focus, textarea:focus, select:focus { border-color: var(--signature); box-shadow: 0 0 0 3px rgba(217,95,145,.13); }
textarea { min-height: 7rem; resize: vertical; }
button, .button { display: inline-flex; align-items: center; justify-content: center; min-height: 2.55rem; padding: .66rem 1rem; border: 1px solid var(--ink); border-radius: .58rem; background: var(--ink); color: #20201f; font: 600 14px/1 var(--font-sans); letter-spacing: 0; text-decoration: none; cursor: pointer; }
button:hover, .button:hover { background: #d7d7d4; }
.button.secondary, .button.tertiary { border-color: var(--line); background: var(--surface); color: var(--ink); }
.button.secondary:hover, .button.tertiary:hover { background: var(--surface-raised); }
.compact-page-head { margin-bottom: 1rem; }
.new-bot-form { gap: .8rem; }
.setup-stack { display: grid; gap: .55rem; }
.setup-section { overflow: hidden; border: 1px solid var(--line); border-radius: .78rem; background: var(--surface); }
.setup-section.open { border-color: var(--line-strong); }
.setup-section h2 { margin: 0; }
button.setup-section-toggle { width: 100%; min-height: 4.1rem; display: grid; grid-template-columns: 1.65rem minmax(0, 1fr) auto; align-items: center; justify-content: stretch; gap: .75rem; padding: .7rem .85rem; border: 0; border-radius: 0; background: transparent; color: var(--ink); text-align: left; }
button.setup-section-toggle:hover { background: var(--surface-raised); }
button.setup-section-toggle:focus-visible { outline: 3px solid var(--signature-soft); outline-offset: -3px; }
.setup-step { width: 1.65rem; height: 1.65rem; display: grid; place-items: center; border: 1px solid var(--line-strong); border-radius: 50%; color: var(--muted); font-size: .6875rem; font-weight: 600; }
.setup-step.complete { border-color: #356e58; background: var(--positive-soft); color: var(--positive); }
.setup-section-copy { min-width: 0; display: grid; gap: .08rem; }
.setup-section-copy strong { font-size: .875rem; line-height: 1.3; font-weight: 600; }
.setup-section-copy small { overflow: hidden; color: var(--muted); font-size: .75rem; line-height: 1.35; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
.setup-section-action { color: var(--faint); font-size: .6875rem; font-weight: 600; }
.setup-section-panel { display: grid; gap: .85rem; padding: .9rem; border-top: 1px solid var(--line); background: #292928; }
.setup-section-panel[hidden] { display: none; }
.compact-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.compact-field-grid textarea { min-height: 5.5rem; }
.setup-panel-actions { display: flex; justify-content: flex-end; }
.setup-panel-actions .button { min-height: 2.15rem; padding: .5rem .7rem; font-size: .75rem; }
.setup-note { margin: 0; font-size: .75rem; }
.setup-section-panel .color-options { grid-template-columns: repeat(10, minmax(0, 1fr)); }
.setup-section-panel .face-options { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.setup-section-panel .face-preview { width: 3.1rem; height: 3.1rem; }
.setup-form-actions { margin-top: .2rem; padding-top: .75rem; border-top: 1px solid var(--line); }
.text-link { color: var(--muted); font-size: .875rem; font-weight: 500; }
.error-summary { padding: 1rem 1.15rem; border: 1px solid #7c3e39; border-radius: .75rem; background: var(--danger-soft); color: #ffc2bc; }
.error-summary h2 { color: var(--danger); }
label.choice { position: relative; grid-template-columns: auto 1fr; align-items: start; gap: .85rem; padding: 1rem; border: 1px solid var(--line); border-radius: .75rem; background: #292928; font-size: .8125rem; font-weight: 500; cursor: pointer; }
label.choice:has(input:checked) { border-color: var(--ink); background: var(--surface); box-shadow: 0 0 0 1px var(--ink); }
label.choice:has(input:disabled) { color: var(--faint); background: #242423; cursor: not-allowed; }
label.choice input { width: 1rem; height: 1rem; margin: .18rem 0 0; accent-color: var(--signature); }
.organization-permissions { padding-top: .25rem; }
.integration-card .organization-permissions { display: grid !important; }
.organization-permission { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; padding: 1rem; border: 1px solid var(--line); border-radius: .75rem; background: #292928; }
.organization-permission form { display: block; }
.organization-permission button { white-space: nowrap; }
.choice-title { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
.effect-badge, .status-badge { display: inline-flex; align-items: center; width: fit-content; border-radius: 999px; font-size: .6875rem; line-height: 1.2; font-weight: 600; letter-spacing: .045em; text-transform: uppercase; }
.effect-badge { padding: .17rem .45rem; background: #40403d; color: var(--muted); }
.effect-badge.read, .status-badge.good { background: var(--positive-soft); color: var(--positive); }
.permission-meta { display: grid; gap: .12rem; margin-top: .28rem; color: var(--muted); font-size: .8125rem; line-height: 1.45; font-weight: 400; }
.technical { color: var(--muted); font-family: var(--font-mono); font-size: .75rem; line-height: 1.45; font-weight: 400; letter-spacing: 0; }
.integration-options { display: grid; gap: .75rem; }
.integration-card { overflow: hidden; border: 1px solid var(--line); border-radius: .8rem; background: #292928; }
.integration-card:has(.integration-choice input:checked) { border-color: var(--line-strong); }
.integration-choice { position: relative; grid-template-columns: auto 2rem minmax(0, 1fr) auto; align-items: center; gap: .75rem; padding: .9rem; cursor: pointer; }
.integration-choice input { width: 1rem; height: 1rem; accent-color: var(--signature); }
.integration-mark { width: 2rem; height: 2rem; display: grid; place-items: center; border: 1px solid var(--line); border-radius: .48rem; background: var(--surface-raised); font-weight: 700; }
.integration-mark img { display: block; width: 1.35rem; height: 1.35rem; object-fit: contain; }
.integration-choice > span:nth-child(3) { min-width: 0; display: grid; gap: .12rem; }
.integration-choice strong { font-size: .875rem; font-weight: 500; }
.integration-choice small { color: var(--muted); font-size: .8125rem; line-height: 1.4; font-weight: 400; }
.permission-stack { display: grid; gap: .55rem; padding: 0 .75rem .75rem; }
.integration-card:not(:has(.integration-choice input:checked)) .permission-stack { display: none; }
.visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
.app-picker { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(18rem, .75fr); gap: .8rem; }
.app-catalog, .selected-apps, .app-detail { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: .82rem; background: #292928; }
.app-section-head { min-height: 4.75rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .9rem 1rem; border-bottom: 1px solid var(--line); }
.app-section-head h2, .app-detail-head h2 { margin: 0; font-size: .9375rem; line-height: 1.35; font-weight: 600; letter-spacing: -.01em; }
.app-section-head p, .app-detail-head p, .app-detail-copy p { margin: .18rem 0 0; color: var(--muted); font-size: .75rem; line-height: 1.45; font-weight: 400; }
.app-search { width: min(11.5rem, 45%); }
.app-search input { min-height: 2.25rem; padding: .45rem .7rem; border-color: var(--line); background: var(--surface); font-size: .8125rem; }
.app-grid { max-height: 22rem; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; padding: .75rem; overflow: auto; }
.featured-app-grid { max-height: none; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: visible; }
.app-search-results { grid-template-columns: 1fr; }
button.app-tile { position: relative; min-width: 0; min-height: 5.6rem; display: grid; grid-template-columns: 2rem minmax(0, 1fr); align-items: start; justify-content: stretch; gap: .7rem; padding: .8rem; border: 1px solid var(--line); border-radius: .7rem; background: var(--surface); color: var(--ink); text-align: left; }
button.app-tile:hover { border-color: var(--line-strong); background: var(--surface-raised); }
button.app-tile:focus-visible, button.selected-app-open:focus-visible, button.remove-app:focus-visible { outline: 3px solid var(--signature-soft); outline-offset: 1px; border-color: var(--signature); }
button.app-tile.selected { border-color: #6a6a66; background: #343432; box-shadow: inset 0 0 0 1px #6a6a66; }
button.app-tile.needs-connection { background: #292928; }
button.app-tile.needs-connection .integration-mark { opacity: .72; }
button.app-tile.compact { min-height: 5.15rem; grid-template-columns: 1fr; place-items: center; align-content: center; gap: .38rem; padding: .65rem .35rem; text-align: center; }
button.app-tile.compact .app-tile-copy { padding: 0; justify-items: center; }
button.app-tile.compact .app-tile-copy strong { max-width: 100%; font-size: .75rem; white-space: normal; }
button.app-tile.compact .app-tile-copy small { display: none; }
button.app-tile.compact .app-tile-action { position: static; font-size: .625rem; }
.app-tile-copy { min-width: 0; display: grid; gap: .18rem; padding-right: 2.7rem; }
.app-tile-copy strong { overflow: hidden; font-size: .875rem; line-height: 1.3; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.app-tile-copy small { display: -webkit-box; overflow: hidden; color: var(--muted); font-size: .75rem; line-height: 1.4; font-weight: 400; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.app-tile-action { position: absolute; top: .72rem; right: .72rem; color: var(--muted); font-size: .6875rem; line-height: 1.3; font-weight: 600; }
.app-tile-action.added { color: var(--positive); }
.app-empty { margin: 0; padding: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .8125rem; }
.app-search-summary { margin: 0; padding: .7rem .85rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .75rem; }
.app-count { min-width: 1.7rem; height: 1.7rem; display: grid; place-items: center; border-radius: 999px; background: #3a3a38; color: var(--muted); font-size: .75rem; font-weight: 600; }
.selected-apps-empty { min-height: 8rem; display: grid; place-items: center; align-content: center; gap: .55rem; padding: 1rem; color: var(--muted); font-size: .8125rem; text-align: center; }
.empty-app-mark { width: 2rem; height: 2rem; display: grid; place-items: center; border: 1px dashed var(--line-strong); border-radius: .55rem; color: var(--faint); font-size: 1rem; }
.selected-app-list { display: grid; gap: .5rem; padding: .75rem; }
.selected-app-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; overflow: hidden; border: 1px solid var(--line); border-radius: .68rem; background: var(--surface); }
.selected-app-row.active { border-color: #6a6a66; box-shadow: inset 3px 0 0 var(--signature); }
button.selected-app-open { min-width: 0; min-height: 4rem; display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto; justify-content: stretch; gap: .68rem; padding: .65rem .7rem; border: 0; border-radius: 0; background: transparent; color: var(--ink); text-align: left; }
button.selected-app-open:hover { background: var(--surface-raised); }
.selected-app-open > span:nth-child(2) { min-width: 0; display: grid; gap: .1rem; }
.selected-app-open strong, .selected-app-open small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected-app-open strong { font-size: .8125rem; line-height: 1.35; font-weight: 600; }
.selected-app-open small { color: var(--muted); font-size: .6875rem; line-height: 1.4; font-weight: 400; }
.selected-app-permissions { color: var(--muted); font-size: .6875rem; line-height: 1.3; font-weight: 500; white-space: nowrap; }
button.remove-app { min-height: 2rem; margin-right: .55rem; padding: .38rem .55rem; border-color: transparent; background: transparent; color: var(--faint); font-size: .6875rem; }
button.remove-app:hover { border-color: var(--line); background: #333331; color: var(--ink); }
.app-detail { grid-column: 1 / -1; }
.inline-app-detail { grid-column: auto; border: 0; border-top: 1px solid var(--line); border-radius: 0; background: transparent; }
.app-detail-head { display: grid; grid-template-columns: 2.4rem minmax(0, 1fr) auto; align-items: center; gap: .8rem; padding: 1rem; border-bottom: 1px solid var(--line); }
.app-detail-head .integration-mark { width: 2.4rem; height: 2.4rem; }
.app-detail-head .integration-mark img { width: 1.6rem; height: 1.6rem; }
.app-detail-head .eyebrow { margin: 0 0 .08rem; color: var(--signature); font-size: .625rem; }
.app-detail-copy { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: .8rem 1rem; }
.app-detail-copy p { margin: 0; }
.app-permissions { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 0 1rem 1rem; }
.app-permissions label.choice { min-width: 0; }
.inline-app-detail .app-detail-head { grid-template-columns: 2rem minmax(0, 1fr); padding: .75rem; }
.inline-app-detail .app-detail-head .integration-mark { width: 2rem; height: 2rem; }
.inline-app-detail .app-detail-head .status-badge { display: none; }
.inline-app-detail .app-detail-copy { display: block; padding: .65rem .75rem; }
.inline-app-detail .app-permissions { max-height: 22rem; grid-template-columns: 1fr; padding: 0 .75rem .75rem; overflow: auto; }
.inline-app-detail .app-permissions label.choice { padding: .75rem; }
.appearance-group { display: grid; gap: .65rem; }
.appearance-label { margin: .2rem 0 0; font-size: .8125rem; font-weight: 500; }
.color-options { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .55rem; }
.color-choice, .shape-choice, .face-choice { position: relative; display: grid; place-items: center; gap: .42rem; padding: .65rem .35rem; border: 1px solid var(--line); border-radius: .7rem; background: #292928; color: var(--muted); font-size: .75rem; font-weight: 500; cursor: pointer; }
.color-choice input, .shape-choice input, .face-choice input { position: absolute; z-index: 1; top: .45rem; left: .45rem; width: 1px; height: 1px; opacity: 0; }
.color-choice:has(input:checked), .shape-choice:has(input:checked), .face-choice:has(input:checked) { border-color: var(--ink); background: var(--surface); box-shadow: 0 0 0 1px var(--ink); color: var(--ink); }
.color-choice:focus-within, .shape-choice:focus-within, .face-choice:focus-within { outline: 3px solid var(--signature-soft); border-color: var(--signature); }
.swatch { width: 1.5rem; height: 1.5rem; border: 3px solid #ececea; border-radius: 50%; background: var(--swatch); box-shadow: 0 0 0 1px rgba(0,0,0,.4); }
.shape-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .55rem; }
.shape-sample { width: 2.2rem; height: 2.2rem; background: #787b82; }
.round { border-radius: 50%; }
.squircle { border-radius: 27%; }
.hexagon { clip-path: polygon(25% 6.7%,75% 6.7%,100% 50%,75% 93.3%,25% 93.3%,0 50%); }
.face-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .55rem; }
.face-choice { padding: .75rem .45rem; }
.face-preview { width: 4.4rem; height: 4.4rem; overflow: hidden; background: #343432; }
.face-preview img, .bot-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
.bot-avatar { flex: 0 0 auto; display: inline-block; overflow: hidden; background: #343432; vertical-align: middle; }
.bot-avatar.small { width: 2rem; height: 2rem; }
.bot-avatar.large { width: 6.5rem; height: 6.5rem; }
.avatar-motion, .avatar-static { display: block; width: 100%; height: 100%; }
.avatar-static { display: none; }
.bot-row { display: grid; grid-template-columns: 2rem minmax(0, 1fr); align-items: center; gap: .65rem; }
.bot-title { display: flex; align-items: center; gap: 1.1rem; }
.summary-list { list-style: none; padding: 0; margin: 1rem 0 0; }
.summary-list li { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .8rem 0; border-top: 1px solid var(--line); }
.composer { padding: 1.4rem; }
.composer textarea { min-height: 9rem; background: #292928; }
.prompt-preview { padding: 1rem; border-radius: .7rem; background: #292928; white-space: pre-wrap; }
.disclosure-list { display: grid; grid-template-columns: 7rem 1fr; gap: .7rem 1rem; margin: 1rem 0; }
.disclosure-group { display: contents; }
.disclosure-list dt { color: var(--muted); font-size: .75rem; line-height: 1.4; font-weight: 500; }
.disclosure-list dd { margin: 0; font-size: .875rem; line-height: 1.5; font-weight: 400; }
.notice { padding-top: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .84rem; }
.conversation { display: grid; gap: 1.8rem; margin: 2rem 0; }
.chat-transcript { min-height: calc(100vh - 12rem); display: flex; flex-direction: column; }
.chat-transcript .conversation { flex: 1; align-content: end; }
.result-transcript .conversation { flex: 0; align-content: start; }
.review-conversation { padding-top: 2rem; }
.review-card { max-width: 42rem; margin: 0; }
.message { display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: .85rem; }
.message.user { grid-template-columns: minmax(0, 1fr); justify-items: end; }
.message-avatar { width: 2rem; height: 2rem; display: grid; place-items: center; border-radius: 50%; background: var(--ink); color: white; font-size: .7rem; font-weight: 700; }
.message-copy { min-width: 0; max-width: 68ch; font-size: 1rem; line-height: 1.6; font-weight: 400; }
.message.user .message-copy { max-width: 68ch; padding: .8rem 1rem; border-radius: 1.15rem 1.15rem .3rem 1.15rem; background: #3a3a38; }
.message-copy h2 { margin-bottom: .6rem; font-size: .875rem; line-height: 1.4; font-weight: 600; letter-spacing: 0; }
.message-copy .review-title { font-size: 1.125rem; line-height: 1.35; letter-spacing: -.015em; }
pre.result { margin: 0; max-width: 68ch; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); font: 400 1rem/1.6 var(--font-sans); letter-spacing: 0; }
.status-strip { display: flex; flex-wrap: wrap; gap: .55rem; padding: 1rem 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.status-item { display: inline-flex; align-items: center; gap: .4rem; color: var(--muted); font-size: .78rem; }
.status-badge { padding: .2rem .5rem; background: #40403d; color: var(--muted); }
.login-shell { min-height: 100vh; display: grid; place-items: center; padding: 2rem; background: var(--surface); }
.login-card { width: min(100%, 25rem); text-align: center; }
.login-card .brand-mark { margin: 0 auto 1.25rem; width: 2.5rem; height: 2.5rem; }
@media (prefers-reduced-motion: reduce) {
    .avatar-animated { display: none !important; }
    .avatar-static { display: block; }
}
@media (max-width: 1080px) and (min-width: 761px) {
    .shell.has-context { grid-template-columns: 14rem minmax(22rem, 1fr) 17rem; }
    .shell { background: linear-gradient(to right, var(--sidebar) 0 14rem, var(--canvas) 14rem); }
    .sidebar { padding: .55rem; }
    .has-context main { padding-inline: 1rem; }
    .context-panel { padding: .8rem; }
    .app-picker { grid-template-columns: 1fr; }
    .app-detail { grid-column: auto; }
}
@media (max-width: 760px) {
    .shell { grid-template-columns: 1fr; }
    .shell { background: var(--canvas); }
    .shell.has-context { grid-template-columns: 1fr; }
    .sidebar { position: static; height: auto; max-height: 22rem; border-bottom: 1px solid var(--line); }
    .account { display: none; }
    main { padding: 2.5rem 1.15rem; }
    .page-head { display: grid; }
    .page-head .button { width: 100%; }
    .disclosure-list { grid-template-columns: 1fr; gap: .15rem; }
    .disclosure-list dd { margin-bottom: .65rem; }
    .color-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .face-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .routine-fields { grid-template-columns: 1fr; }
    .compact-field-grid { grid-template-columns: 1fr; }
    .setup-section-panel .color-options { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .setup-section-panel .face-options { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .app-picker { grid-template-columns: 1fr; }
    .app-detail { grid-column: auto; }
    .app-section-head { align-items: flex-start; }
    .app-search { width: 45%; }
    .app-grid, .app-permissions { grid-template-columns: 1fr; }
    .featured-app-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .app-detail-copy { display: grid; }
    .context-panel { position: static; height: auto; border-top: 1px solid var(--line); border-left: 0; }
}
`;

const serializeClientPage = (value: unknown): string =>
    JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

const clientPermission = (permission: ProductProofPermissionV1): OpenBotClientPermissionV1 => ({
    policy_id: permission.policy_id,
    display_name: permission.display_name,
    tool_key: permission.tool_key,
    effect: permission.effect,
    consequence_summary: permission.consequence_summary,
    resource_scope_summary: permission.resource_scope_summary,
    enabled: permission.enabled,
});

const safeIntegrationIconDataUri = (value: string | null | undefined): string | null =>
    typeof value === "string" &&
    value.length <= 96 * 1024 &&
    /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/u.test(value)
        ? value
        : null;

const clientIntegration = (integration: ProductProofMetorialIntegrationV1): OpenBotClientIntegrationV1 => ({
    integration_id: integration.integration_id,
    provider_identifier: integration.provider_identifier,
    connected_account_label: integration.connected_account_label,
    display_name: integration.display_name,
    description: integration.description,
    icon_data_uri: safeIntegrationIconDataUri(integration.icon_data_uri),
    connection_state: integration.connection_state,
    permissions: integration.permissions.map(clientPermission),
});

const clientCatalogApps = (
    integrations: readonly ProductProofMetorialIntegrationV1[],
    catalog: readonly ProductProofMetorialCatalogAppV1[]
): readonly OpenBotClientCatalogAppV1[] => {
    const connectedByIdentifier = new Map(
        integrations.map(integration => [integration.provider_identifier, integration.integration_id])
    );
    const fallbackCatalog: readonly ProductProofMetorialCatalogAppV1[] = integrations.map(integration => ({
        identifier: integration.provider_identifier,
        display_name: integration.display_name,
        description: integration.description,
        categories: [],
        icon_url: null,
    }));
    const catalogIds = new Set<string>();
    return (catalog.length === 0 ? fallbackCatalog : catalog).flatMap(entry => {
        if (
            !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(entry.identifier) ||
            catalogIds.has(entry.identifier) ||
            !safeCatalogDisplayText(entry.display_name, MAX_NAME_BYTES) ||
            !safeCatalogDisplayText(entry.description, 2_048) ||
            entry.categories.length > 32 ||
            !entry.categories.every(category => /^[a-z0-9][a-z0-9-]{0,127}$/u.test(category)) ||
            (entry.icon_url !== null &&
                !/^https:\/\/provider-logos\.metorial-cdn\.com\/[A-Za-z0-9%._-]+$/u.test(entry.icon_url))
        ) {
            return [];
        }
        catalogIds.add(entry.identifier);
        return [{ ...entry, connected_integration_id: connectedByIdentifier.get(entry.identifier) ?? null }];
    });
};

const clientBot = (bot: ProductProofBotV1): OpenBotClientBotV1 => ({
    bot_id: bot.bot_id,
    name: bot.name,
    short_description: bot.short_description,
    avatar_shape_id: shapeById.has(bot.avatar_shape_id) ? bot.avatar_shape_id : "squircle",
    avatar_data_uri: avatarDataUri({
        seed: bot.bot_id,
        colorId: bot.palette_color_id,
        faceId: bot.avatar_face_id,
        animated: false,
    }),
});

const clientBotDetail = (
    bot: ProductProofBotV1,
    bindings: NonNullable<ReturnType<typeof selectedIntegrationBindings>>,
    routines: readonly { readonly routine: ProductProofRoutineV1; readonly blocked: boolean }[] = []
): OpenBotClientBotDetailV1 => {
    const color = colorById.get(bot.palette_color_id);
    const shape = shapeById.get(bot.avatar_shape_id);
    const face = faceById.get(bot.avatar_face_id);
    return {
        ...clientBot(bot),
        purpose: bot.purpose,
        standing_instructions: bot.standing_instructions,
        appearance_summary: `${color?.display_name ?? "Graphite"} · ${shape?.display_name ?? "Soft square"} · ${face?.display_name ?? "Calm"}`,
        access: bindings.map(binding => {
            const { permissions: _permissions, ...integration } = clientIntegration(binding.integration);
            return { integration, permissions: binding.permissions.map(clientPermission) };
        }),
        routines: routines.map(({ routine, blocked }) => ({
            routine_id: routine.routine_id,
            name: routine.name,
            schedule: routine.schedule,
            blocked,
        })),
    };
};

const document = (input: {
    readonly title: string;
    readonly actor: ControlPlaneActorV1;
    readonly bots: readonly ProductProofBotV1[];
    readonly selectedBotId?: string | undefined;
    readonly view: OpenBotClientViewV1;
}): string => {
    const clientPage: OpenBotClientPageV1 = {
        page_version: "openbot_react_page_v1" as const,
        title: input.title,
        actor: {
            display_name: input.actor.display_name,
            role: input.actor.role,
            organization_name: input.actor.organization_name,
        },
        bots: input.bots.map(clientBot),
        selected_bot_id: input.selectedBotId ?? null,
        view: input.view,
    };
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)} · OpenBot</title>
<style>${styles}</style>
</head>
<body><div id="root"><div class="login-shell" aria-busy="true"><p class="muted">Opening OpenBot…</p></div></div>
<script id="openbot-page" type="application/json">${serializeClientPage(clientPage)}</script>
<script type="module" src="/assets/openbot-client.js"></script>
</body>
</html>`;
};

const loginDocument = (): string =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · OpenBot</title><style>${styles}</style></head><body><div class="login-shell"><div class="login-card"><span class="brand-mark" aria-hidden="true">OB</span><h1>Sign in</h1><p class="muted">Authentication is not configured for this installation.</p></div></div></body></html>`;

const renderNewBot = async (
    actor: ControlPlaneActorV1,
    repository: ProductProofRepositoryV1,
    integrations: readonly ProductProofMetorialIntegrationV1[],
    catalog: readonly ProductProofMetorialCatalogAppV1[],
    error: string | null = null,
    _selectedIds: readonly string[] = []
): Promise<string> =>
    document({
        title: "New Bot",
        actor,
        bots: await repository.listBots(actor.account_id),
        view: {
            kind: "new_bot",
            csrf_token: actor.csrf_token,
            error,
            integrations: integrations.filter(validIntegrationCatalogEntry).map(clientIntegration),
            catalog_apps: clientCatalogApps(integrations.filter(validIntegrationCatalogEntry), catalog),
            colors: BOT_COLOR_CATALOG_V1.map(color => ({
                id: color.color_id,
                display_name: color.display_name,
                preview: color.hex,
            })),
            shapes: BOT_SHAPE_CATALOG_V1.map(shape => ({ id: shape.shape_id, display_name: shape.display_name })),
            faces: BOT_FACE_CATALOG_V1.map(face => ({
                id: face.face_id,
                display_name: face.display_name,
                preview: avatarDataUri({
                    seed: `face_preview_${face.face_id}`,
                    colorId: "sky",
                    faceId: face.face_id,
                    animated: false,
                }),
            })),
        },
    });

const requireActor = async (
    request: Request,
    dependencies: ControlPlaneProductProofDependenciesV1
): Promise<ControlPlaneActorV1 | null> => {
    try {
        return await dependencies.resolveActor(request);
    } catch {
        return null;
    }
};

const validCsrf = (form: FormData, actor: ControlPlaneActorV1): boolean => form.get("_csrf") === actor.csrf_token;

const validOrigin = (request: Request): boolean => request.headers.get("Origin") === new URL(request.url).origin;

const formIntegrationSelections = (
    form: FormData,
    catalog: readonly ProductProofMetorialIntegrationV1[]
): readonly ProductProofBotIntegrationV1[] | null => {
    const integrationIds = form.getAll("integration");
    if (
        !validIntegrationCatalog(catalog) ||
        integrationIds.length < 1 ||
        integrationIds.length > 16 ||
        integrationIds.some(value => typeof value !== "string") ||
        new Set(integrationIds).size !== integrationIds.length
    ) {
        return null;
    }
    let permissionCount = 0;
    const selections = (integrationIds as string[]).map(integrationId => {
        const integration = catalog.find(candidate => candidate.integration_id === integrationId);
        if (
            integration === undefined ||
            integration.connection_state !== "connected" ||
            !validIntegrationCatalogEntry(integration)
        ) {
            return null;
        }
        const rawPolicyIds = form.getAll(`permission.${integrationId}`);
        if (
            rawPolicyIds.length < 1 ||
            rawPolicyIds.some(value => typeof value !== "string") ||
            new Set(rawPolicyIds).size !== rawPolicyIds.length
        ) {
            return null;
        }
        const policyIds = rawPolicyIds as string[];
        permissionCount += policyIds.length;
        if (
            !policyIds.every(
                policyId =>
                    integration.permissions.find(permission => permission.policy_id === policyId)?.enabled === true
            )
        ) {
            return null;
        }
        return Object.freeze({
            integration_id: integration.integration_id,
            provider_deployment_id: integration.provider_deployment_id,
            provider_version_id: integration.provider_version_id,
            provider_specification_id: integration.provider_specification_id,
            auth: frozenMetorialAuthBinding(integration.auth),
            permission_pins: Object.freeze(
                policyIds.map(policyId => {
                    const permission = integration.permissions.find(candidate => candidate.policy_id === policyId)!;
                    return Object.freeze({
                        policy_id: permission.policy_id,
                        policy_revision: permission.policy_revision,
                        policy_sha256: permission.policy_sha256,
                        tool_key: permission.tool_key,
                        effect: permission.effect,
                        input_schema_sha256: permission.input_schema_sha256,
                        output_schema_sha256: permission.output_schema_sha256,
                    });
                })
            ),
        });
    });
    return permissionCount > 64 || selections.some(selection => selection === null)
        ? null
        : Object.freeze(selections as ProductProofBotIntegrationV1[]);
};

const unavailable = (context: { text(value: string, status: 503): Response }): Response =>
    context.text("Product flow unavailable", 503);

export const registerProductProofRoutesV1 = (
    app: Hono<{ Bindings: ControlPlaneBindings }>,
    dependencies: ControlPlaneProductProofDependenciesV1 | undefined
): void => {
    app.get("/login", context => context.html(loginDocument()));

    app.get("/", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        return actor === null ? context.redirect("/login", 302) : context.redirect("/bots", 302);
    });

    app.get("/bots", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const bots = await dependencies.repository.listBots(actor.account_id);
        return context.html(
            document({
                title: "Bots",
                actor,
                bots,
                view: { kind: "bots", has_bots: bots.length > 0 },
            })
        );
    });

    app.get("/organization/settings", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const [bots, integrations] = await Promise.all([
            dependencies.repository.listBots(actor.account_id),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
        ]);
        if (!validIntegrationCatalog(integrations)) return context.text("Organization catalog unavailable", 409);
        return context.html(
            document({
                title: "Organization settings",
                actor,
                bots,
                view: {
                    kind: "organization_settings",
                    csrf_token: actor.csrf_token,
                    organization_name: actor.organization_name,
                    integrations: integrations.map(clientIntegration),
                    can_manage: actor.role === "owner",
                },
            })
        );
    });

    app.post("/actions/organization-permissions", async context => {
        if (dependencies === undefined || dependencies.setOrganizationPermissionEnabled === undefined) {
            return unavailable(context);
        }
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.text("Unauthorized", 401);
        if (actor.role !== "owner") return context.text("Forbidden", 403);
        if (!validOrigin(context.req.raw)) return context.text("Invalid origin", 403);
        const form = await context.req.formData();
        if (!validCsrf(form, actor)) return context.text("Invalid CSRF token", 403);
        const integrationId = form.get("integration_id");
        const policyId = form.get("policy_id");
        const enabledValue = form.get("enabled");
        if (
            typeof integrationId !== "string" ||
            !safeId(integrationId) ||
            typeof policyId !== "string" ||
            !safeId(policyId) ||
            (enabledValue !== "true" && enabledValue !== "false")
        ) {
            return context.text("Invalid organization permission", 422);
        }
        const integrations = await dependencies.listMetorialIntegrations(actor.account_id, actor.user_id);
        if (!validIntegrationCatalog(integrations)) return context.text("Organization catalog unavailable", 409);
        const permission = integrations
            .find(integration => integration.integration_id === integrationId)
            ?.permissions.find(candidate => candidate.policy_id === policyId);
        if (permission === undefined) return context.text("Organization permission unavailable", 409);
        const updated = await dependencies.setOrganizationPermissionEnabled({
            account_id: actor.account_id,
            user_id: actor.user_id,
            integration_id: integrationId,
            policy_id: policyId,
            enabled: enabledValue === "true",
        });
        if (!updated) return context.text("Organization permission conflict", 409);
        return context.redirect("/organization/settings", 303);
    });

    app.get("/bots/new", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        if (actor.role !== "owner") return context.text("Forbidden", 403);
        const [integrations, catalog] = await Promise.all([
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
            dependencies.listMetorialCatalogApps?.() ?? Promise.resolve([]),
        ]);
        return context.html(await renderNewBot(actor, dependencies.repository, integrations, catalog));
    });

    app.post("/actions/bots", async context => {
        if (dependencies === undefined) return unavailable(context);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.text("Unauthorized", 401);
        if (actor.role !== "owner") return context.text("Forbidden", 403);
        if (!validOrigin(context.req.raw)) return context.text("Invalid origin", 403);
        const form = await context.req.formData();
        if (!validCsrf(form, actor)) return context.text("Invalid CSRF token", 403);
        const name = safeText(form.get("name"), MAX_NAME_BYTES);
        const shortDescription = safeText(form.get("short_description"), MAX_DESCRIPTION_BYTES);
        const purpose = safeText(form.get("purpose"), MAX_PURPOSE_BYTES, true);
        const standingInstructions = safeText(form.get("standing_instructions"), MAX_INSTRUCTIONS_BYTES, true);
        const palette = form.get("palette_color_id");
        const avatarShape = form.get("avatar_shape_id");
        const avatarFace = form.get("avatar_face_id");
        const [integrations, catalog] = await Promise.all([
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
            dependencies.listMetorialCatalogApps?.() ?? Promise.resolve([]),
        ]);
        const integrationSelections = formIntegrationSelections(form, integrations);
        if (
            name === null ||
            shortDescription === null ||
            purpose === null ||
            standingInstructions === null ||
            typeof palette !== "string" ||
            !colorById.has(palette) ||
            typeof avatarShape !== "string" ||
            !shapeById.has(avatarShape) ||
            typeof avatarFace !== "string" ||
            !faceById.has(avatarFace) ||
            integrationSelections === null
        ) {
            return context.html(
                await renderNewBot(
                    actor,
                    dependencies.repository,
                    integrations,
                    catalog,
                    "Enter every field and select at least one available integration permission.",
                    []
                ),
                422
            );
        }
        const bot = await dependencies.repository.createBot({
            account_id: actor.account_id,
            owner_user_id: actor.user_id,
            name,
            short_description: shortDescription,
            palette_color_id: palette,
            avatar_shape_id: avatarShape,
            avatar_face_id: avatarFace,
            purpose,
            standing_instructions: standingInstructions,
            integrations: integrationSelections,
            created_at_ms: (dependencies.now ?? Date.now)(),
        });
        return context.redirect(`/bots/${encodeURIComponent(bot.bot_id)}`, 303);
    });

    app.get("/bots/:botId", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const botId = context.req.param("botId");
        if (!safeId(botId)) return context.notFound();
        const [bot, bots, integrations, routines] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, botId),
            dependencies.repository.listBots(actor.account_id),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
            dependencies.repository.listRoutines(actor.account_id, botId),
        ]);
        if (bot === null) return context.notFound();
        const bindings = selectedIntegrationBindings(bot, integrations);
        if (bindings === null) return context.text("Bot integrations unavailable", 409);
        const currentSessionIntent = compileMetorialSessionIntent(dependencies, bindings);
        if (currentSessionIntent === null) return context.text("Metorial configuration unavailable", 409);
        const currentPermissions = bindings.flatMap(binding => binding.permissions);
        return context.html(
            document({
                title: bot.name,
                actor,
                bots,
                selectedBotId: bot.bot_id,
                view: {
                    kind: "bot_chat",
                    csrf_token: actor.csrf_token,
                    bot: clientBotDetail(
                        bot,
                        bindings,
                        clientRoutineBindings(routines, bot, currentPermissions, currentSessionIntent)
                    ),
                },
            })
        );
    });

    app.post("/actions/run-confirmations", async context => {
        if (dependencies === undefined) return unavailable(context);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.text("Unauthorized", 401);
        if (actor.role !== "owner") return context.text("Forbidden", 403);
        if (!validOrigin(context.req.raw)) return context.text("Invalid origin", 403);
        const form = await context.req.formData();
        if (!validCsrf(form, actor)) return context.text("Invalid CSRF token", 403);
        const botId = form.get("bot_id");
        const prompt = safeText(form.get("prompt"), MAX_PROMPT_BYTES, true);
        if (typeof botId !== "string" || !safeId(botId) || prompt === null) {
            return context.text("Invalid task", 422);
        }
        const [bot, integrations] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, botId),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
        ]);
        const bindings = bot === null ? null : selectedIntegrationBindings(bot, integrations);
        if (bot === null || bindings === null) {
            return context.text("Bot unavailable", 409);
        }
        const metorialSessionIntent = compileMetorialSessionIntent(dependencies, bindings);
        if (metorialSessionIntent === null) return context.text("Metorial configuration unavailable", 409);
        const permissionsSnapshot = freezePermissionSnapshot(bindings.flatMap(binding => binding.permissions));
        const metorialAuthoritySnapshot = freezeBotAuthoritySnapshot(bot.integrations);
        const now = (dependencies.now ?? Date.now)();
        const confirmation = await dependencies.repository.createConfirmation({
            account_id: actor.account_id,
            bot_id: bot.bot_id,
            prompt,
            metorial_session_intent: metorialSessionIntent,
            metorial_authority_snapshot: metorialAuthoritySnapshot,
            permissions_snapshot: permissionsSnapshot,
            created_at_ms: now,
            expires_at_ms: now + CONFIRMATION_LIFETIME_MS,
        });
        return context.redirect(`/run-confirmations/${encodeURIComponent(confirmation.confirmation_id)}`, 303);
    });

    app.get("/run-confirmations/:confirmationId", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const confirmationId = context.req.param("confirmationId");
        if (!safeId(confirmationId)) return context.notFound();
        const confirmation = await dependencies.repository.getConfirmation(actor.account_id, confirmationId);
        if (confirmation === null) return context.notFound();
        const [bot, bots, integrations, routines] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, confirmation.bot_id),
            dependencies.repository.listBots(actor.account_id),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
            dependencies.repository.listRoutines(actor.account_id, confirmation.bot_id),
        ]);
        if (bot === null) return context.notFound();
        const bindings = selectedIntegrationBindings(bot, integrations);
        if (bindings === null) return context.text("Bot integrations unavailable", 409);
        const currentSessionIntent = compileMetorialSessionIntent(dependencies, bindings);
        if (currentSessionIntent === null) return context.text("Metorial configuration unavailable", 409);
        const currentPermissions = bindings.flatMap(binding => binding.permissions);
        const drifted = !authorityMatchesConfirmation(confirmation, bot, currentPermissions, currentSessionIntent);
        const permissions = confirmation.permissions_snapshot;
        const expired = confirmation.expires_at_ms <= (dependencies.now ?? Date.now)();
        const available = confirmation.state === "pending" && !expired && !drifted;
        return context.html(
            document({
                title: "Review task",
                actor,
                bots,
                selectedBotId: bot.bot_id,
                view: {
                    kind: "confirmation",
                    csrf_token: actor.csrf_token,
                    bot: clientBotDetail(
                        bot,
                        bindings,
                        clientRoutineBindings(routines, bot, currentPermissions, currentSessionIntent)
                    ),
                    confirmation_id: confirmation.confirmation_id,
                    prompt: confirmation.prompt,
                    providers: confirmation.metorial_session_intent.providers.map((provider, index) => ({
                        display_name: bindings[index]?.integration.display_name ?? "Unavailable provider",
                        connected_account_label:
                            bindings[index]?.integration.connected_account_label ?? "Unavailable account",
                        allowed_tool_keys: provider.allowed_tool_keys,
                    })),
                    permissions: permissions.map(clientPermission),
                    available,
                    unavailable_reason: available
                        ? null
                        : expired
                          ? "This confirmation expired."
                          : drifted
                            ? "Metorial access changed after review. Return to chat and review again."
                            : "This confirmation already started a run.",
                },
            })
        );
    });

    app.post("/actions/routine-proposals", async context => {
        if (dependencies === undefined) return unavailable(context);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.text("Unauthorized", 401);
        if (actor.role !== "owner") return context.text("Forbidden", 403);
        if (!validOrigin(context.req.raw)) return context.text("Invalid origin", 403);
        const form = await context.req.formData();
        if (!validCsrf(form, actor)) return context.text("Invalid CSRF token", 403);
        const botId = form.get("bot_id");
        const name = safeText(form.get("routine_name"), MAX_NAME_BYTES);
        const prompt = safeText(form.get("prompt"), MAX_PROMPT_BYTES, true);
        const schedule = safeText(form.get("schedule"), MAX_SCHEDULE_BYTES);
        if (typeof botId !== "string" || !safeId(botId) || name === null || prompt === null || schedule === null) {
            return context.text("Enter a routine name, schedule, and message", 422);
        }
        const [bot, integrations] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, botId),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
        ]);
        const bindings = bot === null ? null : selectedIntegrationBindings(bot, integrations);
        if (bot === null || bindings === null) return context.text("Bot unavailable", 409);
        const metorialSessionIntent = compileMetorialSessionIntent(dependencies, bindings);
        if (metorialSessionIntent === null) return context.text("Metorial configuration unavailable", 409);
        const now = (dependencies.now ?? Date.now)();
        const proposal = await dependencies.repository.createRoutineProposal({
            account_id: actor.account_id,
            bot_id: bot.bot_id,
            name,
            prompt,
            schedule,
            metorial_session_intent: metorialSessionIntent,
            metorial_authority_snapshot: freezeBotAuthoritySnapshot(bot.integrations),
            permissions_snapshot: freezePermissionSnapshot(bindings.flatMap(binding => binding.permissions)),
            created_at_ms: now,
            expires_at_ms: now + CONFIRMATION_LIFETIME_MS,
        });
        return context.redirect(`/routine-proposals/${encodeURIComponent(proposal.proposal_id)}`, 303);
    });

    app.get("/routine-proposals/:proposalId", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const proposalId = context.req.param("proposalId");
        if (!safeId(proposalId)) return context.notFound();
        const proposal = await dependencies.repository.getRoutineProposal(actor.account_id, proposalId);
        if (proposal === null) return context.notFound();
        const [bot, bots, integrations, routines] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, proposal.bot_id),
            dependencies.repository.listBots(actor.account_id),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
            dependencies.repository.listRoutines(actor.account_id, proposal.bot_id),
        ]);
        if (bot === null) return context.notFound();
        const bindings = selectedIntegrationBindings(bot, integrations);
        if (bindings === null) return context.text("Bot integrations unavailable", 409);
        const currentSessionIntent = compileMetorialSessionIntent(dependencies, bindings);
        if (currentSessionIntent === null) return context.text("Metorial configuration unavailable", 409);
        const currentPermissions = bindings.flatMap(binding => binding.permissions);
        const drifted = !authorityMatchesSnapshot(proposal, bot, currentPermissions, currentSessionIntent);
        const expired = proposal.expires_at_ms <= (dependencies.now ?? Date.now)();
        const available = proposal.state === "pending" && !expired && !drifted;
        return context.html(
            document({
                title: "Review routine",
                actor,
                bots,
                selectedBotId: bot.bot_id,
                view: {
                    kind: "routine_proposal",
                    csrf_token: actor.csrf_token,
                    bot: clientBotDetail(
                        bot,
                        bindings,
                        clientRoutineBindings(routines, bot, currentPermissions, currentSessionIntent)
                    ),
                    proposal_id: proposal.proposal_id,
                    name: proposal.name,
                    prompt: proposal.prompt,
                    schedule: proposal.schedule,
                    permissions: proposal.permissions_snapshot.map(clientPermission),
                    available,
                    unavailable_reason: available
                        ? null
                        : expired
                          ? "This routine draft expired."
                          : drifted
                            ? "Metorial access changed after review. Return to chat and create the draft again."
                            : "This routine draft was already saved.",
                },
            })
        );
    });

    app.post("/actions/routines", async context => {
        if (dependencies === undefined) return unavailable(context);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.text("Unauthorized", 401);
        if (actor.role !== "owner") return context.text("Forbidden", 403);
        if (!validOrigin(context.req.raw)) return context.text("Invalid origin", 403);
        const form = await context.req.formData();
        if (!validCsrf(form, actor)) return context.text("Invalid CSRF token", 403);
        const proposalId = form.get("proposal_id");
        if (typeof proposalId !== "string" || !safeId(proposalId)) return context.text("Invalid routine", 422);
        const now = (dependencies.now ?? Date.now)();
        const proposal = await dependencies.repository.getRoutineProposal(actor.account_id, proposalId);
        if (proposal === null || proposal.state !== "pending" || proposal.expires_at_ms <= now) {
            return context.text("Routine draft unavailable", 409);
        }
        const [bot, integrations] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, proposal.bot_id),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
        ]);
        if (bot === null) return context.text("Bot unavailable", 409);
        const bindings = selectedIntegrationBindings(bot, integrations);
        if (bindings === null) return context.text("Bot integrations unavailable", 409);
        const currentSessionIntent = compileMetorialSessionIntent(dependencies, bindings);
        if (currentSessionIntent === null) return context.text("Metorial configuration unavailable", 409);
        const currentPermissions = bindings.flatMap(binding => binding.permissions);
        if (!authorityMatchesSnapshot(proposal, bot, currentPermissions, currentSessionIntent)) {
            return context.text("Metorial access changed after review", 409);
        }
        const routine = await dependencies.repository.saveRoutineProposal({
            account_id: actor.account_id,
            proposal_id: proposal.proposal_id,
            saved_at_ms: now,
        });
        if (routine === null) return context.text("Routine conflict", 409);
        return context.redirect(`/bots/${encodeURIComponent(routine.bot_id)}`, 303);
    });

    app.get("/bots/:botId/routines/:routineId", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const botId = context.req.param("botId");
        const routineId = context.req.param("routineId");
        if (!safeId(botId) || !safeId(routineId)) return context.notFound();
        const [bot, routine, bots, integrations, routines] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, botId),
            dependencies.repository.getRoutine(actor.account_id, botId, routineId),
            dependencies.repository.listBots(actor.account_id),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
            dependencies.repository.listRoutines(actor.account_id, botId),
        ]);
        if (bot === null || routine === null) return context.notFound();
        const bindings = selectedIntegrationBindings(bot, integrations);
        if (bindings === null) return context.text("Bot integrations unavailable", 409);
        const currentSessionIntent = compileMetorialSessionIntent(dependencies, bindings);
        if (currentSessionIntent === null) return context.text("Metorial configuration unavailable", 409);
        const currentPermissions = bindings.flatMap(binding => binding.permissions);
        const routineBindings = clientRoutineBindings(routines, bot, currentPermissions, currentSessionIntent);
        const blocked = !authorityMatchesSnapshot(routine, bot, currentPermissions, currentSessionIntent);
        return context.html(
            document({
                title: `Edit ${routine.name}`,
                actor,
                bots,
                selectedBotId: bot.bot_id,
                view: {
                    kind: "routine_edit",
                    csrf_token: actor.csrf_token,
                    bot: clientBotDetail(bot, bindings, routineBindings),
                    routine_id: routine.routine_id,
                    revision: routine.revision,
                    name: routine.name,
                    prompt: routine.prompt,
                    schedule: routine.schedule,
                    blocked,
                },
            })
        );
    });

    app.post("/actions/routines/:routineId", async context => {
        if (dependencies === undefined) return unavailable(context);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.text("Unauthorized", 401);
        if (actor.role !== "owner") return context.text("Forbidden", 403);
        if (!validOrigin(context.req.raw)) return context.text("Invalid origin", 403);
        const form = await context.req.formData();
        if (!validCsrf(form, actor)) return context.text("Invalid CSRF token", 403);
        const routineId = context.req.param("routineId");
        const botId = form.get("bot_id");
        const expectedRevisionValue = form.get("expected_revision");
        const name = safeText(form.get("routine_name"), MAX_NAME_BYTES);
        const prompt = safeText(form.get("prompt"), MAX_PROMPT_BYTES, true);
        const schedule = safeText(form.get("schedule"), MAX_SCHEDULE_BYTES);
        const expectedRevision = typeof expectedRevisionValue === "string" ? Number(expectedRevisionValue) : NaN;
        if (
            !safeId(routineId) ||
            typeof botId !== "string" ||
            !safeId(botId) ||
            !Number.isSafeInteger(expectedRevision) ||
            expectedRevision < 1 ||
            name === null ||
            prompt === null ||
            schedule === null
        ) {
            return context.text("Invalid routine", 422);
        }
        const [bot, routine, integrations] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, botId),
            dependencies.repository.getRoutine(actor.account_id, botId, routineId),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
        ]);
        if (bot === null || routine === null) return context.text("Routine unavailable", 409);
        const bindings = selectedIntegrationBindings(bot, integrations);
        if (bindings === null) return context.text("Bot integrations unavailable", 409);
        const currentSessionIntent = compileMetorialSessionIntent(dependencies, bindings);
        if (currentSessionIntent === null) return context.text("Metorial configuration unavailable", 409);
        const updated = await dependencies.repository.updateRoutine({
            account_id: actor.account_id,
            bot_id: bot.bot_id,
            routine_id: routine.routine_id,
            expected_revision: expectedRevision,
            name,
            prompt,
            schedule,
            metorial_session_intent: currentSessionIntent,
            metorial_authority_snapshot: freezeBotAuthoritySnapshot(bot.integrations),
            permissions_snapshot: freezePermissionSnapshot(bindings.flatMap(binding => binding.permissions)),
            updated_at_ms: (dependencies.now ?? Date.now)(),
        });
        if (updated === null) return context.text("Routine conflict", 409);
        return context.redirect(`/bots/${encodeURIComponent(bot.bot_id)}`, 303);
    });

    app.post("/actions/runs", async context => {
        if (dependencies === undefined) return unavailable(context);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.text("Unauthorized", 401);
        if (actor.role !== "owner") return context.text("Forbidden", 403);
        if (!validOrigin(context.req.raw)) return context.text("Invalid origin", 403);
        const form = await context.req.formData();
        if (!validCsrf(form, actor)) return context.text("Invalid CSRF token", 403);
        const confirmationId = form.get("confirmation_id");
        if (typeof confirmationId !== "string" || !safeId(confirmationId)) return context.text("Invalid run", 422);
        const now = (dependencies.now ?? Date.now)();
        const confirmation = await dependencies.repository.getConfirmation(actor.account_id, confirmationId);
        if (confirmation === null || confirmation.state !== "pending" || confirmation.expires_at_ms <= now) {
            return context.text("Confirmation unavailable", 409);
        }
        const [bot, integrations] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, confirmation.bot_id),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
        ]);
        if (bot === null) return context.text("Bot unavailable", 409);
        const bindings = selectedIntegrationBindings(bot, integrations);
        if (bindings === null) return context.text("Bot integrations unavailable", 409);
        const metorialSessionIntent = compileMetorialSessionIntent(dependencies, bindings);
        if (metorialSessionIntent === null) return context.text("Metorial configuration unavailable", 409);
        const permissions = bindings.flatMap(binding => binding.permissions);
        if (!authorityMatchesConfirmation(confirmation, bot, permissions, metorialSessionIntent)) {
            return context.text("Metorial access changed after review", 409);
        }
        const run = await dependencies.repository.claimConfirmation({
            account_id: actor.account_id,
            confirmation_id: confirmation.confirmation_id,
            claimed_at_ms: now,
        });
        if (run === null) return context.text("Run conflict", 409);
        const execution = await dependencies.taskExecutor.execute({
            account_id: actor.account_id,
            user_id: actor.user_id,
            run_id: run.run_id,
            bot,
            prompt: confirmation.prompt,
            permissions,
            metorial_session_intent: metorialSessionIntent,
        });
        const resultText = safeText(execution.result_text, 128 * 1024, true);
        if (resultText === null) return context.text("Task result unavailable", 502);
        const completedRun = await dependencies.repository.completeRun({
            account_id: actor.account_id,
            run_id: run.run_id,
            result_text: resultText,
            completed_at_ms: (dependencies.now ?? Date.now)(),
        });
        if (completedRun === null) return context.text("Run conflict", 409);
        return context.redirect(
            `/bots/${encodeURIComponent(completedRun.bot_id)}/runs/${encodeURIComponent(completedRun.run_id)}`,
            303
        );
    });

    app.get("/bots/:botId/runs/:runId", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const botId = context.req.param("botId");
        const runId = context.req.param("runId");
        if (!safeId(botId) || !safeId(runId)) return context.notFound();
        const [bot, run, bots, integrations, routines] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, botId),
            dependencies.repository.getRun(actor.account_id, botId, runId),
            dependencies.repository.listBots(actor.account_id),
            dependencies.listMetorialIntegrations(actor.account_id, actor.user_id),
            dependencies.repository.listRoutines(actor.account_id, botId),
        ]);
        if (bot === null || run === null) return context.notFound();
        const bindings = selectedIntegrationBindings(bot, integrations);
        if (bindings === null) return context.text("Bot integrations unavailable", 409);
        const currentSessionIntent = compileMetorialSessionIntent(dependencies, bindings);
        if (currentSessionIntent === null) return context.text("Metorial configuration unavailable", 409);
        const currentPermissions = bindings.flatMap(binding => binding.permissions);
        const completed = run.execution_state === "completed" && run.result_text !== null;
        return context.html(
            document({
                title: "Task result",
                actor,
                bots,
                selectedBotId: bot.bot_id,
                view: {
                    kind: "run_result",
                    bot: clientBotDetail(
                        bot,
                        bindings,
                        clientRoutineBindings(routines, bot, currentPermissions, currentSessionIntent)
                    ),
                    prompt: run.prompt,
                    result_text: run.result_text,
                    completed,
                },
            })
        );
    });
};
