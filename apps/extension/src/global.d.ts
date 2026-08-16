declare namespace chrome {
  namespace runtime {
    const id: string;
    interface InstalledDetails {
      reason: string;
      previousVersion?: string;
    }
    const lastError: { message?: string } | undefined;
    const onInstalled: {
      addListener(callback: (details: InstalledDetails) => void): void;
    };
    const onStartup: { addListener(callback: () => void): void };
    interface MessageSender { id?: string; tab?: { id?: number; url?: string }; }
    const onMessage: {
      addListener(callback: (message: unknown, sender: MessageSender, sendResponse: (response: unknown) => void) => boolean | void): void;
      removeListener(callback: (message: unknown, sender: MessageSender, sendResponse: (response: unknown) => void) => boolean | void): void;
    };
    function sendMessage(message: unknown): Promise<unknown>;
  }
  namespace tabs {
    interface Tab { id?: number; url?: string; }
    function get(tabId: number): Promise<Tab>;
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
    function query(queryInfo: { url?: string | string[] }): Promise<Tab[]>;
  }
  namespace alarms {
    interface Alarm { name: string; scheduledTime: number; periodInMinutes?: number; }
    function create(name: string, alarmInfo: { delayInMinutes?: number; periodInMinutes?: number }): void;
    const onAlarm: { addListener(callback: (alarm: Alarm) => void): void };
  }
  namespace scripting {
    function executeScript(details: {target:{tabId:number};files?:string[];func?:()=>void}):Promise<unknown[]>;
  }
  namespace sidePanel {
    interface PanelBehavior {
      openPanelOnActionClick?: boolean;
    }
    function setPanelBehavior(behavior: PanelBehavior): Promise<void>;
  }
  namespace storage {
    interface StorageChange { oldValue?: unknown; newValue?: unknown; }
    const local: {
      get(keys: string | string[] | Record<string, unknown> | null, callback: (items: Record<string, unknown>) => void): void;
      set(items: Record<string, unknown>, callback?: () => void): void;
      remove(keys: string | string[], callback?: () => void): void;
      clear(callback?: () => void): void;
    };
    const onChanged: {
      addListener(callback: (changes: Record<string, StorageChange>, areaName: string) => void): void;
      removeListener(callback: (changes: Record<string, StorageChange>, areaName: string) => void): void;
    };
  }
}
