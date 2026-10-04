export const fixtureBranch = "codex/fullscreen-chat-fixture-20261004";
export function allowUIFixture(environment) {
  return environment.NODE_ENV === "development"
    || environment.VERCEL_ENV === "preview" && environment.VERCEL_GIT_COMMIT_REF === fixtureBranch;
}
