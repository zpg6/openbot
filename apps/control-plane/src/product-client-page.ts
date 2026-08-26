export interface OpenBotClientBotV1 {
    readonly bot_id: string;
    readonly name: string;
    readonly short_description: string;
    readonly avatar_shape_id: string;
    readonly avatar_data_uri: string;
}

export interface OpenBotClientPermissionV1 {
    readonly policy_id: string;
    readonly display_name: string;
    readonly tool_key: string;
    readonly effect: "read" | "write" | "destructive";
    readonly consequence_summary: string;
    readonly resource_scope_summary: string;
    readonly enabled: boolean;
}

export interface OpenBotClientIntegrationV1 {
    readonly integration_id: string;
    readonly connected_account_label: string;
    readonly display_name: string;
    readonly description: string;
    readonly icon_data_uri: string | null;
    readonly connection_state: "connected" | "needs_connection";
    readonly permissions: readonly OpenBotClientPermissionV1[];
}

export interface OpenBotClientBotDetailV1 extends OpenBotClientBotV1 {
    readonly purpose: string;
    readonly standing_instructions: string;
    readonly appearance_summary: string;
    readonly access: readonly {
        readonly integration: Omit<OpenBotClientIntegrationV1, "permissions">;
        readonly permissions: readonly OpenBotClientPermissionV1[];
    }[];
    readonly routines: readonly {
        readonly routine_id: string;
        readonly name: string;
        readonly schedule: string;
        readonly blocked: boolean;
    }[];
}

export interface OpenBotClientAppearanceOptionV1 {
    readonly id: string;
    readonly display_name: string;
    readonly preview?: string;
}

export type OpenBotClientViewV1 =
    | { readonly kind: "bots"; readonly has_bots: boolean }
    | {
          readonly kind: "organization_settings";
          readonly csrf_token: string;
          readonly organization_name: string;
          readonly integrations: readonly OpenBotClientIntegrationV1[];
          readonly can_manage: boolean;
      }
    | {
          readonly kind: "new_bot";
          readonly csrf_token: string;
          readonly error: string | null;
          readonly integrations: readonly OpenBotClientIntegrationV1[];
          readonly colors: readonly OpenBotClientAppearanceOptionV1[];
          readonly shapes: readonly OpenBotClientAppearanceOptionV1[];
          readonly faces: readonly OpenBotClientAppearanceOptionV1[];
      }
    | {
          readonly kind: "bot_chat";
          readonly csrf_token: string;
          readonly bot: OpenBotClientBotDetailV1;
      }
    | {
          readonly kind: "confirmation";
          readonly csrf_token: string;
          readonly bot: OpenBotClientBotDetailV1;
          readonly confirmation_id: string;
          readonly prompt: string;
          readonly providers: readonly {
              readonly display_name: string;
              readonly connected_account_label: string;
              readonly allowed_tool_keys: readonly string[];
          }[];
          readonly permissions: readonly OpenBotClientPermissionV1[];
          readonly available: boolean;
          readonly unavailable_reason: string | null;
      }
    | {
          readonly kind: "routine_proposal";
          readonly csrf_token: string;
          readonly bot: OpenBotClientBotDetailV1;
          readonly proposal_id: string;
          readonly name: string;
          readonly prompt: string;
          readonly schedule: string;
          readonly permissions: readonly OpenBotClientPermissionV1[];
          readonly available: boolean;
          readonly unavailable_reason: string | null;
      }
    | {
          readonly kind: "routine_edit";
          readonly csrf_token: string;
          readonly bot: OpenBotClientBotDetailV1;
          readonly routine_id: string;
          readonly revision: number;
          readonly name: string;
          readonly prompt: string;
          readonly schedule: string;
          readonly blocked: boolean;
      }
    | {
          readonly kind: "run_result";
          readonly bot: OpenBotClientBotDetailV1;
          readonly prompt: string;
          readonly result_text: string | null;
          readonly completed: boolean;
      };

export interface OpenBotClientPageV1 {
    readonly page_version: "openbot_react_page_v1";
    readonly title: string;
    readonly actor: {
        readonly display_name: string;
        readonly role: "owner" | "admin" | "member";
        readonly organization_name: string;
    };
    readonly bots: readonly OpenBotClientBotV1[];
    readonly selected_bot_id: string | null;
    readonly view: OpenBotClientViewV1;
}
