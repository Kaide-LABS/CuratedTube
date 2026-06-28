"use client";

import type { Category } from "@/lib/types";

export type CategoryOption = Category | "All";

export function CategoryFilterBar({
  options,
  selected,
  onSelect,
}: {
  options: CategoryOption[];
  selected: CategoryOption;
  onSelect: (c: CategoryOption) => void;
}) {
  return (
    <div className="flex space-x-2 overflow-x-auto border-b border-zinc-800 pb-4">
      {options.map((opt) => {
        const active = opt === selected;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-100 text-zinc-900"
                : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
