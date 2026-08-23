import { z } from "zod";

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const id = <Brand extends string>(brand: Brand) =>
    z.string().regex(uuidV7, `Expected a lowercase UUIDv7 ${brand}`).brand<Brand>();

export const AccountIdSchema = id("AccountId");
export type AccountId = z.infer<typeof AccountIdSchema>;
export const UserIdSchema = id("UserId");
export type UserId = z.infer<typeof UserIdSchema>;
export const BotIdSchema = id("BotId");
export type BotId = z.infer<typeof BotIdSchema>;
export const BotRevisionIdSchema = id("BotRevisionId");
export type BotRevisionId = z.infer<typeof BotRevisionIdSchema>;
export const OrganizationToolPolicyIdSchema = id("OrganizationToolPolicyId");
export type OrganizationToolPolicyId = z.infer<typeof OrganizationToolPolicyIdSchema>;
export const OrganizationComputePolicyIdSchema = id("OrganizationComputePolicyId");
export type OrganizationComputePolicyId = z.infer<typeof OrganizationComputePolicyIdSchema>;
export const ComputeGrantIdSchema = id("ComputeGrantId");
export type ComputeGrantId = z.infer<typeof ComputeGrantIdSchema>;
export const SkillIdSchema = id("SkillId");
export type SkillId = z.infer<typeof SkillIdSchema>;
export const SkillRevisionIdSchema = id("SkillRevisionId");
export type SkillRevisionId = z.infer<typeof SkillRevisionIdSchema>;
export const CapabilityGrantIdSchema = id("CapabilityGrantId");
export type CapabilityGrantId = z.infer<typeof CapabilityGrantIdSchema>;
export const ProviderAuthorizationIdSchema = id("ProviderAuthorizationId");
export type ProviderAuthorizationId = z.infer<typeof ProviderAuthorizationIdSchema>;
export const ProviderDeploymentIdSchema = id("ProviderDeploymentId");
export type ProviderDeploymentId = z.infer<typeof ProviderDeploymentIdSchema>;
export const ConnectorReleaseIdSchema = id("ConnectorReleaseId");
export type ConnectorReleaseId = z.infer<typeof ConnectorReleaseIdSchema>;
export const ConfigurationContentIdSchema = id("ConfigurationContentId");
export type ConfigurationContentId = z.infer<typeof ConfigurationContentIdSchema>;
export const ConfirmationIdSchema = id("ConfirmationId");
export type ConfirmationId = z.infer<typeof ConfirmationIdSchema>;
export const RunIdSchema = id("RunId");
export type RunId = z.infer<typeof RunIdSchema>;
export const ManifestIdSchema = id("ManifestId");
export type ManifestId = z.infer<typeof ManifestIdSchema>;
