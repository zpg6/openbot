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

const cleanAppDescription = (displayName: string, description: string): string => {
    const trimmed = description.trim();
    const prefix = `${displayName}:`;
    return trimmed.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
        ? trimmed.slice(prefix.length).trim()
        : trimmed;
};

const connectedAccountName = (displayName: string, label: string): string | null => {
    const trimmed = label.trim();
    const prefix = `${displayName} · `;
    const withoutProvider = trimmed.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
        ? trimmed.slice(prefix.length).trim()
        : trimmed;
    return withoutProvider.toLocaleLowerCase() === "openbot workspace" || withoutProvider.length === 0
        ? null
        : withoutProvider;
};

const ErrorSummary = ({ children }: { readonly children: ReactNode }) => (
    <div className="error-summary" role="alert">
        <h2>Check the form</h2>
        <p>{children}</p>
    </div>
);

const PermissionChoice = ({
    permission,
    checked,
    disabled = false,
    onChange,
}: {
    readonly permission: OpenBotClientPermissionV1;
    readonly checked: boolean;
    readonly disabled?: boolean;
    readonly onChange: (checked: boolean) => void;
}) => (
    <label className="choice">
        <input
            type="checkbox"
            checked={checked}
            onChange={event => onChange(event.currentTarget.checked)}
            disabled={!permission.enabled || disabled}
        />
        <span>
            <span className="choice-title">
                <span>{permission.display_name}</span>
                <span className={`effect-badge ${permission.effect}`}>{permission.effect}</span>
            </span>
            <span className="permission-meta">
                <span>{permission.consequence_summary}</span>
                <span>{permission.resource_scope_summary}</span>
            </span>
        </span>
    </label>
);

const defaultPermissionIds = (integration: OpenBotClientIntegrationV1): readonly string[] =>
    integration.permissions
        .filter(permission => permission.enabled && permission.effect === "read")
        .map(permission => permission.policy_id);

type PermissionLevel = "read" | "write" | "destructive";
const permissionLevelRank: Readonly<Record<PermissionLevel, number>> = Object.freeze({
    read: 0,
    write: 1,
    destructive: 2,
});
const permissionsThroughLevel = (integration: OpenBotClientIntegrationV1, level: PermissionLevel): readonly string[] =>
    integration.permissions
        .filter(
            permission => permission.enabled && permissionLevelRank[permission.effect] <= permissionLevelRank[level]
        )
        .map(permission => permission.policy_id);

const POPULAR_APP_IDENTIFIERS = Object.freeze([
    "slack",
    "gmail",
    "google-calendar",
    "google-drive",
    "outlook",
    "microsoft-teams",
    "notion",
    "linear",
    "github",
    "jira",
    "asana",
    "airtable",
    "salesforce",
    "hubspot",
    "apollo",
    "sharepoint",
    "stripe",
    "zendesk",
    "dropbox",
    "discord",
] as const);
const popularAppIdentifiers = new Set<string>(POPULAR_APP_IDENTIFIERS);

