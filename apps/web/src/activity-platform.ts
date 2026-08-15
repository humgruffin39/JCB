import {
  Common,
  DiscordSDK,
  Events,
  type EventPayloadData,
  type IDiscordSDK,
} from '@discord/embedded-app-sdk';
import { publishActivityRuntime } from './activity-runtime.js';

export interface ActivityAuthorization {
  readonly code: string;
}

export interface ActivityAuthenticatedUser {
  readonly id: string;
}

/** Small boundary that lets component and E2E tests run without Discord RPC. */
export interface ActivityPlatform {
  readonly instanceId: string;
  readonly launchId: string | undefined;
  readonly guildId: string | undefined;
  readonly channelId: string | undefined;
  ready(): Promise<void>;
  authorize(): Promise<ActivityAuthorization>;
  authenticate(accessToken: string): Promise<ActivityAuthenticatedUser>;
  dispose(): Promise<void>;
}

export type ActivityPlatformFactory = () => ActivityPlatform;

export function createDiscordActivityPlatform(clientId: string): ActivityPlatform {
  if (clientId.trim() === '') throw new Error('Discord Activity client ID is not configured.');
  return new DiscordActivityPlatform(new DiscordSDK(clientId), clientId);
}

class DiscordActivityPlatform implements ActivityPlatform {
  public readonly instanceId: string;
  public readonly launchId: string | undefined;
  public readonly guildId: string | undefined;
  public readonly channelId: string | undefined;
  private subscribed = false;
  private consumers = 0;
  private sdkReadyPromise: Promise<void> | undefined;
  private subscriptionPromise: Promise<void> | undefined;

  public constructor(
    private readonly sdk: IDiscordSDK & Pick<DiscordSDK, 'instanceId' | 'guildId' | 'channelId'>,
    private readonly clientId: string,
  ) {
    this.instanceId = sdk.instanceId;
    this.guildId = sdk.guildId ?? undefined;
    this.channelId = sdk.channelId ?? undefined;
    this.launchId = queryValue('launch_id');
  }

  public async ready(): Promise<void> {
    this.consumers += 1;
    this.sdkReadyPromise ??= this.sdk.ready();
    await this.sdkReadyPromise;
    publishActivityRuntime({ isActivity: true });
    await this.subscribeToRuntime();
    // Orientation is progressive enhancement: desktop and older mobile clients
    // may reject it, but authentication and playback must still continue.
    void this.sdk.commands
      .setOrientationLockState({
        lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
        picture_in_picture_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
        grid_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
      })
      .catch(() => undefined);
  }

  public authorize(): Promise<ActivityAuthorization> {
    return this.sdk.commands.authorize({
      client_id: this.clientId,
      response_type: 'code',
      prompt: 'none',
      scope: ['identify'],
    });
  }

  public async authenticate(accessToken: string): Promise<ActivityAuthenticatedUser> {
    const authenticated = await this.sdk.commands.authenticate({ access_token: accessToken });
    return { id: authenticated.user.id };
  }

  public async dispose(): Promise<void> {
    this.consumers = Math.max(0, this.consumers - 1);
    if (this.consumers > 0) return;
    if (this.subscriptionPromise !== undefined) await this.subscriptionPromise;
    if (this.consumers > 0 || !this.subscribed) return;
    this.subscribed = false;
    await Promise.allSettled([
      this.sdk.unsubscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, this.handleLayoutMode),
      this.sdk.unsubscribe(Events.THERMAL_STATE_UPDATE, this.handleThermalState),
    ]);
  }

  private readonly handleLayoutMode = (
    event: EventPayloadData<Events.ACTIVITY_LAYOUT_MODE_UPDATE>,
  ): void => {
    publishActivityRuntime({ layoutMode: activityLayoutMode(event.layout_mode) });
  };

  private readonly handleThermalState = (
    event: EventPayloadData<Events.THERMAL_STATE_UPDATE>,
  ): void => {
    publishActivityRuntime({ thermalState: activityThermalState(event.thermal_state) });
  };

  private async subscribeToRuntime(): Promise<void> {
    if (this.subscribed) return;
    this.subscriptionPromise ??= Promise.allSettled([
      this.sdk.subscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, this.handleLayoutMode),
      this.sdk.subscribe(Events.THERMAL_STATE_UPDATE, this.handleThermalState),
    ])
      .then((results) => {
        this.subscribed = results.some((result) => result.status === 'fulfilled');
      })
      .finally(() => {
        this.subscriptionPromise = undefined;
      });
    await this.subscriptionPromise;
  }
}

function queryValue(name: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = new URLSearchParams(window.location.search).get(name);
  return value === null || value.trim() === '' ? undefined : value;
}

function activityLayoutMode(value: number): 'focused' | 'pip' | 'grid' {
  if (value === Common.LayoutModeTypeObject.PIP) return 'pip';
  if (value === Common.LayoutModeTypeObject.GRID) return 'grid';
  return 'focused';
}

function activityThermalState(value: number): 'nominal' | 'fair' | 'serious' | 'critical' {
  if (value === Common.ThermalStateTypeObject.FAIR) return 'fair';
  if (value === Common.ThermalStateTypeObject.SERIOUS) return 'serious';
  if (value === Common.ThermalStateTypeObject.CRITICAL) return 'critical';
  return 'nominal';
}
