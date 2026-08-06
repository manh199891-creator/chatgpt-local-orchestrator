declare namespace chrome {
  namespace runtime {
    interface InstalledDetails {
      reason: string;
      previousVersion?: string;
    }
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
}
