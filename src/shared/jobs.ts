/* ─────────────────────────────────────────────────
   FormPilot — Background jobs
   Work that outlives the popup. A Chrome popup is destroyed whenever it
   loses focus — opening a file chooser is enough — so anything slow must
   report through storage rather than through an open message port.
   ───────────────────────────────────────────────── */
import type { ExtractedProfile } from './resume.ts';

export const JOB_KEYS = {
  IMPORT: 'formpilot_job_import',
} as const;

export interface ImportJob {
  id: string;
  status: 'running' | 'done' | 'error';
  source: 'resume' | 'summary';
  label: string;            // file name, or a description of the pasted text
  startedAt: number;
  text?: string;            // extracted text, kept so it can go into rawInfo
  result?: ExtractedProfile;
  error?: string;
}

// A model call that has not answered in this long is not going to.
export const JOB_TIMEOUT_MS = 120_000;

const area = () =>
  (typeof chrome !== 'undefined' && chrome.storage?.session) ? chrome.storage.session : chrome.storage?.local;

export async function getJob(): Promise<ImportJob | null> {
  const store = area();
  if (!store) return null;
  const result = await store.get(JOB_KEYS.IMPORT);
  const job = result[JOB_KEYS.IMPORT] as ImportJob | undefined;
  if (!job) return null;

  // A job whose worker died mid-flight would otherwise spin forever.
  if (job.status === 'running' && Date.now() - job.startedAt > JOB_TIMEOUT_MS) {
    const timedOut: ImportJob = { ...job, status: 'error', error: 'That took too long and was stopped. Try a smaller file, or a faster model in Settings.' };
    await setJob(timedOut);
    return timedOut;
  }
  return job;
}

export async function setJob(job: ImportJob | null): Promise<void> {
  const store = area();
  if (!store) return;
  if (job) await store.set({ [JOB_KEYS.IMPORT]: job });
  else await store.remove(JOB_KEYS.IMPORT);
}

/** Calls back whenever the import job changes, in any extension context. */
export function onJobChange(callback: (job: ImportJob | null) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'session' && areaName !== 'local') return;
    if (!(JOB_KEYS.IMPORT in changes)) return;
    callback((changes[JOB_KEYS.IMPORT].newValue as ImportJob) ?? null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
