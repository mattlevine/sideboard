import type { PublicAppSettings } from '../store/app-settings.js';
import type { SlackOrgRegistration } from '../slack/org-app-client.js';

export type { SlackOrgRegistration };

export interface SlackOrgCredentialInput {
  registrationId: string;
  writeToken: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
}

/** Company-owned Slack app. The write token is shown once and is not a setting. */
export interface SlackOrgIpc {
  createSlackOrgApp(): Promise<SlackOrgRegistration>;
  saveSlackOrgCredentials(input: SlackOrgCredentialInput): Promise<PublicAppSettings>;
  /** Remember a company Slack client id so this Mac can sign in to that team. */
  addSlackClientId(clientId: string): Promise<PublicAppSettings>;
  /** Drop a client id from this Mac. Does not disconnect a team already signed in. */
  removeSlackClientId(clientId: string): Promise<PublicAppSettings>;
}
