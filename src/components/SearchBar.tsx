import { RefreshCw } from "lucide-react";
import { toast } from "@/utils/toast";

import { indexingApi } from "@/api/indexing";
import { useI18nContext } from "@/i18n/I18nProvider";

type Props = {
  value: string;
  onChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFullScanCompleted?: () => Promise<void> | void;
};

export const SearchBar = ({
  value,
  onChange,
  inputRef,
  onFullScanCompleted,
}: Props) => {
  const { LL } = useI18nContext();

  const handleFullScan = async () => {
    try {
      await indexingApi.fullScan();
      await onFullScanCompleted?.();
      toast.success(LL.searchBar.indexRefreshed());
    } catch (error) {
      console.error(error);
      toast.error(LL.searchBar.refreshIndexFailed());
    }
  };

  return (
    <header
      className="flex-none pl-5 pr-4 pt-3 pb-3 bg-header-bg border-b border-border-main"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-3">
        <input
          autoFocus
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-2xl font-light outline-none placeholder:text-placeholder"
          placeholder={LL.searchBar.placeholder()}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />

        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-hover-bg hover:text-text-main focus:outline-none"
          title={LL.searchBar.fullScan()}
          onClick={handleFullScan}
          data-tauri-drag-region="false"
        >
          <RefreshCw size={18} />
        </button>
      </div>
    </header>
  );
};
