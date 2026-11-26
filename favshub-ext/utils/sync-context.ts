import { baseUrlStorage, tokenStorage } from '@/utils/storage';
import type { RequestOptions } from '@/utils/request';

export interface SyncExecutionContext {
  baseUrl: string;
  token: string;
}

export async function readSyncExecutionContext(): Promise<SyncExecutionContext> {
  const [baseUrl, token] = await Promise.all([
    baseUrlStorage.getValue(),
    tokenStorage.getValue(),
  ]);
  return { baseUrl, token };
}

export function syncRequestOptions(context: SyncExecutionContext): Pick<RequestOptions, 'baseUrl' | 'token'> {
  return { baseUrl: context.baseUrl, token: context.token };
}

export function isSameSyncExecutionContext(
  left: SyncExecutionContext,
  right: SyncExecutionContext,
): boolean {
  return left.baseUrl === right.baseUrl && left.token === right.token;
}
