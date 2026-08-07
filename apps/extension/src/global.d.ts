declare namespace chrome {
  namespace runtime {
    interface InstalledDetails {
      reason: string;
      previousVersion?: string;
    }
    const lastError: { message?: string } | undefined;
    const onInstalled: {
      addListener(callback: (details: InstalledDetails) => void): void;
    };
  }
  namespace sidePanel {
    interface PanelBehavior {
      openPanelOnActionClick?: boolean;
    }
    function setPanelBehavior(behavior: PanelBehavior): Promise<void>;
  }
  namespace storage {
    const local: {
      get(keys: string | string[] | Record<string, unknown> | null, callback: (items: Record<string, unknown>) => void): void;
      set(items: Record<string, unknown>, callback?: () => void): void;
      remove(keys: string | string[], callback?: () => void): void;
      clear(callback?: () => void): void;
    };
  }
}
