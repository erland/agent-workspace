export interface ModalConfig {
  tokenId?: string;
  tokenSecret?: string;
  appName: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;

function optionalNonBlank(env: Environment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function loadModalConfig(env: Environment = process.env): ModalConfig {
  const tokenId = optionalNonBlank(env, "MODAL_TOKEN_ID");
  const tokenSecret = optionalNonBlank(env, "MODAL_TOKEN_SECRET");

  if ((tokenId === undefined) !== (tokenSecret === undefined)) {
    throw new Error(
      "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET must either both be set or both be omitted"
    );
  }

  return {
    ...(tokenId !== undefined && tokenSecret !== undefined
      ? { tokenId, tokenSecret }
      : {}),
    appName: env.MODAL_APP_NAME?.trim() || "agent-workspace-dev"
  };
}
