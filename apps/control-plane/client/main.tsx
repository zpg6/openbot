import { StrictMode, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type {
    OpenBotClientBotDetailV1,
    OpenBotClientBotV1,
    OpenBotClientCatalogAppV1,
    OpenBotClientIntegrationV1,
    OpenBotClientPageV1,
    OpenBotClientPermissionV1,
} from "../src/product-client-page.js";

const readPage = (): OpenBotClientPageV1 => {
    const element = document.querySelector<HTMLScriptElement>("#openbot-page");
    if (element === null || element.textContent === null) throw new Error("OpenBot page state is unavailable");
    const parsed = JSON.parse(element.textContent) as Partial<OpenBotClientPageV1>;
    if (parsed.page_version !== "openbot_react_page_v1" || !Array.isArray(parsed.bots) || parsed.view == null) {
        throw new Error("OpenBot page state is invalid");
    }
    return parsed as OpenBotClientPageV1;
};

const BotAvatar = ({
    bot,
    size = "small",
}: {
    readonly bot: OpenBotClientBotV1;
    readonly size?: "small" | "large";
}) => (
    <span className={`bot-avatar ${bot.avatar_shape_id} ${size}`} aria-hidden="true">
        <img src={bot.avatar_data_uri} alt="" />
    </span>
);

const IntegrationIcon = ({
    integration,
}: {
    readonly integration: {
        readonly display_name: string;
        readonly icon_data_uri?: string | null;
        readonly icon_url?: string | null;
    };
}) =>
    (integration.icon_data_uri ?? integration.icon_url ?? null) === null ? (
        <span className="integration-mark fallback" aria-hidden="true">
            {integration.display_name.slice(0, 1).toUpperCase()}
        </span>
    ) : (
        <span className="integration-mark" aria-hidden="true">
            <img
                src={integration.icon_data_uri ?? integration.icon_url ?? undefined}
                alt=""
                referrerPolicy="no-referrer"
            />
        </span>
    );

const ErrorSummary = ({ children }: { readonly children: ReactNode }) => (
    <div className="error-summary" role="alert">
        <h2>Check the form</h2>
        <p>{children}</p>
    </div>
);

const PermissionChoice = ({
    permission,
    checked,
    onChange,
}: {
    readonly permission: OpenBotClientPermissionV1;
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
}) => (
    <label className="choice">
        <input
            type="checkbox"
            checked={checked}
            onChange={event => onChange(event.currentTarget.checked)}
            disabled={!permission.enabled}
        />
        <span>
            <span className="choice-title">
                <span>{permission.display_name}</span>
                <span className={`effect-badge ${permission.effect}`}>{permission.effect}</span>
            </span>
            <span className="permission-meta">
                <span>{permission.consequence_summary}</span>
                <span>{permission.resource_scope_summary}</span>
                <span className="technical">Metorial tool: {permission.tool_key}</span>
            </span>
        </span>
    </label>
);

const defaultPermissionIds = (integration: OpenBotClientIntegrationV1): readonly string[] =>
    integration.permissions
        .filter(permission => permission.enabled && permission.effect === "read")
        .map(permission => permission.policy_id);

const IntegrationChoices = ({
    integrations,
    catalogApps,
}: {
    readonly integrations: readonly OpenBotClientIntegrationV1[];
    readonly catalogApps: readonly OpenBotClientCatalogAppV1[];
}) => {
    const [query, setQuery] = useState("");
    const [visibleCount, setVisibleCount] = useState(48);
    const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<readonly string[]>([]);
    const [selectedPermissionIds, setSelectedPermissionIds] = useState<Readonly<Record<string, readonly string[]>>>({});
    const [activeIntegrationId, setActiveIntegrationId] = useState<string | null>(null);

    const filteredCatalogApps = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase();
        if (normalized.length === 0) return catalogApps;
        return catalogApps.filter(app =>
            `${app.display_name} ${app.description} ${app.categories.join(" ")}`
                .toLocaleLowerCase()
                .includes(normalized)
        );
    }, [catalogApps, query]);

    const integrationById = new Map(integrations.map(integration => [integration.integration_id, integration]));
    const integrationByIdentifier = new Map(
        integrations.map(integration => [integration.provider_identifier, integration])
    );
    const selectedIntegrations = selectedIntegrationIds.flatMap(integrationId => {
        const integration = integrationById.get(integrationId);
        return integration === undefined ? [] : [integration];
    });
    const activeIntegration = activeIntegrationId === null ? null : (integrationById.get(activeIntegrationId) ?? null);

    const addOrOpenIntegration = (integration: OpenBotClientIntegrationV1): void => {
        if (integration.connection_state !== "connected") return;
        if (!selectedIntegrationIds.includes(integration.integration_id)) {
            setSelectedIntegrationIds(current => [...current, integration.integration_id]);
            setSelectedPermissionIds(current => ({
                ...current,
                [integration.integration_id]: defaultPermissionIds(integration),
            }));
        }
        setActiveIntegrationId(integration.integration_id);
    };

    const removeIntegration = (integrationId: string): void => {
        setSelectedIntegrationIds(current => current.filter(candidate => candidate !== integrationId));
        setSelectedPermissionIds(current => {
            const next = { ...current };
            delete next[integrationId];
            return next;
        });
        if (activeIntegrationId === integrationId) {
            setActiveIntegrationId(selectedIntegrationIds.find(candidate => candidate !== integrationId) ?? null);
        }
    };

    const setPermission = (integrationId: string, permissionId: string, checked: boolean): void => {
        setSelectedPermissionIds(current => {
            const selected = current[integrationId] ?? [];
            return {
                ...current,
                [integrationId]: checked
                    ? [...selected.filter(candidate => candidate !== permissionId), permissionId]
                    : selected.filter(candidate => candidate !== permissionId),
            };
        });
    };

    return (
        <div className="app-picker">
            {selectedIntegrations.map(integration => (
                <span key={integration.integration_id}>
                    <input type="hidden" name="integration" value={integration.integration_id} />
                    {(selectedPermissionIds[integration.integration_id] ?? []).map(permissionId => (
                        <input
                            type="hidden"
                            name={`permission.${integration.integration_id}`}
                            value={permissionId}
                            key={permissionId}
                        />
                    ))}
                </span>
            ))}

            <section className="app-catalog" aria-labelledby="available-apps-heading">
                <div className="app-section-head">
                    <div>
                        <h2 id="available-apps-heading">Available apps</h2>
                        <p>
                            {catalogApps.length.toLocaleString()} Metorial apps · connected apps add their approved read
                            tools.
                        </p>
                    </div>
                    <label className="app-search">
                        <span className="visually-hidden">Find an app</span>
                        <input
                            type="search"
                            value={query}
                            onChange={event => {
                                setQuery(event.currentTarget.value);
                                setVisibleCount(48);
                            }}
                            placeholder="Find an app"
                        />
                    </label>
                </div>
                <div className="app-grid">
                    {filteredCatalogApps.slice(0, visibleCount).map(app => {
                        const integration = integrationByIdentifier.get(app.identifier) ?? null;
                        const available = integration?.connection_state === "connected";
                        const selected =
                            integration !== null && selectedIntegrationIds.includes(integration.integration_id);
                        return (
                            <button
                                className={`app-tile${selected ? " selected" : ""}${available ? "" : " needs-connection"}`}
                                type="button"
                                onClick={() => {
                                    if (integration !== null && available) addOrOpenIntegration(integration);
                                    else
                                        window.location.assign(
                                            `/organization/settings?connect=${encodeURIComponent(app.identifier)}`
                                        );
                                }}
                                aria-label={`${selected ? "Open" : available ? "Add" : "Connect"} ${app.display_name}`}
                                aria-pressed={selected}
                                key={app.identifier}
                            >
                                <IntegrationIcon
                                    integration={
                                        integration ?? {
                                            display_name: app.display_name,
                                            icon_data_uri: null,
                                            icon_url: app.icon_url,
                                        }
                                    }
                                />
                                <span className="app-tile-copy">
                                    <strong>{app.display_name}</strong>
                                    <small>{app.description}</small>
                                </span>
                                <span className={`app-tile-action${selected ? " added" : ""}`} aria-hidden="true">
                                    {selected ? "Added" : available ? "Add" : "Connect"}
                                </span>
                            </button>
                        );
                    })}
                </div>
                {filteredCatalogApps.length === 0 ? <p className="app-empty">No apps match "{query.trim()}".</p> : null}
                {filteredCatalogApps.length > visibleCount ? (
                    <div className="app-catalog-more">
                        <span>
                            Showing {visibleCount.toLocaleString()} of {filteredCatalogApps.length.toLocaleString()}
                        </span>
                        <button
                            className="button tertiary"
                            type="button"
                            onClick={() => setVisibleCount(current => current + 48)}
                        >
                            Show more
                        </button>
                    </div>
                ) : null}
            </section>

            <section className="selected-apps" aria-labelledby="selected-apps-heading">
                <div className="app-section-head">
                    <div>
                        <h2 id="selected-apps-heading">Added to this Bot</h2>
                        <p>
                            {selectedIntegrations.length === 0
                                ? "No apps added yet."
                                : "Click an app to edit its tools."}
                        </p>
                    </div>
                    <span className="app-count">{selectedIntegrations.length}</span>
                </div>
                {selectedIntegrations.length === 0 ? (
                    <div className="selected-apps-empty">
                        <span className="empty-app-mark" aria-hidden="true">
                            +
                        </span>
                        <span>Choose an app above. It will show up here.</span>
                    </div>
                ) : (
                    <div className="selected-app-list">
                        {selectedIntegrations.map(integration => {
                            const permissionCount = (selectedPermissionIds[integration.integration_id] ?? []).length;
                            const active = integration.integration_id === activeIntegrationId;
                            return (
                                <div
                                    className={`selected-app-row${active ? " active" : ""}`}
                                    key={integration.integration_id}
                                >
                                    <button
                                        className="selected-app-open"
                                        type="button"
                                        onClick={() => setActiveIntegrationId(integration.integration_id)}
                                        aria-label={`Configure ${integration.display_name}`}
                                    >
                                        <IntegrationIcon integration={integration} />
                                        <span>
                                            <strong>{integration.display_name}</strong>
                                            <small>{integration.connected_account_label}</small>
                                        </span>
                                        <span className="selected-app-permissions">
                                            {permissionCount} {permissionCount === 1 ? "tool" : "tools"}
                                        </span>
                                    </button>
                                    <button
                                        className="remove-app"
                                        type="button"
                                        onClick={() => removeIntegration(integration.integration_id)}
                                        aria-label={`Remove ${integration.display_name}`}
                                    >
                                        Remove
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {activeIntegration === null ? null : (
                <section className="app-detail" aria-labelledby="app-detail-heading">
                    <div className="app-detail-head">
                        <IntegrationIcon integration={activeIntegration} />
                        <div>
                            <p className="eyebrow">App access</p>
                            <h2 id="app-detail-heading">{activeIntegration.display_name}</h2>
                            <p>{activeIntegration.connected_account_label}</p>
                        </div>
                        <span className="status-badge good">Connected</span>
                    </div>
                    <div className="app-detail-copy">
                        <p>Choose the exact Metorial tools this Bot can use.</p>
                        <p className="technical">Organization policy stays in force even if this Bot asks for more.</p>
                    </div>
                    <div className="permission-stack app-permissions">
                        {activeIntegration.permissions.map(permission => (
                            <PermissionChoice
                                permission={permission}
                                checked={(selectedPermissionIds[activeIntegration.integration_id] ?? []).includes(
                                    permission.policy_id
                                )}
                                onChange={checked =>
                                    setPermission(activeIntegration.integration_id, permission.policy_id, checked)
                                }
                                key={permission.policy_id}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
};

const AppearanceChoices = ({
    name,
    options,
    className,
    kind,
}: {
    readonly name: string;
    readonly options: readonly { readonly id: string; readonly display_name: string; readonly preview?: string }[];
    readonly className: string;
    readonly kind: "color" | "shape" | "face";
}) => (
    <div className={className}>
        {options.map((option, index) => (
            <label className={`${kind}-choice`} key={option.id}>
                <input
                    type="radio"
                    name={name}
                    value={option.id}
                    defaultChecked={kind === "shape" ? index === 1 : index === 0}
                />
                {kind === "color" ? (
                    <span className="swatch" style={{ background: option.preview }} aria-hidden="true" />
                ) : null}
                {kind === "shape" ? <span className={`shape-sample ${option.id}`} aria-hidden="true" /> : null}
                {kind === "face" ? (
                    <span className="face-preview squircle" aria-hidden="true">
                        <img src={option.preview} alt="" />
                    </span>
                ) : null}
                <span>{option.display_name}</span>
            </label>
        ))}
    </div>
);

const BotsView = ({ hasBots }: { readonly hasBots: boolean }) => (
    <>
        <div className="page-head">
            <div>
                <p className="eyebrow">Workspace</p>
                <h1>Bots</h1>
                <p className="muted">Focused assistants with explicit access.</p>
            </div>
            <a className="button" href="/bots/new">
                New Bot
            </a>
        </div>
        {hasBots ? (
            <div className="card">
                <h2>Your Bots</h2>
                <p className="muted">Choose a Bot from the sidebar to start a task.</p>
            </div>
        ) : (
            <div className="card empty-state">
                <div className="empty-mark" aria-hidden="true">
                    +
                </div>
                <h2>No Bots yet</h2>
                <p className="muted">Create one, choose its read access, then give it a task.</p>
            </div>
        )}
    </>
);

type OrganizationSettingsPage = OpenBotClientPageV1 & {
    readonly view: Extract<OpenBotClientPageV1["view"], { kind: "organization_settings" }>;
};
const OrganizationSettingsView = ({ page }: { readonly page: OrganizationSettingsPage }) => (
    <>
        <div className="page-head">
            <div>
                <p className="eyebrow">Organization</p>
                <h1>{page.view.organization_name}</h1>
                <p className="muted">
                    Connections and the maximum Metorial tools any Bot in this organization may use.
                </p>
            </div>
        </div>
        <section className="card" aria-labelledby="organization-integrations-heading">
            <h2 id="organization-integrations-heading">Integrations and permissions</h2>
            <p className="muted">
                A Bot can select only a subset of these exact tools. Disabling a tool immediately makes dependent
                confirmations stale.
            </p>
            <div className="integration-options">
                {page.view.integrations.map(integration => (
                    <section className="integration-card" key={integration.integration_id}>
                        <div className="integration-choice">
                            <span aria-hidden="true" />
                            <IntegrationIcon integration={integration} />
                            <span>
                                <strong>{integration.display_name}</strong>
                                <small>{integration.description}</small>
                                <span className="technical">{integration.connected_account_label}</span>
                            </span>
                            <span
                                className={`status-badge${integration.connection_state === "connected" ? " good" : ""}`}
                            >
                                {integration.connection_state === "connected" ? "Connected" : "Needs connection"}
                            </span>
                        </div>
                        <div className="permission-stack organization-permissions">
                            {integration.permissions.map(permission => (
                                <div className="choice organization-permission" key={permission.policy_id}>
                                    <span>
                                        <span className="choice-title">
                                            <strong>{permission.display_name}</strong>
                                            <span className={`effect-badge ${permission.effect}`}>
                                                {permission.effect}
                                            </span>
                                        </span>
                                        <span className="permission-meta">
                                            <span>{permission.consequence_summary}</span>
                                            <span>{permission.resource_scope_summary}</span>
                                            <span className="technical">Metorial tool: {permission.tool_key}</span>
                                        </span>
                                    </span>
                                    {page.view.can_manage ? (
                                        <form method="post" action="/actions/organization-permissions">
                                            <input type="hidden" name="_csrf" value={page.view.csrf_token} />
                                            <input
                                                type="hidden"
                                                name="integration_id"
                                                value={integration.integration_id}
                                            />
                                            <input type="hidden" name="policy_id" value={permission.policy_id} />
                                            <input
                                                type="hidden"
                                                name="enabled"
                                                value={permission.enabled ? "false" : "true"}
                                            />
                                            <button className="button tertiary" type="submit">
                                                {permission.enabled ? "Disable" : "Enable"} {permission.display_name}
                                            </button>
                                        </form>
                                    ) : (
                                        <span className={`status-badge${permission.enabled ? " good" : ""}`}>
                                            {permission.enabled ? "Allowed" : "Blocked"}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </section>
    </>
);

type NewBotPage = OpenBotClientPageV1 & { readonly view: Extract<OpenBotClientPageV1["view"], { kind: "new_bot" }> };
const NewBotView = ({ page }: { readonly page: NewBotPage }) => (
    <>
        <div className="page-head">
            <div>
                <p className="eyebrow">Bot setup</p>
                <h1>New Bot</h1>
                <p className="muted">Give it one clear job and only the access it needs.</p>
            </div>
        </div>
        {page.view.error === null ? null : <ErrorSummary>{page.view.error}</ErrorSummary>}
        <form method="post" action="/actions/bots">
            <input type="hidden" name="_csrf" value={page.view.csrf_token} />
            <fieldset>
                <legend>Identity</legend>
                <label htmlFor="name">
                    Name
                    <input id="name" name="name" type="text" required maxLength={128} autoComplete="off" />
                </label>
                <label htmlFor="short-description">
                    Short description
                    <input
                        id="short-description"
                        name="short_description"
                        type="text"
                        required
                        maxLength={512}
                        autoComplete="off"
                    />
                </label>
            </fieldset>
            <fieldset>
                <legend>Appearance</legend>
                <div className="appearance-group">
                    <p className="appearance-label">Color</p>
                    <AppearanceChoices
                        name="palette_color_id"
                        options={page.view.colors}
                        className="color-options"
                        kind="color"
                    />
                </div>
                <div className="appearance-group">
                    <p className="appearance-label">Shape</p>
                    <AppearanceChoices
                        name="avatar_shape_id"
                        options={page.view.shapes}
                        className="shape-options"
                        kind="shape"
                    />
                </div>
                <div className="appearance-group">
                    <p className="appearance-label">Face</p>
                    <AppearanceChoices
                        name="avatar_face_id"
                        options={page.view.faces}
                        className="face-options"
                        kind="face"
                    />
                </div>
                <p className="muted">
                    Moods artwork is generated locally. Motion stops when reduced motion is enabled.
                </p>
            </fieldset>
            <fieldset>
                <legend>Behavior</legend>
                <label htmlFor="purpose">
                    Purpose
                    <textarea id="purpose" name="purpose" required />
                </label>
                <label htmlFor="instructions">
                    Behavior instructions
                    <textarea id="instructions" name="standing_instructions" required />
                </label>
            </fieldset>
            <fieldset>
                <legend>Metorial access</legend>
                <p className="muted">
                    Choose organization integrations, then pass through the exact tools this Bot may request. The server
                    verifies every selection against the current organization ceiling.
                </p>
                <IntegrationChoices integrations={page.view.integrations} catalogApps={page.view.catalog_apps} />
            </fieldset>
            <div className="actions">
                <a className="text-link" href="/bots">
                    Cancel
                </a>
                <button type="submit">Create Bot</button>
            </div>
        </form>
    </>
);

const ChatHeader = ({ bot }: { readonly bot: OpenBotClientBotDetailV1 }) => (
    <div className="chat-header">
        <BotAvatar bot={bot} />
        <div>
            <h1>{bot.name}</h1>
            <p className="muted">{bot.short_description}</p>
        </div>
    </div>
);

type BotChatPage = OpenBotClientPageV1 & { readonly view: Extract<OpenBotClientPageV1["view"], { kind: "bot_chat" }> };
const BotChatView = ({ page }: { readonly page: BotChatPage }) => {
    const { bot } = page.view;
    return (
        <div className="chat-page">
            <ChatHeader bot={bot} />
            <div className="chat-empty">
                <BotAvatar bot={bot} size="large" />
                <h2>What should we work on?</h2>
                <p className="muted">Chat with {bot.name} about one task.</p>
            </div>
            <section className="chat-composer" aria-label="Message composer">
                <form method="post" action="/actions/run-confirmations">
                    <input type="hidden" name="_csrf" value={page.view.csrf_token} />
                    <input type="hidden" name="bot_id" value={bot.bot_id} />
                    <label htmlFor="prompt">
                        Message {bot.name}
                        <textarea id="prompt" name="prompt" required placeholder="Ask for a task…" />
                    </label>
                    <details className="routine-builder">
                        <summary>Create a routine from this message</summary>
                        <div className="routine-fields">
                            <label htmlFor="routine-name">
                                Routine name
                                <input
                                    id="routine-name"
                                    name="routine_name"
                                    type="text"
                                    maxLength={128}
                                    placeholder="Weekday support brief"
                                />
                            </label>
                            <label htmlFor="routine-schedule">
                                Schedule
                                <input
                                    id="routine-schedule"
                                    name="schedule"
                                    type="text"
                                    maxLength={256}
                                    placeholder="Every weekday at 9:00 AM Pacific"
                                />
                            </label>
                            <button type="submit" formAction="/actions/routine-proposals">
                                Review routine
                            </button>
                        </div>
                    </details>
                    <div className="actions">
                        <span className="composer-note">You will review access before anything runs.</span>
                        <button type="submit">Review task</button>
                    </div>
                </form>
            </section>
        </div>
    );
};

type ConfirmationPage = OpenBotClientPageV1 & {
    readonly view: Extract<OpenBotClientPageV1["view"], { kind: "confirmation" }>;
};
const ConfirmationView = ({ page }: { readonly page: ConfirmationPage }) => {
    const view = page.view;
    return (
        <div className="chat-page">
            <ChatHeader bot={view.bot} />
            <div className="chat-transcript">
                <div className="conversation review-conversation">
                    <section className="message user">
                        <div className="message-copy">
                            <p>{view.prompt}</p>
                        </div>
                    </section>
                    <section className="message">
                        <BotAvatar bot={view.bot} />
                        <div className="message-copy">
                            <div className="card review-card">
                                <p className="eyebrow">Confirmation</p>
                                <h2 className="review-title">Review task</h2>
                                <p className="muted">Check what this run can send before it starts.</p>
                                <h2>Metorial session</h2>
                                <dl className="disclosure-list">
                                    {view.providers.map(provider => (
                                        <div
                                            className="disclosure-group"
                                            key={`${provider.display_name}:${provider.connected_account_label}`}
                                        >
                                            <dt>Provider</dt>
                                            <dd>{provider.display_name}</dd>
                                            <dt>Connected account</dt>
                                            <dd>{provider.connected_account_label}</dd>
                                            <dt>Exact allowed tools</dt>
                                            <dd className="technical">{provider.allowed_tool_keys.join(", ")}</dd>
                                        </div>
                                    ))}
                                </dl>
                                <h2>This run may disclose</h2>
                                <dl className="disclosure-list">
                                    {view.permissions.map(permission => (
                                        <div className="disclosure-group" key={permission.policy_id}>
                                            <dt>Tool</dt>
                                            <dd>{permission.display_name}</dd>
                                            <dt>Data</dt>
                                            <dd>{permission.consequence_summary}</dd>
                                            <dt>Metorial tool</dt>
                                            <dd className="technical">{permission.tool_key}</dd>
                                        </div>
                                    ))}
                                </dl>
                                <p className="notice">
                                    Model-selected arguments and returned records do not exist yet, so this screen
                                    cannot preview them.
                                </p>
                                {view.available ? (
                                    <form method="post" action="/actions/runs">
                                        <input type="hidden" name="_csrf" value={view.csrf_token} />
                                        <input type="hidden" name="confirmation_id" value={view.confirmation_id} />
                                        <div className="actions">
                                            <a
                                                href={`/bots/${encodeURIComponent(view.bot.bot_id)}`}
                                                className="text-link"
                                            >
                                                Back
                                            </a>
                                            <button type="submit">Start run</button>
                                        </div>
                                    </form>
                                ) : (
                                    <div className="error-summary" role="alert">
                                        <h2>Confirmation unavailable</h2>
                                        <p>{view.unavailable_reason}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

type RunResultPage = OpenBotClientPageV1 & {
    readonly view: Extract<OpenBotClientPageV1["view"], { kind: "run_result" }>;
};
const RunResultView = ({ page }: { readonly page: RunResultPage }) => {
    const view = page.view;
    return (
        <>
            <ChatHeader bot={view.bot} />
            <div className="chat-transcript result-transcript">
                <div className="page-head">
                    <div>
                        <p className="eyebrow">Run complete</p>
                        <h2>Task result</h2>
                    </div>
                    <a className="button tertiary" href={`/bots/${encodeURIComponent(view.bot.bot_id)}`}>
                        New task
                    </a>
                </div>
                <div className="conversation">
                    <section className="message user">
                        <div className="message-copy">
                            <p>{view.prompt}</p>
                        </div>
                    </section>
                    <section className="message">
                        <BotAvatar bot={view.bot} />
                        <div className="message-copy">
                            <h2>Result</h2>
                            {view.completed ? (
                                <pre className="result">{view.result_text}</pre>
                            ) : (
                                <p>The task is still running.</p>
                            )}
                        </div>
                    </section>
                </div>
                <section className="status-strip" aria-label="Run status">
                    <span className="status-item">
                        Execution{" "}
                        <span className={`status-badge${view.completed ? " good" : ""}`}>
                            {view.completed ? "Completed" : "Running"}
                        </span>
                    </span>
                    <span className="status-item">
                        Cleanup <span className="status-badge">Not required</span>
                    </span>
                    <span className="status-item">
                        Evidence <span className="status-badge">Synthetic test only</span>
                    </span>
                </section>
            </div>
        </>
    );
};

type RoutineProposalPage = OpenBotClientPageV1 & {
    readonly view: Extract<OpenBotClientPageV1["view"], { kind: "routine_proposal" }>;
};
const RoutineProposalView = ({ page }: { readonly page: RoutineProposalPage }) => {
    const view = page.view;
    return (
        <div className="chat-page">
            <ChatHeader bot={view.bot} />
            <div className="chat-transcript">
                <div className="conversation review-conversation">
                    <section className="message user">
                        <div className="message-copy">
                            <p>{view.prompt}</p>
                        </div>
                    </section>
                    <section className="message">
                        <BotAvatar bot={view.bot} />
                        <div className="message-copy">
                            <div className="card review-card">
                                <p className="eyebrow">Routine draft</p>
                                <h2 className="review-title">{view.name}</h2>
                                <p className="muted">Review the schedule and exact access before saving.</p>
                                <dl className="disclosure-list">
                                    <div className="disclosure-group">
                                        <dt>Schedule</dt>
                                        <dd>{view.schedule}</dd>
                                        <dt>Prompt</dt>
                                        <dd>{view.prompt}</dd>
                                    </div>
                                </dl>
                                <h2>Exact Metorial tools</h2>
                                <ul className="context-tools">
                                    {view.permissions.map(permission => (
                                        <li key={permission.policy_id}>
                                            <strong>{permission.display_name}</strong>
                                            <span className="technical">{permission.tool_key}</span>
                                            <span className="muted">
                                                {permission.effect} · {permission.resource_scope_summary}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                {view.available ? (
                                    <form method="post" action="/actions/routines">
                                        <input type="hidden" name="_csrf" value={view.csrf_token} />
                                        <input type="hidden" name="proposal_id" value={view.proposal_id} />
                                        <div className="actions">
                                            <a
                                                className="text-link"
                                                href={`/bots/${encodeURIComponent(view.bot.bot_id)}`}
                                            >
                                                Back
                                            </a>
                                            <button type="submit">Save routine</button>
                                        </div>
                                    </form>
                                ) : (
                                    <div className="error-summary" role="alert">
                                        <h2>Routine draft unavailable</h2>
                                        <p>{view.unavailable_reason}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

type RoutineEditPage = OpenBotClientPageV1 & {
    readonly view: Extract<OpenBotClientPageV1["view"], { kind: "routine_edit" }>;
};
const RoutineEditView = ({ page }: { readonly page: RoutineEditPage }) => {
    const view = page.view;
    return (
        <div className="chat-page">
            <ChatHeader bot={view.bot} />
            <div className="page-head routine-edit-head">
                <div>
                    <p className="eyebrow">Routine</p>
                    <h2>Edit {view.name}</h2>
                    <p className="muted">Saving binds the routine to the Bot’s current exact permission set.</p>
                </div>
            </div>
            {view.blocked ? (
                <div className="error-summary" role="alert">
                    <h2>Permission review required</h2>
                    <p>
                        This routine is blocked because its saved access no longer matches the organization ceiling or
                        Bot revision.
                    </p>
                </div>
            ) : null}
            <form className="card" method="post" action={`/actions/routines/${encodeURIComponent(view.routine_id)}`}>
                <input type="hidden" name="_csrf" value={view.csrf_token} />
                <input type="hidden" name="bot_id" value={view.bot.bot_id} />
                <input type="hidden" name="expected_revision" value={view.revision} />
                <label htmlFor="edit-routine-name">
                    Name
                    <input
                        id="edit-routine-name"
                        name="routine_name"
                        type="text"
                        required
                        maxLength={128}
                        defaultValue={view.name}
                    />
                </label>
                <label htmlFor="edit-routine-schedule">
                    Schedule
                    <input
                        id="edit-routine-schedule"
                        name="schedule"
                        type="text"
                        required
                        maxLength={256}
                        defaultValue={view.schedule}
                    />
                </label>
                <label htmlFor="edit-routine-prompt">
                    Message
                    <textarea id="edit-routine-prompt" name="prompt" required defaultValue={view.prompt} />
                </label>
                <div className="actions">
                    <a className="text-link" href={`/bots/${encodeURIComponent(view.bot.bot_id)}`}>
                        Cancel
                    </a>
                    <button type="submit">Save changes</button>
                </div>
            </form>
        </div>
    );
};

const MainView = ({ page }: { readonly page: OpenBotClientPageV1 }) => {
    switch (page.view.kind) {
        case "bots":
            return <BotsView hasBots={page.view.has_bots} />;
        case "organization_settings":
            return <OrganizationSettingsView page={page as OrganizationSettingsPage} />;
        case "new_bot":
            return <NewBotView page={page as NewBotPage} />;
        case "bot_chat":
            return <BotChatView page={page as BotChatPage} />;
        case "confirmation":
            return <ConfirmationView page={page as ConfirmationPage} />;
        case "routine_proposal":
            return <RoutineProposalView page={page as RoutineProposalPage} />;
        case "routine_edit":
            return <RoutineEditView page={page as RoutineEditPage} />;
        case "run_result":
            return <RunResultView page={page as RunResultPage} />;
    }
};

const ContextPanel = ({ bot }: { readonly bot: OpenBotClientBotDetailV1 }) => (
    <aside className="context-panel" aria-label="Bot settings and routines">
        <div className="context-head">
            <BotAvatar bot={bot} />
            <div>
                <h2>{bot.name}</h2>
                <span className="muted">Bot settings</span>
            </div>
        </div>
        <section className="context-section" aria-labelledby="bot-settings-heading">
            <h3 id="bot-settings-heading">Settings</h3>
            <dl className="context-list">
                <div>
                    <dt>Purpose</dt>
                    <dd>{bot.purpose}</dd>
                </div>
                <div>
                    <dt>Appearance</dt>
                    <dd>{bot.appearance_summary}</dd>
                </div>
                <div>
                    <dt>Instructions</dt>
                    <dd>{bot.standing_instructions}</dd>
                </div>
            </dl>
        </section>
        <section className="context-section" aria-labelledby="permissions-heading" aria-label="Metorial access">
            <h3 id="permissions-heading">Metorial access</h3>
            <div aria-label="Selected permissions">
                {bot.access.map(binding => (
                    <section className="context-integration" key={binding.integration.integration_id}>
                        <div className="context-integration-head">
                            <IntegrationIcon integration={binding.integration} />
                            <span>
                                <strong>{binding.integration.display_name}</strong>
                                <span className="technical">{binding.integration.connected_account_label}</span>
                            </span>
                        </div>
                        <ul className="context-tools">
                            {binding.permissions.map(permission => (
                                <li key={permission.policy_id}>
                                    <strong>{permission.display_name}</strong>
                                    <span className="technical">{permission.tool_key}</span>
                                    <span className="muted">
                                        {permission.effect} · {permission.resource_scope_summary}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </section>
        <section className="context-section" aria-labelledby="routines-heading" aria-label="Routines">
            <h3 id="routines-heading">Routines</h3>
            {bot.routines.length === 0 ? (
                <div className="routine-empty">
                    <strong>No routines yet</strong>
                    <br />
                    Create and edit routines from this Bot’s chat.
                </div>
            ) : (
                <ul className="routine-list">
                    {bot.routines.map(routine => (
                        <li key={routine.routine_id}>
                            <a
                                href={`/bots/${encodeURIComponent(bot.bot_id)}/routines/${encodeURIComponent(routine.routine_id)}`}
                            >
                                <strong>{routine.name}</strong>
                                <span>{routine.schedule}</span>
                                <span className={`status-badge${routine.blocked ? "" : " good"}`}>
                                    {routine.blocked ? "Needs review" : "Active"}
                                </span>
                            </a>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    </aside>
);

const selectedDetail = (page: OpenBotClientPageV1): OpenBotClientBotDetailV1 | null => {
    switch (page.view.kind) {
        case "bot_chat":
        case "confirmation":
        case "routine_proposal":
        case "routine_edit":
        case "run_result":
            return page.view.bot;
        default:
            return null;
    }
};

const AppShell = ({ page }: { readonly page: OpenBotClientPageV1 }) => {
    const detail = selectedDetail(page);
    return (
        <>
            <a className="skip-link" href="#main-content">
                Skip to main content
            </a>
            <div className={`shell${detail === null ? "" : " has-context"}`}>
                <aside className="sidebar" aria-label="Bot navigation">
                    <div className="sidebar-primary">
                        <a className="brand" href="/bots">
                            <span className="brand-mark" aria-hidden="true">
                                OB
                            </span>
                            <span>OpenBot</span>
                        </a>
                        <a className="new-bot" href="/bots/new">
                            <span className="plus" aria-hidden="true">
                                +
                            </span>
                            <span>New Bot</span>
                        </a>
                        <p className="section-label">Bots</p>
                        <nav aria-label="Bots">
                            <ul className="bot-list">
                                {page.bots.map(bot => (
                                    <li key={bot.bot_id}>
                                        <a
                                            href={`/bots/${encodeURIComponent(bot.bot_id)}`}
                                            aria-current={bot.bot_id === page.selected_bot_id ? "page" : undefined}
                                        >
                                            <span className="bot-row">
                                                <BotAvatar bot={bot} />
                                                <span>
                                                    <span>{bot.name}</span>
                                                    <small>{bot.short_description}</small>
                                                </span>
                                            </span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </nav>
                    </div>
                    <div className="account">
                        <span className="account-avatar" aria-hidden="true">
                            {page.actor.role === "owner" ? "EO" : page.actor.role === "admin" ? "EA" : "EM"}
                        </span>
                        <a href="/organization/settings" className="account-organization">
                            <small>Organization {page.actor.role}</small>
                            <span className="account-name">{page.actor.organization_name}</span>
                            <small>{page.actor.display_name}</small>
                        </a>
                    </div>
                </aside>
                <main id="main-content">
                    <div className="content">
                        <MainView page={page} />
                    </div>
                </main>
                {detail === null ? null : <ContextPanel bot={detail} />}
            </div>
        </>
    );
};

const page = readPage();
document.title = `${page.title} · OpenBot`;
const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("OpenBot root is unavailable");
createRoot(root).render(
    <StrictMode>
        <AppShell page={page} />
    </StrictMode>
);
