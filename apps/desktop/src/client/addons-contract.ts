import type { AddonListResponse, AddonResponse } from '@atd/agent-contracts';

/**
 * Add-ons: optional parts of the product the service downloads, verifies and activates while the
 * app runs (`/v1/addons` through the relay). Install and cancel answer at once; the outcome
 * arrives through the `addons` invalidation, which `onChange` reports. A removal that a consumer
 * still blocks rejects, and the add-on's view then carries the reason as its `error`.
 */
export interface AddonsBridge {
  /** Every add-on this build knows, with its install state. */
  list(): Promise<AddonListResponse>;
  /** Starts installing the archive this build pins, or joins the install already running. */
  install(id: string): Promise<AddonResponse>;
  /** Cancels a running download or install; an active install stays. */
  cancel(id: string): Promise<AddonResponse>;
  /** Removes the add-on's files; rejects while a consumer still uses it. */
  remove(id: string): Promise<AddonResponse>;
  /** Add-ons may have changed: an `addons` invalidation, or a reconnect. */
  onChange(listener: () => void): () => void;
}
