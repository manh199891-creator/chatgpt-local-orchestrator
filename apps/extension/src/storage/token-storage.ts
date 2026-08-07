const TOKEN_KEY = "bridge_token";
const CURRENT_JOB_ID_KEY = "current_job_id";

// In-memory fallback map for unit tests / node environment where chrome.storage is unavailable
const memoryFallbackMap = new Map<string, string>();

function isChromeStorageAvailable(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadBridgeToken(): Promise<string | null> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([TOKEN_KEY], (result) => {
        const token = result[TOKEN_KEY];
        if (typeof token === "string" && token.trim()) {
          resolve(token.trim());
        } else {
          resolve(null);
        }
      });
    });
  }
  const token = memoryFallbackMap.get(TOKEN_KEY);
  return token && token.trim() ? token.trim() : null;
}

export async function saveBridgeToken(token: string): Promise<void> {
  const trimmed = (token || "").trim();
  if (!trimmed) {
    throw new Error("Token cannot be empty.");
  }

  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [TOKEN_KEY]: trimmed }, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.set(TOKEN_KEY, trimmed);
}

export async function clearBridgeToken(): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([TOKEN_KEY], () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.delete(TOKEN_KEY);
}

export async function loadCurrentJobId(): Promise<string | null> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([CURRENT_JOB_ID_KEY], (result) => {
        const jobId = result[CURRENT_JOB_ID_KEY];
        if (typeof jobId === "string" && jobId.trim()) {
          resolve(jobId.trim());
        } else {
          resolve(null);
        }
      });
    });
  }
  const jobId = memoryFallbackMap.get(CURRENT_JOB_ID_KEY);
  return jobId && jobId.trim() ? jobId.trim() : null;
}

export async function saveCurrentJobId(jobId: string): Promise<void> {
  const trimmed = (jobId || "").trim();
  if (!trimmed) {
    throw new Error("Job ID cannot be empty.");
  }

  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [CURRENT_JOB_ID_KEY]: trimmed }, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.set(CURRENT_JOB_ID_KEY, trimmed);
}

export async function clearCurrentJobId(): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([CURRENT_JOB_ID_KEY], () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.delete(CURRENT_JOB_ID_KEY);
}

const CURRENT_PROJECT_ID_KEY = "current_project_id";

export async function loadCurrentProjectId(): Promise<string | null> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([CURRENT_PROJECT_ID_KEY], (result) => {
        const projectId = result[CURRENT_PROJECT_ID_KEY];
        if (typeof projectId === "string" && projectId.trim()) {
          resolve(projectId.trim());
        } else {
          resolve(null);
        }
      });
    });
  }
  const projectId = memoryFallbackMap.get(CURRENT_PROJECT_ID_KEY);
  return projectId && projectId.trim() ? projectId.trim() : null;
}

export async function saveCurrentProjectId(projectId: string): Promise<void> {
  const trimmed = (projectId || "").trim();
  if (!trimmed) {
    throw new Error("Project ID cannot be empty.");
  }

  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [CURRENT_PROJECT_ID_KEY]: trimmed }, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.set(CURRENT_PROJECT_ID_KEY, trimmed);
}

export async function clearCurrentProjectId(): Promise<void> {
  if (isChromeStorageAvailable()) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([CURRENT_PROJECT_ID_KEY], () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  memoryFallbackMap.delete(CURRENT_PROJECT_ID_KEY);
}
