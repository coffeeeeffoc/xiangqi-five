export {};

declare global {
  interface Window {
    readonly __SMALL_GAMES_BUILD__?: Readonly<{ type: 'development' | 'test' | 'production' }>;
    SmallGamesDev: Readonly<{
      isEnabled(): boolean;
      state(): { enabled: boolean; source: 'url' | 'parent-url' | 'storage' | 'default' | 'build' };
      withMode(search?: string): string;
      inspect(): unknown;
      refresh(): void;
      setPanelHidden(hidden: boolean): void;
      registerActions(
        actions: readonly {
          id: string;
          label: string;
          input?: { label: string; min?: number; max?: number; step?: number; value?: number };
          run(value?: number): unknown;
        }[],
      ): () => void;
      registerSnapshot(read: () => unknown): () => void;
    }>;
  }
}