const IntegrationChoices = ({
    integrations,
    catalogApps,
    onSelectionCountChange,
}: {
    readonly integrations: readonly OpenBotClientIntegrationV1[];
    readonly catalogApps: readonly OpenBotClientCatalogAppV1[];
    readonly onSelectionCountChange: (count: number) => void;
}) => {
    const [query, setQuery] = useState("");
    const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<readonly string[]>([]);
    const [selectedPermissionIds, setSelectedPermissionIds] = useState<Readonly<Record<string, readonly string[]>>>({});
    const [permissionLevels, setPermissionLevels] = useState<Readonly<Record<string, PermissionLevel>>>({});
    const [activeIntegrationId, setActiveIntegrationId] = useState<string | null>(null);

    const catalogByIdentifier = useMemo(() => new Map(catalogApps.map(app => [app.identifier, app])), [catalogApps]);
    const popularApps = useMemo(
        () => POPULAR_APP_IDENTIFIERS.flatMap(identifier => catalogByIdentifier.get(identifier) ?? []),
        [catalogByIdentifier]
    );
    const remainingApps = useMemo(
        () => catalogApps.filter(app => !popularAppIdentifiers.has(app.identifier)),
        [catalogApps]
    );
    const searchResults = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase();
        if (normalized.length === 0) return [];
        return remainingApps.filter(app =>
            `${app.display_name} ${app.description} ${app.categories.join(" ")}`
                .toLocaleLowerCase()
                .includes(normalized)
        );
    }, [query, remainingApps]);

    const integrationById = new Map(integrations.map(integration => [integration.integration_id, integration]));
    const integrationByIdentifier = new Map(
        integrations.map(integration => [integration.provider_identifier, integration])
    );
    const selectedIntegrations = selectedIntegrationIds.flatMap(integrationId => {
        const integration = integrationById.get(integrationId);
        return integration === undefined ? [] : [integration];
    });
    const activeIntegration = activeIntegrationId === null ? null : (integrationById.get(activeIntegrationId) ?? null);

    const addIntegration = (integration: OpenBotClientIntegrationV1): void => {
        if (integration.connection_state !== "connected") return;
        if (!selectedIntegrationIds.includes(integration.integration_id)) {
            const next = [...selectedIntegrationIds, integration.integration_id];
            setSelectedIntegrationIds(next);
            onSelectionCountChange(next.length);
            setSelectedPermissionIds(current => ({
                ...current,
                [integration.integration_id]: defaultPermissionIds(integration),
            }));
            setPermissionLevels(current => ({ ...current, [integration.integration_id]: "read" }));
        }
    };

    const removeIntegration = (integrationId: string): void => {
        const next = selectedIntegrationIds.filter(candidate => candidate !== integrationId);
        setSelectedIntegrationIds(next);
        onSelectionCountChange(next.length);
        setSelectedPermissionIds(current => {
            const next = { ...current };
            delete next[integrationId];
            return next;
        });
        setPermissionLevels(current => {
            const next = { ...current };
            delete next[integrationId];
            return next;
        });
        if (activeIntegrationId === integrationId) {
            setActiveIntegrationId(null);
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

    const setPermissionLevel = (integration: OpenBotClientIntegrationV1, level: PermissionLevel): void => {
        setPermissionLevels(current => ({ ...current, [integration.integration_id]: level }));
        setSelectedPermissionIds(current => ({
            ...current,
            [integration.integration_id]: permissionsThroughLevel(integration, level),
        }));
    };

    const appTile = (app: OpenBotClientCatalogAppV1, compact: boolean): ReactNode => {
        const integration = integrationByIdentifier.get(app.identifier) ?? null;
        const available = integration?.connection_state === "connected";
        const selected = integration !== null && selectedIntegrationIds.includes(integration.integration_id);
        return (
            <button
                className={`app-tile${compact ? " compact" : ""}${selected ? " selected" : ""}${available ? "" : " needs-connection"}`}
                type="button"
                onClick={() => {
                    if (integration !== null && available) addIntegration(integration);
                    else window.location.assign(`/organization/settings?connect=${encodeURIComponent(app.identifier)}`);
                }}
                aria-label={`${selected ? "Added" : available ? "Add" : "Connect"} ${app.display_name}`}
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
                    <small>{cleanAppDescription(app.display_name, app.description)}</small>
                </span>
                <span className={`app-tile-action${selected ? " added" : ""}`} aria-hidden="true">
                    {selected ? "✓" : "+"}
                </span>
            </button>
        );
    };

    return (
        <div className={`app-picker${activeIntegration === null ? "" : " detail-open"}`}>
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
                        <h2 id="available-apps-heading">
                            {query.trim().length === 0 ? "Popular apps" : "Search results"}
                        </h2>
                        <p>
                            {query.trim().length === 0
                                ? `${popularApps.length} common picks. Connected apps add their approved read tools.`
                                : `${searchResults.length.toLocaleString()} matches in ${remainingApps.length.toLocaleString()} more apps.`}
                        </p>
                    </div>
                    <label className="app-search">
                        <span className="visually-hidden">Find an app</span>
                        <input
                            type="search"
                            value={query}
                            onChange={event => setQuery(event.currentTarget.value)}
                            placeholder={`Search ${remainingApps.length.toLocaleString()} more apps`}
                        />
                    </label>
                </div>
                <div className={`app-grid${query.trim().length === 0 ? " featured-app-grid" : " app-search-results"}`}>
                    {(query.trim().length === 0 ? popularApps : searchResults.slice(0, 20)).map(app =>
                        appTile(app, query.trim().length === 0)
                    )}
                </div>
                {query.trim().length > 0 && searchResults.length === 0 ? (
                    <p className="app-empty">No other apps match "{query.trim()}".</p>
                ) : null}
                {searchResults.length > 20 ? (
                    <p className="app-search-summary">
                        Showing the first 20 matches. Add another word to narrow it down.
                    </p>
                ) : null}
            </section>

            <section
                className={`selected-apps${selectedIntegrations.length === 0 ? " empty" : ""}`}
                aria-labelledby="selected-apps-heading"
            >
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
                                            <small>
                                                {connectedAccountName(
                                                    integration.display_name,
                                                    integration.connected_account_label
                                                ) ?? "Connected"}
                                            </small>
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
                {activeIntegration === null ? null : (
                    <section className="app-detail inline-app-detail" aria-labelledby="app-detail-heading">
                        <div className="app-detail-head">
                            <IntegrationIcon integration={activeIntegration} />
                            <div>
                                <p className="eyebrow">App access</p>
                                <h2 id="app-detail-heading">{activeIntegration.display_name}</h2>
                            </div>
                            <span className="status-badge good">Connected</span>
                            <button
                                className="app-detail-close"
                                type="button"
                                onClick={() => setActiveIntegrationId(null)}
                                aria-label={`Close ${activeIntegration.display_name} access`}
                            >
                                ×
                            </button>
                        </div>
                        <div className="app-detail-copy">
                            <p>Choose exact tools. The organization limit still applies.</p>
                        </div>
                        <div
                            className="permission-levels"
                            aria-label={`${activeIntegration.display_name} access level`}
                        >
                            {(["read", "write", "destructive"] as const).map(level => (
                                <button
                                    type="button"
                                    className={
                                        permissionLevels[activeIntegration.integration_id] === level ? "active" : ""
                                    }
                                    onClick={() => setPermissionLevel(activeIntegration, level)}
                                    aria-pressed={permissionLevels[activeIntegration.integration_id] === level}
                                    key={level}
                                >
                                    {level === "read" ? "Read only" : level === "write" ? "+ Write" : "+ Destructive"}
                                </button>
                            ))}
                        </div>
                        <div className="permission-stack app-permissions">
                            {activeIntegration.permissions
                                .filter(
                                    permission =>
                                        permissionLevelRank[permission.effect] <=
                                        permissionLevelRank[
                                            permissionLevels[activeIntegration.integration_id] ?? "read"
                                        ]
                                )
                                .map(permission => (
                                    <PermissionChoice
                                        permission={permission}
                                        checked={(
                                            selectedPermissionIds[activeIntegration.integration_id] ?? []
                                        ).includes(permission.policy_id)}
                                        disabled={
                                            permissionLevelRank[permission.effect] >
                                            permissionLevelRank[
                                                permissionLevels[activeIntegration.integration_id] ?? "read"
                                            ]
                                        }
                                        onChange={checked =>
                                            setPermission(
                                                activeIntegration.integration_id,
                                                permission.policy_id,
                                                checked
                                            )
                                        }
                                        key={permission.policy_id}
                                    />
                                ))}
                        </div>
                    </section>
                )}
            </section>
        </div>
    );
};

const AppearanceChoices = ({
    name,
    options,
    className,
    kind,
    selectedId,
    onSelect,
}: {
    readonly name: string;
    readonly options: readonly { readonly id: string; readonly display_name: string; readonly preview?: string }[];
    readonly className: string;
    readonly kind: "color" | "shape" | "face";
    readonly selectedId: string;
    readonly onSelect: (id: string) => void;
}) => (
    <div className={className}>
        {options.map(option => (
            <label className={`${kind}-choice`} key={option.id}>
                <input
                    type="radio"
                    name={name}
                    value={option.id}
                    checked={selectedId === option.id}
                    onChange={() => onSelect(option.id)}
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
                <h1>{hasBots ? "Choose a bot" : "Create your first bot"}</h1>
                <p className="muted">Bots live in the sidebar. Each one has its own chat, apps, and routines.</p>
            </div>
            <a className="button" href="/bots/new">
                New bot
            </a>
        </div>
        {hasBots ? (
            <div className="card">
                <h2>Your bots</h2>
                <p className="muted">Choose one from the sidebar to start a task.</p>
            </div>
        ) : (
            <div className="card empty-state">
                <div className="empty-mark" aria-hidden="true">
                    +
                </div>
                <h2>No bots yet</h2>
                <p className="muted">Create one, choose its app access, then give it a task.</p>
            </div>
        )}
    </>
);

type OrganizationSettingsPage = OpenBotClientPageV1 & {
    readonly view: Extract<OpenBotClientPageV1["view"], { kind: "organization_settings" }>;
};
const OrganizationSettingsView = ({ page }: { readonly page: OrganizationSettingsPage }) => {
    const [query, setQuery] = useState("");
    const connectedIdentifiers = new Set(page.view.integrations.map(integration => integration.provider_identifier));
    const availableApps = page.view.catalog_apps.filter(app => {
        if (connectedIdentifiers.has(app.identifier)) return false;
        const normalized = query.trim().toLocaleLowerCase();
        return (
            normalized.length === 0 || `${app.display_name} ${app.description}`.toLocaleLowerCase().includes(normalized)
        );
    });

    return (
        <>
            <div className="page-head org-page-head">
                <div>
                    <p className="eyebrow">Organization</p>
                    <h1>{page.view.organization_name}</h1>
                    <p className="muted">
                        App connections and the maximum tools any bot may use. Bots receive a smaller set, never more.
                    </p>
                </div>
            </div>
            <div className="organization-layout">
                <section aria-labelledby="organization-integrations-heading">
                    <h2 className="visually-hidden" id="organization-integrations-heading">
                        Connected apps and permissions
                    </h2>
                    <div className="integration-options">
                        {page.view.integrations.map((integration, index) => {
                            const enabledCount = integration.permissions.filter(
                                permission => permission.enabled
                            ).length;
                            return (
                                <details
                                    className="integration-card organization-integration"
                                    open={index === 0}
                                    key={integration.integration_id}
                                >
                                    <summary className="integration-choice">
                                        <IntegrationIcon integration={integration} />
                                        <span>
                                            <strong>{integration.display_name}</strong>
                                            <small>{integration.description}</small>
                                        </span>
                                        <span className="org-tool-summary">
                                            {enabledCount} of {integration.permissions.length} tools on
                                        </span>
                                        <span className="disclosure-chevron" aria-hidden="true">
                                            ›
                                        </span>
                                    </summary>
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
                                                    </span>
                                                </span>
                                                {page.view.can_manage ? (
                                                    <form method="post" action="/actions/organization-permissions">
                                                        <input
                                                            type="hidden"
                                                            name="_csrf"
                                                            value={page.view.csrf_token}
                                                        />
                                                        <input
                                                            type="hidden"
                                                            name="integration_id"
                                                            value={integration.integration_id}
                                                        />
                                                        <input
                                                            type="hidden"
                                                            name="policy_id"
                                                            value={permission.policy_id}
                                                        />
                                                        <input
                                                            type="hidden"
                                                            name="enabled"
                                                            value={permission.enabled ? "false" : "true"}
                                                        />
                                                        <button
                                                            className={`permission-switch${permission.enabled ? " on" : ""}`}
                                                            type="submit"
                                                            aria-label={`${permission.enabled ? "Disable" : "Enable"} ${permission.display_name}`}
                                                        >
                                                            <span aria-hidden="true" />
                                                        </button>
                                                    </form>
                                                ) : (
                                                    <span
                                                        className={`status-badge${permission.enabled ? " good" : ""}`}
                                                    >
                                                        {permission.enabled ? "Allowed" : "Blocked"}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <footer className="integration-footer">
                                        <span>
                                            {connectedAccountName(
                                                integration.display_name,
                                                integration.connected_account_label
                                            ) === null
                                                ? "Connected"
                                                : `Connected as ${connectedAccountName(
                                                      integration.display_name,
                                                      integration.connected_account_label
                                                  )}`}
                                        </span>
                                        <span className="disconnect-label">Disconnect</span>
                                    </footer>
                                </details>
                            );
                        })}
                    </div>
                    <p className="org-policy-note">
                        Turning a tool off removes it from every bot immediately. Pending reviews that relied on it
                        expire.
                    </p>
                </section>
                <aside className="integration-catalog-sidebar" aria-label="Add an integration">
                    <p className="section-label">Add an integration</p>
                    <label className="org-app-search">
                        <span className="visually-hidden">Search apps</span>
                        <input
                            type="search"
                            value={query}
                            onChange={event => setQuery(event.currentTarget.value)}
                            placeholder={`Search ${page.view.catalog_apps.length.toLocaleString()} apps`}
                        />
                    </label>
                    <div className="available-app-list">
                        {availableApps.slice(0, query.trim().length === 0 ? 8 : 20).map(app => (
                            <a
                                href={`/organization/settings?connect=${encodeURIComponent(app.identifier)}`}
                                key={app.identifier}
                            >
                                <IntegrationIcon integration={app} />
                                <span>{app.display_name}</span>
                                <strong>+ Connect</strong>
                            </a>
                        ))}
                    </div>
                    <p className="catalog-note">
                        Connecting here sets the organization limit. Each bot still picks its exact tools.
                    </p>
                </aside>
            </div>
        </>
    );
};

type NewBotPage = OpenBotClientPageV1 & { readonly view: Extract<OpenBotClientPageV1["view"], { kind: "new_bot" }> };
type NewBotSection = "identity" | "appearance" | "apps";

const SetupSection = ({
    id,
    step,
    title,
    summary,
    complete,
    active,
    onToggle,
    children,
}: {
    readonly id: NewBotSection;
    readonly step: number;
    readonly title: string;
    readonly summary: string;
    readonly complete: boolean;
    readonly active: boolean;
    readonly onToggle: () => void;
    readonly children: ReactNode;
}) => (
    <section className={`setup-section${active ? " open" : ""}`}>
        <h2>
            <button
                className="setup-section-toggle"
                type="button"
                onClick={onToggle}
                aria-expanded={active}
                aria-controls={`setup-${id}`}
            >
                <span className={`setup-step${complete ? " complete" : ""}`} aria-hidden="true">
                    {complete ? "✓" : step}
                </span>
                <span className="setup-section-copy">
                    <strong>{title}</strong>
                    <small>{summary}</small>
                </span>
                <span className="setup-section-action">{active ? "Hide" : complete ? "Edit" : "Open"}</span>
            </button>
        </h2>
        <div className="setup-section-panel" id={`setup-${id}`} hidden={!active}>
            {children}
        </div>
    </section>
);

const optionName = (
    options: readonly { readonly id: string; readonly display_name: string }[],
    selectedId: string
): string => options.find(option => option.id === selectedId)?.display_name ?? selectedId;

const NewBotView = ({ page }: { readonly page: NewBotPage }) => {
    const [activeSection, setActiveSection] = useState<NewBotSection | null>("identity");
    const [name, setName] = useState("");
    const [shortDescription, setShortDescription] = useState("");
    const [purpose, setPurpose] = useState("");
    const [instructions, setInstructions] = useState("");
    const [colorId, setColorId] = useState(page.view.colors[0]?.id ?? "graphite");
    const [shapeId, setShapeId] = useState(page.view.shapes[1]?.id ?? page.view.shapes[0]?.id ?? "squircle");
    const [faceId, setFaceId] = useState(page.view.faces[0]?.id ?? "calm");
    const [selectedAppCount, setSelectedAppCount] = useState(0);
    const [localError, setLocalError] = useState<string | null>(null);
    const identityComplete =
        name.trim().length > 0 &&
        shortDescription.trim().length > 0 &&
        purpose.trim().length > 0 &&
        instructions.trim().length > 0;
    const openSection = (section: NewBotSection): void =>
        setActiveSection(current => (current === section ? null : section));

    return (
        <>
            <div className="page-head compact-page-head">
                <div>
                    <p className="eyebrow">Bot setup</p>
                    <h1>New bot</h1>
                    <p className="muted">One decision at a time. Everything here can be changed later.</p>
                </div>
            </div>
            {page.view.error === null && localError === null ? null : (
                <ErrorSummary>{page.view.error ?? localError}</ErrorSummary>
            )}
            <form
                className="new-bot-form"
                method="post"
                action="/actions/bots"
                noValidate
                onSubmit={event => {
                    const missingSection = !identityComplete ? "identity" : null;
                    if (missingSection === null) return;
                    event.preventDefault();
                    setActiveSection(missingSection);
                    setLocalError("Finish the bot identity before creating it.");
                }}
            >
                <input type="hidden" name="_csrf" value={page.view.csrf_token} />
                <div className="setup-stack">
                    <SetupSection
                        id="identity"
                        step={1}
                        title="Identity"
                        summary={identityComplete ? `${name} · ${shortDescription}` : "Name, purpose, and boundaries"}
                        complete={identityComplete}
                        active={activeSection === "identity"}
                        onToggle={() => openSection("identity")}
                    >
                        <div className="compact-field-grid">
                            <label htmlFor="name">
                                Name
                                <input
                                    id="name"
                                    name="name"
                                    type="text"
                                    value={name}
                                    onChange={event => setName(event.currentTarget.value)}
                                    maxLength={128}
                                    autoComplete="off"
                                />
                            </label>
                            <label htmlFor="short-description">
                                Short description
                                <input
                                    id="short-description"
                                    name="short_description"
                                    type="text"
                                    value={shortDescription}
                                    onChange={event => setShortDescription(event.currentTarget.value)}
                                    maxLength={512}
                                    autoComplete="off"
                                />
                            </label>
                        </div>
                        <details className="identity-details" open>
                            <summary>Purpose and boundaries</summary>
                            <div className="compact-field-grid">
                                <label htmlFor="purpose">
                                    Purpose
                                    <textarea
                                        id="purpose"
                                        name="purpose"
                                        value={purpose}
                                        onChange={event => setPurpose(event.currentTarget.value)}
                                    />
                                </label>
                                <label htmlFor="instructions">
                                    Behavior instructions
                                    <textarea
                                        id="instructions"
                                        name="standing_instructions"
                                        value={instructions}
                                        onChange={event => setInstructions(event.currentTarget.value)}
                                    />
                                </label>
                            </div>
                        </details>
                        <div className="setup-panel-actions">
                            <button
                                className="button secondary"
                                type="button"
                                onClick={() => setActiveSection("appearance")}
                            >
                                Continue to appearance
                            </button>
                        </div>
                    </SetupSection>

                    <SetupSection
                        id="appearance"
                        step={2}
                        title="Appearance"
                        summary={`${optionName(page.view.colors, colorId)} · ${optionName(page.view.shapes, shapeId)} · ${optionName(page.view.faces, faceId)}`}
                        complete
                        active={activeSection === "appearance"}
                        onToggle={() => openSection("appearance")}
                    >
                        <div className="appearance-group">
                            <p className="appearance-label">Color</p>
                            <AppearanceChoices
                                name="palette_color_id"
                                options={page.view.colors}
                                className="color-options"
                                kind="color"
                                selectedId={colorId}
                                onSelect={setColorId}
                            />
                        </div>
                        <div className="appearance-group">
                            <p className="appearance-label">Shape</p>
                            <AppearanceChoices
                                name="avatar_shape_id"
                                options={page.view.shapes}
                                className="shape-options"
                                kind="shape"
                                selectedId={shapeId}
                                onSelect={setShapeId}
                            />
                        </div>
                        <div className="appearance-group">
                            <p className="appearance-label">Face</p>
                            <AppearanceChoices
                                name="avatar_face_id"
                                options={page.view.faces}
                                className="face-options"
                                kind="face"
                                selectedId={faceId}
                                onSelect={setFaceId}
                            />
                        </div>
                        <p className="muted setup-note">
                            Moods artwork is generated locally. Reduced motion is respected.
                        </p>
                        <div className="setup-panel-actions">
                            <button className="button secondary" type="button" onClick={() => setActiveSection("apps")}>
                                Continue to apps
                            </button>
                        </div>
                    </SetupSection>

                    <SetupSection
                        id="apps"
                        step={3}
                        title="Apps and access"
                        summary={
                            selectedAppCount > 0 ? `${selectedAppCount} apps added` : "Choose apps and exact tools"
                        }
                        complete={selectedAppCount > 0}
                        active={activeSection === "apps"}
                        onToggle={() => openSection("apps")}
                    >
                        <p className="muted setup-note">This bot can use only the tools allowed by the organization.</p>
                        <IntegrationChoices
                            integrations={page.view.integrations}
                            catalogApps={page.view.catalog_apps}
                            onSelectionCountChange={setSelectedAppCount}
                        />
                    </SetupSection>
                </div>
                <div className="actions setup-form-actions">
                    <a className="text-link" href="/bots">
                        Cancel
                    </a>
                    <button className="create-bot-button" type="submit">
                        Create bot
                    </button>
                </div>
            </form>
        </>
    );
};

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

const ChatComposer = ({ bot, csrfToken }: { readonly bot: OpenBotClientBotDetailV1; readonly csrfToken: string }) => (
    <section className="chat-composer" aria-label="Message composer">
        <form method="post" action="/actions/chat-messages">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="bot_id" value={bot.bot_id} />
            <label htmlFor="prompt" className="visually-hidden">
                Message {bot.name}
            </label>
            <textarea id="prompt" name="prompt" required placeholder={`Message ${bot.name}…`} />
            <div className="composer-actions">
                <span className="composer-note">Tasks and routine changes happen here.</span>
                <button className="send-message" type="submit" aria-label="Send message">
                    <span aria-hidden="true">↑</span>
                </button>
            </div>
        </form>
    </section>
);

const BotChatView = ({ page }: { readonly page: BotChatPage }) => {
    const { bot } = page.view;
    return (
        <div className="chat-page">
            <ChatHeader bot={bot} />
            {page.view.routine_created === null ? (
                <div className="chat-empty">
                    <BotAvatar bot={bot} size="large" />
                    <h2>What should we work on?</h2>
                    <p className="muted">Give {bot.name} a task or manage its routines in chat.</p>
                </div>
            ) : (
                <div className="conversation routine-created-conversation">
                    <section className="message user">
                        <div className="message-copy">
                            <p>{page.view.routine_created.prompt}</p>
                        </div>
                    </section>
                    <section className="message">
                        <BotAvatar bot={bot} />
                        <div className="message-copy routine-created-card">
                            <p className="eyebrow">Routine created</p>
                            <h2>{page.view.routine_created.name}</h2>
                            <dl className="routine-created-details">
                                <dt>Schedule</dt>
                                <dd>{page.view.routine_created.schedule}</dd>
                            </dl>
                            <p className="muted">You can edit or pause it from the sidebar.</p>
                        </div>
                    </section>
                </div>
            )}
            <ChatComposer bot={bot} csrfToken={page.view.csrf_token} />
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
                                <p className="muted">Check the connected apps and exact access before this runs.</p>
                                <h2>Connected apps</h2>
                                <dl className="disclosure-list">
                                    {view.providers.map(provider => (
                                        <div
                                            className="disclosure-group"
                                            key={`${provider.display_name}:${provider.connected_account_label}`}
                                        >
                                            <dt>App</dt>
                                            <dd>{provider.display_name}</dd>
                                            {connectedAccountName(
                                                provider.display_name,
                                                provider.connected_account_label
                                            ) === null ? null : (
                                                <>
                                                    <dt>Account</dt>
                                                    <dd>
                                                        {connectedAccountName(
                                                            provider.display_name,
                                                            provider.connected_account_label
                                                        )}
                                                    </dd>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </dl>
                                <h2>Exact tools</h2>
                                <dl className="disclosure-list">
                                    {view.permissions.map(permission => (
                                        <div className="disclosure-group" key={permission.policy_id}>
                                            <dt>Tool</dt>
                                            <dd>{permission.display_name}</dd>
                                            <dt>Data</dt>
                                            <dd>{permission.consequence_summary}</dd>
                                        </div>
                                    ))}
                                </dl>
                                <p className="notice">The bot cannot use tools outside this review.</p>
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
                <h2 className="visually-hidden">Task result</h2>
                <div className="conversation">
                    <section className="message user">
                        <div className="message-copy">
                            <p>{view.prompt}</p>
                        </div>
                    </section>
                    <section className="message">
                        <BotAvatar bot={view.bot} />
                        <div className="message-copy result-message">
                            <div className="result-card">
                                <p className="eyebrow">Result</p>
                                <h2>Result</h2>
                                {view.completed ? (
                                    <pre className="result">{view.result_text}</pre>
                                ) : (
                                    <p>The task is still running.</p>
                                )}
                                <div className="result-badges">
                                    <span className={`status-badge${view.completed ? " good" : ""}`}>
                                        {view.completed ? "Completed" : "Running"}
                                    </span>
                                    <span className="status-badge">Nothing sent</span>
                                    <span className="status-badge technical">Synthetic test only</span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
                <ChatComposer bot={view.bot} csrfToken={view.csrf_token} />
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
                                <p className="eyebrow">Routine</p>
                                <h2 className="review-title">{view.name}</h2>
                                <p className="muted">Here is what {view.bot.name} will save.</p>
                                <dl className="disclosure-list">
                                    <div className="disclosure-group">
                                        <dt>Schedule</dt>
                                        <dd>{view.schedule}</dd>
                                        <dt>Prompt</dt>
                                        <dd>{view.prompt}</dd>
                                    </div>
                                </dl>
                                <details className="routine-access-disclosure">
                                    <summary>{view.permissions.length} exact tools</summary>
                                    <ul className="context-tools">
                                        {view.permissions.map(permission => (
                                            <li key={permission.policy_id}>
                                                <strong>{permission.display_name}</strong>
                                                <span className="muted">{permission.resource_scope_summary}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </details>
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
        <section className="context-section" aria-labelledby="permissions-heading" aria-label="App access">
            <h3 id="permissions-heading">App access</h3>
            <div aria-label="Selected permissions">
                {bot.access.map(binding => (
                    <section className="context-integration" key={binding.integration.integration_id}>
                        <div className="context-integration-head">
                            <IntegrationIcon integration={binding.integration} />
                            <strong>{binding.integration.display_name}</strong>
                            <span className="context-integration-count">
                                {binding.permissions.length} {binding.permissions.length === 1 ? "tool" : "tools"}
                            </span>
                        </div>
                        <ul className="context-tools">
                            {binding.permissions.map(permission => (
                                <li key={permission.policy_id}>
                                    <strong>{permission.display_name}</strong>
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
                            <span className="brand-mark" aria-hidden="true" />
                            <span>OpenBot</span>
                        </a>
                        <a className="new-bot" href="/bots/new">
                            <span className="plus" aria-hidden="true">
                                +
                            </span>
                            <span>New bot</span>
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
