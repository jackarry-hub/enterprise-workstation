export type OAuthProviderDefinition = {
  code: string;
  label: string;
  supabaseProvider: `custom:${string}`;
  enabled: boolean;
  loginButtonLabel: string;
};

const oauthProviderRegistry = [
  {
    code: "feishu",
    label: "飞书",
    supabaseProvider: "custom:feishu",
    enabled: true,
    loginButtonLabel: "使用飞书登录",
  },
] as const satisfies readonly OAuthProviderDefinition[];

export function getEnabledOAuthProvider(
  code: string,
  providers: readonly OAuthProviderDefinition[] = oauthProviderRegistry,
): OAuthProviderDefinition | null {
  return providers.find((provider) => provider.code === code && provider.enabled)
    ?? null;
}
