// src/components/ItemList/EmptyState.tsx
import { useI18nContext } from "@/i18n/I18nProvider";

type Props = {
  isLoading?: boolean;
};

export const EmptyState = ({ isLoading }: Props) => {
  const { LL } = useI18nContext();

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-60">
      <span className="text-3xl mb-3">{isLoading ? "⏳" : "🍃"}</span>
      <span className="text-sm font-semibold">
        {isLoading ? LL.itemList.searching() : LL.itemList.noResults()}
      </span>
      <span className="text-[10px] mt-2 opacity-70">
        {isLoading
          ? LL.itemList.scanningDictionary()
          : LL.itemList.noResultsHint()}
      </span>
    </div>
  );
};
