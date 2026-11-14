// Shared types for the Nextcloud OCS client (server-side only).

export interface NextcloudQuota {
  free: number;
  used: number;
  total: number;
  relative: number;
  /** Byte limit; -3 means unlimited (Nextcloud SPACE_UNLIMITED). */
  quota: number;
}

export interface NextcloudUser {
  id: string;
  enabled: boolean;
  email: string | null;
  displayname: string | null;
  quota: NextcloudQuota;
  lastLoginAt: number | null;
  createdAt: number | null;
}

export interface OcsMeta {
  status: "ok" | "failure";
  statuscode: number;
  message: string;
}

export interface OcsEnvelope<T> {
  ocs: {
    meta: OcsMeta;
    data: T;
  };
}
